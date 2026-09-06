"""Subscription tier model, persistence, and lifecycle management.

Tiers:
    free  — 3-day trial, 1 snipe/day, max 0.1 SOL
    basic — $19.99/mo, 10 snipes/day, max 0.5 SOL
    pro   — $49.99/mo, unlimited snipes, max 2 SOL, auto-snipe enabled
    whale — $99.99/mo, max 10 SOL, API access
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import aiosqlite
from loguru import logger

DB_PATH = os.getenv("DATABASE_PATH", os.path.join(os.getcwd(), "sniper.db"))

# Payment wallet on Base — subscriptions are paid here
PAYMENT_BASE_WALLET = os.getenv(
    "PAYMENT_BASE_WALLET", "0x37a8023762c69f7150d878733fd9f635f1070fc6"
)
ADMIN_TELEGRAM_ID = int(os.getenv("ADMIN_TELEGRAM_ID", "0"))


# --------------------------------------------------------------------------- #
# Tier definitions
# --------------------------------------------------------------------------- #
class Tier(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PRO = "pro"
    WHALE = "whale"

    @classmethod
    def from_str(cls, value: str) -> "Tier":
        try:
            return cls(value.lower())
        except ValueError:
            return cls.FREE


@dataclass(frozen=True)
class TierConfig:
    name: str
    price_usd: float
    daily_snipe_limit: int  # -1 = unlimited
    max_position_sol: float
    auto_snipe: bool
    api_access: bool
    trial_days: int = 0


TIER_CONFIGS: dict[Tier, TierConfig] = {
    Tier.FREE: TierConfig(
        name="free",
        price_usd=0.0,
        daily_snipe_limit=1,
        max_position_sol=0.1,
        auto_snipe=False,
        api_access=False,
        trial_days=3,
    ),
    Tier.BASIC: TierConfig(
        name="basic",
        price_usd=19.99,
        daily_snipe_limit=10,
        max_position_sol=0.5,
        auto_snipe=False,
        api_access=False,
    ),
    Tier.PRO: TierConfig(
        name="pro",
        price_usd=49.99,
        daily_snipe_limit=-1,  # unlimited
        max_position_sol=2.0,
        auto_snipe=True,
        api_access=False,
    ),
    Tier.WHALE: TierConfig(
        name="whale",
        price_usd=99.99,
        daily_snipe_limit=-1,
        max_position_sol=10.0,
        auto_snipe=True,
        api_access=True,
    ),
}


# --------------------------------------------------------------------------- #
# Subscription data model
# --------------------------------------------------------------------------- #
@dataclass
class Subscription:
    user_id: int
    tier: Tier
    status: str  # "trial" | "active" | "expired" | "cancelled"
    started_at: float
    expires_at: float
    daily_snipes_used: int = 0
    last_snipe_reset: float = 0.0
    auto_renew: bool = False
    payment_tx: str = ""

    @property
    def config(self) -> TierConfig:
        return TIER_CONFIGS[self.tier]

    @property
    def is_active(self) -> bool:
        if self.status == "cancelled":
            return False
        if self.status == "expired":
            return False
        return time.time() < self.expires_at

    @property
    def days_remaining(self) -> int:
        remaining = (self.expires_at - time.time()) / 86400
        return max(0, int(remaining))

    @property
    def snipes_remaining_today(self) -> int:
        if self.config.daily_snipe_limit == -1:
            return -1  # unlimited
        return max(0, self.config.daily_snipe_limit - self.daily_snipes_used)

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "tier": self.tier.value,
            "status": self.status,
            "started_at": self.started_at,
            "expires_at": self.expires_at,
            "days_remaining": self.days_remaining,
            "is_active": self.is_active,
            "daily_snipes_used": self.daily_snipes_used,
            "snipes_remaining_today": self.snipes_remaining_today,
            "auto_renew": self.auto_renew,
        }


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
SCHEMA = """
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id          INTEGER PRIMARY KEY,
    tier             TEXT    NOT NULL DEFAULT 'free',
    status           TEXT    NOT NULL DEFAULT 'trial',
    started_at       REAL    NOT NULL,
    expires_at       REAL    NOT NULL,
    daily_snipes_used INTEGER NOT NULL DEFAULT 0,
    last_snipe_reset REAL    NOT NULL DEFAULT 0,
    auto_renew       INTEGER NOT NULL DEFAULT 0,
    payment_tx       TEXT    NOT NULL DEFAULT '',
    created_at       REAL    NOT NULL DEFAULT 0,
    updated_at       REAL    NOT NULL DEFAULT 0
);
"""


# --------------------------------------------------------------------------- #
# Manager
# --------------------------------------------------------------------------- #
class SubscriptionManager:
    """Persist and query subscription state from SQLite.

    Uses its own lightweight connection so it can run independently of
    other modules.
    """

    def __init__(self, db_path: str = DB_PATH) -> None:
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def init(self) -> None:
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute(SCHEMA)
        await self._db.commit()
        logger.info("SubscriptionManager initialised")

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("SubscriptionManager not initialised")
        return self._db

    # --------------------------- core ops --------------------------------- #
    async def check_subscription(self, user_id: int) -> Subscription:
        """Return the subscription for *user_id*, creating a free trial if absent.

        Also resets the daily snipe counter if a new UTC day has begun and
        runs an expiry check.
        """
        await self.expire_check(user_id)

        row = await (
            await self.db.execute(
                "SELECT * FROM subscriptions WHERE user_id = ?",
                (user_id,),
            )
        ).fetchone()

        if row is None:
            return await self._create_trial(user_id)

        sub = self._row_to_sub(row)
        await self._maybe_reset_daily(sub)
        return sub

    async def upgrade(
        self,
        user_id: int,
        new_tier: Tier,
        payment_tx: str = "",
        duration_days: int = 30,
        auto_renew: bool = False,
    ) -> Subscription:
        """Upgrade (or downgrade) a user to *new_tier* and mark active.

        If the user has no subscription yet one is created.  If they are
        already on *new_tier* the expiry is extended.
        """
        now = time.time()
        new_expires = now + duration_days * 86400

        existing = await (
            await self.db.execute(
                "SELECT * FROM subscriptions WHERE user_id = ?",
                (user_id,),
            )
        ).fetchone()

        if existing:
            # If same tier and still active, extend from current expiry
            current_expires = existing["expires_at"]
            if existing["tier"] == new_tier.value and current_expires > now:
                new_expires = current_expires + duration_days * 86400

            await self.db.execute(
                """
                UPDATE subscriptions
                   SET tier = ?, status = 'active', expires_at = ?,
                       auto_renew = ?, payment_tx = ?, updated_at = ?
                 WHERE user_id = ?
                """,
                (new_tier.value, new_expires, int(auto_renew), payment_tx, now, user_id),
            )
        else:
            await self.db.execute(
                """
                INSERT INTO subscriptions
                    (user_id, tier, status, started_at, expires_at,
                     daily_snipes_used, last_snipe_reset, auto_renew,
                     payment_tx, created_at, updated_at)
                VALUES (?,?,?,?,?,0,?,?,?,?,?)
                """,
                (
                    user_id, new_tier.value, "active", now, new_expires,
                    now, int(auto_renew), payment_tx, now, now,
                ),
            )

        await self.db.commit()
        logger.info(f"User {user_id} upgraded to {new_tier.value} (expires {new_expires})")
        return await self.check_subscription(user_id)

    async def expire_check(self, user_id: Optional[int] = None) -> int:
        """Mark expired subscriptions.  If *user_id* given, check only that user.

        Returns the number of subscriptions marked expired.
        """
        now = time.time()
        if user_id:
            row = await (
                await self.db.execute(
                    "SELECT expires_at, status FROM subscriptions WHERE user_id = ?",
                    (user_id,),
                )
            ).fetchone()
            if row and row["status"] in ("active", "trial") and row["expires_at"] < now:
                await self.db.execute(
                    """
                    UPDATE subscriptions
                       SET status = 'expired', tier = 'free', updated_at = ?
                     WHERE user_id = ?
                    """,
                    (now, user_id),
                )
                await self.db.commit()
                logger.info(f"User {user_id} subscription expired")
                return 1
            return 0

        # Global expiry sweep
        cursor = await self.db.execute(
            """
            UPDATE subscriptions
               SET status = 'expired', tier = 'free', updated_at = ?
             WHERE expires_at < ? AND status IN ('active','trial')
            """,
            (now, now),
        )
        count = cursor.rowcount or 0
        await self.db.commit()
        if count:
            logger.info(f"Expired {count} subscriptions")
        return count

    async def cancel(self, user_id: int) -> bool:
        """Cancel a subscription (no auto-renew, expires naturally)."""
        await self.db.execute(
            "UPDATE subscriptions SET auto_renew = 0, status = 'cancelled', updated_at = ? WHERE user_id = ?",
            (time.time(), user_id),
        )
        await self.db.commit()
        return True

    async def record_snipe(self, user_id: int) -> bool:
        """Increment the daily snipe counter.  Returns False if over limit."""
        sub = await self.check_subscription(user_id)
        if not sub.is_active:
            return False
        if sub.snipes_remaining_today == 0:
            return False
        await self.db.execute(
            "UPDATE subscriptions SET daily_snipes_used = daily_snipes_used + 1, updated_at = ? WHERE user_id = ?",
            (time.time(), user_id),
        )
        await self.db.commit()
        return True

    # --------------------------- helpers ---------------------------------- #
    async def _create_trial(self, user_id: int) -> Subscription:
        now = time.time()
        trial_days = TIER_CONFIGS[Tier.FREE].trial_days
        expires = now + trial_days * 86400
        await self.db.execute(
            """
            INSERT INTO subscriptions
                (user_id, tier, status, started_at, expires_at,
                 daily_snipes_used, last_snipe_reset, auto_renew,
                 payment_tx, created_at, updated_at)
            VALUES (?,?,?,?,?,0,?,0,'',?,?)
            """,
            (user_id, Tier.FREE.value, "trial", now, expires, now, now, now),
        )
        await self.db.commit()
        logger.info(f"Created 3-day free trial for user {user_id}")
        return Subscription(
            user_id=user_id,
            tier=Tier.FREE,
            status="trial",
            started_at=now,
            expires_at=expires,
            daily_snipes_used=0,
            last_snipe_reset=now,
        )

    async def _maybe_reset_daily(self, sub: Subscription) -> None:
        """Reset daily snipe counter at UTC midnight."""
        from datetime import datetime, timezone
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).timestamp()
        if sub.last_snipe_reset < today_start:
            await self.db.execute(
                """
                UPDATE subscriptions
                   SET daily_snipes_used = 0, last_snipe_reset = ?
                 WHERE user_id = ?
                """,
                (today_start, sub.user_id),
            )
            await self.db.commit()

    def _row_to_sub(self, row: aiosqlite.Row) -> Subscription:
        return Subscription(
            user_id=row["user_id"],
            tier=Tier.from_str(row["tier"]),
            status=row["status"],
            started_at=row["started_at"],
            expires_at=row["expires_at"],
            daily_snipes_used=row["daily_snipes_used"],
            last_snipe_reset=row["last_snipe_reset"],
            auto_renew=bool(row["auto_renew"]),
            payment_tx=row["payment_tx"],
        )
