"""Async SQLite analytics tracker for trade events and statistics.

Records every trade to a local SQLite database and maintains rolling
daily aggregate stats so the bot can report win-rate, P&L, and volume
without expensive queries.

Tables:
    trades       — one row per completed buy/sell
    daily_stats  — per-user, per-day aggregate (used for rate limits & charts)
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite

DB_PATH = os.getenv("DATABASE_PATH", os.path.join(os.getcwd(), "sniper.db"))


# --------------------------------------------------------------------------- #
# Data containers
# --------------------------------------------------------------------------- #
@dataclass
class TradeRecord:
    """Normalised row that mirrors the *trades* table."""

    id: Optional[int]
    user_id: int
    token_address: str
    token_symbol: str
    chain: str
    side: str  # "buy" | "sell"
    amount_sol: float
    price_usd: float
    quantity: float
    tx_signature: str
    status: str  # "pending" | "confirmed" | "failed" | "closed"
    pnl_usd: float
    pnl_pct: float
    position_id: Optional[str]
    created_at: float


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
SCHEMA_TRADES = """
CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    token_address   TEXT    NOT NULL,
    token_symbol    TEXT    NOT NULL,
    chain           TEXT    NOT NULL DEFAULT 'solana',
    side            TEXT    NOT NULL,
    amount_sol      REAL    NOT NULL,
    price_usd       REAL    NOT NULL,
    quantity        REAL    NOT NULL,
    tx_signature    TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'pending',
    pnl_usd         REAL    NOT NULL DEFAULT 0.0,
    pnl_pct         REAL    NOT NULL DEFAULT 0.0,
    position_id     TEXT,
    created_at      REAL    NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);
"""

SCHEMA_DAILY_STATS = """
CREATE TABLE IF NOT EXISTS daily_stats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    stat_date       TEXT    NOT NULL,        -- YYYY-MM-DD (UTC)
    total_trades    INTEGER NOT NULL DEFAULT 0,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    total_pnl_usd   REAL    NOT NULL DEFAULT 0.0,
    total_volume_sol REAL   NOT NULL DEFAULT 0.0,
    UNIQUE(user_id, stat_date)
);
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_trades_user       ON trades(user_id);",
    "CREATE INDEX IF NOT EXISTS idx_trades_token       ON trades(token_address);",
    "CREATE INDEX IF NOT EXISTS idx_trades_status      ON trades(status);",
    "CREATE INDEX IF NOT EXISTS idx_trades_created     ON trades(created_at);",
    "CREATE INDEX IF NOT EXISTS idx_daily_user_date    ON daily_stats(user_id, stat_date);",
]


# --------------------------------------------------------------------------- #
# Tracker
# --------------------------------------------------------------------------- #
class AnalyticsTracker:
    """Async wrapper around the SQLite analytics database.

    Usage::

        tracker = AnalyticsTracker()
        await tracker.init()
        await tracker.record_trade(...)
        await tracker.close()
    """

    def __init__(self, db_path: str = DB_PATH) -> None:
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    # --------------------------- lifecycle -------------------------------- #
    async def init(self) -> None:
        """Open the connection and ensure the schema exists."""
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL;")
        await self._db.execute("PRAGMA synchronous=NORMAL;")
        await self._db.execute(SCHEMA_TRADES)
        await self._db.execute(SCHEMA_DAILY_STATS)
        for idx in INDEXES:
            await self._db.execute(idx)
        await self._db.commit()
        from loguru import logger  # local import to keep module importable
        logger.info(f"Analytics DB initialised at {self.db_path}")

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("AnalyticsTracker not initialised — call init() first")
        return self._db

    # --------------------------- writes ----------------------------------- #
    async def record_trade(
        self,
        user_id: int,
        token_address: str,
        token_symbol: str,
        side: str,
        amount_sol: float,
        price_usd: float,
        quantity: float,
        tx_signature: str = "",
        status: str = "confirmed",
        pnl_usd: float = 0.0,
        pnl_pct: float = 0.0,
        position_id: Optional[str] = None,
        chain: str = "solana",
    ) -> int:
        """Insert a trade row and update daily aggregates.

        Returns the new row id.
        """
        now = time.time()
        cursor = await self.db.execute(
            """
            INSERT INTO trades
                (user_id, token_address, token_symbol, chain, side,
                 amount_sol, price_usd, quantity, tx_signature, status,
                 pnl_usd, pnl_pct, position_id, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                user_id, token_address, token_symbol, chain, side,
                amount_sol, price_usd, quantity, tx_signature, status,
                pnl_usd, pnl_pct, position_id, now,
            ),
        )
        await self.db.commit()
        trade_id = cursor.lastrowid or 0

        # Update daily stats (only confirmed / closed trades count)
        if status in ("confirmed", "closed"):
            await self._bump_daily_stats(
                user_id=user_id,
                pnl_usd=pnl_usd,
                is_win=pnl_usd > 0,
                is_loss=pnl_usd < 0,
                volume_sol=amount_sol,
            )
        return trade_id

    async def update_trade_status(
        self,
        trade_id: int,
        status: str,
        pnl_usd: float = 0.0,
        pnl_pct: float = 0.0,
    ) -> None:
        """Update an existing trade row (e.g. when a close fills)."""
        await self.db.execute(
            """
            UPDATE trades
               SET status = ?, pnl_usd = ?, pnl_pct = ?
             WHERE id = ?
            """,
            (status, pnl_usd, pnl_pct, trade_id),
        )
        await self.db.commit()

    async def _bump_daily_stats(
        self,
        user_id: int,
        pnl_usd: float,
        is_win: bool,
        is_loss: bool,
        volume_sol: float,
    ) -> None:
        stat_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await self.db.execute(
            """
            INSERT INTO daily_stats
                (user_id, stat_date, total_trades, wins, losses,
                 total_pnl_usd, total_volume_sol)
            VALUES (?,?,1,?,?,?,?)
            ON CONFLICT(user_id, stat_date) DO UPDATE SET
                total_trades    = total_trades    + 1,
                wins            = wins            + excluded.wins,
                losses          = losses          + excluded.losses,
                total_pnl_usd   = total_pnl_usd   + excluded.total_pnl_usd,
                total_volume_sol= total_volume_sol+ excluded.total_volume_sol
            """,
            (
                user_id, stat_date,
                1 if is_win else 0,
                1 if is_loss else 0,
                pnl_usd,
                volume_sol,
            ),
        )
        await self.db.commit()

    # --------------------------- reads ------------------------------------ #
    async def get_user_stats(self, user_id: int, limit: int = 50) -> dict[str, Any]:
        """Return aggregate stats + recent trades for a single user."""
        # Aggregates
        row = await (
            await self.db.execute(
                """
                SELECT
                    COUNT(*)                 AS total_trades,
                    SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN pnl_usd < 0 THEN 1 ELSE 0 END) AS losses,
                    COALESCE(SUM(pnl_usd), 0)  AS total_pnl,
                    COALESCE(SUM(amount_sol),0)AS total_volume
                FROM trades
                WHERE user_id = ? AND status IN ('confirmed','closed')
                """,
                (user_id,),
            )
        ).fetchone()

        total_trades = row["total_trades"] or 0
        wins = row["wins"] or 0
        losses = row["losses"] or 0
        win_rate = (wins / total_trades * 100) if total_trades else 0.0

        recent = await (
            await self.db.execute(
                """
                SELECT * FROM trades
                 WHERE user_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?
                """,
                (user_id, limit),
            )
        ).fetchall()

        return {
            "total_trades": total_trades,
            "wins": wins,
            "losses": losses,
            "win_rate": round(win_rate, 2),
            "total_pnl_usd": round(row["total_pnl"] or 0.0, 2),
            "total_volume_sol": round(row["total_volume"] or 0.0, 4),
            "recent_trades": [dict(r) for r in recent],
        }

    async def get_bot_stats(self) -> dict[str, Any]:
        """Return bot-wide aggregate stats (all users)."""
        row = await (
            await self.db.execute(
                """
                SELECT
                    COUNT(*) AS total_trades,
                    COUNT(DISTINCT user_id) AS unique_users,
                    SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN pnl_usd < 0 THEN 1 ELSE 0 END) AS losses,
                    COALESCE(SUM(pnl_usd), 0)  AS total_pnl,
                    COALESCE(SUM(amount_sol),0)AS total_volume
                FROM trades
                WHERE status IN ('confirmed','closed')
                """
            )
        ).fetchone()

        total_trades = row["total_trades"] or 0
        wins = row["wins"] or 0
        losses = row["losses"] or 0
        win_rate = (wins / total_trades * 100) if total_trades else 0.0

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        today_row = await (
            await self.db.execute(
                """
                SELECT COALESCE(SUM(total_trades),0) AS trades_today,
                       COALESCE(SUM(total_pnl_usd),0) AS pnl_today
                FROM daily_stats WHERE stat_date = ?
                """,
                (today,),
            )
        ).fetchone()

        return {
            "total_trades": total_trades,
            "unique_users": row["unique_users"] or 0,
            "wins": wins,
            "losses": losses,
            "win_rate": round(win_rate, 2),
            "total_pnl_usd": round(row["total_pnl"] or 0.0, 2),
            "total_volume_sol": round(row["total_volume"] or 0.0, 4),
            "trades_today": today_row["trades_today"] or 0,
            "pnl_today": round(today_row["pnl_today"] or 0.0, 2),
        }

    async def calculate_win_rate(self, user_id: Optional[int] = None) -> float:
        """Return win rate as a percentage (0–100).

        If *user_id* is ``None`` the bot-wide win rate is returned.
        """
        if user_id:
            row = await (
                await self.db.execute(
                    """
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins
                    FROM trades
                    WHERE user_id = ? AND status IN ('confirmed','closed')
                      AND pnl_usd != 0
                    """,
                    (user_id,),
                )
            ).fetchone()
        else:
            row = await (
                await self.db.execute(
                    """
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins
                    FROM trades
                    WHERE status IN ('confirmed','closed')
                      AND pnl_usd != 0
                    """
                )
            ).fetchone()

        total = row["total"] or 0
        wins = row["wins"] or 0
        return round((wins / total * 100) if total else 0.0, 2)

    async def get_total_pnl(self, user_id: Optional[int] = None) -> float:
        """Return cumulative realised P&L in USD."""
        if user_id:
            row = await (
                await self.db.execute(
                    """
                    SELECT COALESCE(SUM(pnl_usd),0) AS pnl
                    FROM trades
                    WHERE user_id = ? AND status IN ('confirmed','closed')
                    """,
                    (user_id,),
                )
            ).fetchone()
        else:
            row = await (
                await self.db.execute(
                    """
                    SELECT COALESCE(SUM(pnl_usd),0) AS pnl
                    FROM trades
                    WHERE status IN ('confirmed','closed')
                    """
                )
            ).fetchone()
        return round(row["pnl"] or 0.0, 2)

    async def get_daily_trade_count(self, user_id: int) -> int:
        """Count of trades today for *user_id* (used by rate-limiter)."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        row = await (
            await self.db.execute(
                "SELECT COALESCE(total_trades,0) AS n FROM daily_stats WHERE user_id=? AND stat_date=?",
                (user_id, today),
            )
        ).fetchone()
        return row["n"] or 0

    async def get_trade_history(
        self, user_id: int, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Return recent trade dicts (newest first)."""
        rows = await (
            await self.db.execute(
                "SELECT * FROM trades WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            )
        ).fetchall()
        return [dict(r) for r in rows]
