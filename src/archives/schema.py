"""Canonical schemas for Big Brain Ape daily trade archives.

Specialists are roles in **one** bot (not five bots):

    Scout, Sniper, Pulse, Ledger, Shield

Head ape: Big Brain Ape
Product:  Big Brain Ape The MemeCoin Sniper

Do **not** use retired Pack 1 names (Guard / Arbiter / Router) or
Perp / Swarm folder names. Calendar days are UTC.

Raw day folders are stored in the private repo
https://github.com/Simzy420/bba-trade-archives — schema stays here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SCHEMA_VERSION = "1.1.0"
PRODUCT_NAME = "Big Brain Ape The MemeCoin Sniper"
HEAD_APE = "Big Brain Ape"
ARCHIVE_TIMEZONE = "UTC"

# Pack 2 lock — folder order: scout/ sniper/ pulse/ ledger/ shield/
SPECIALISTS = ("scout", "sniper", "pulse", "ledger", "shield")

RETIRED_SPECIALISTS = frozenset({"guard", "arbiter", "router"})
FORBIDDEN_ALIASES = frozenset({"perp", "perps", "swarm", "hyperliquid"})
FORBIDDEN_FOLDER_NAMES = RETIRED_SPECIALISTS | FORBIDDEN_ALIASES

PRIVATE_ARCHIVE_REPO = "https://github.com/Simzy420/bba-trade-archives"

FILL_OUTCOMES = frozenset({"filled", "partial", "failed"})

COMBINED_FILLS_NAME = "combined-fills.csv"
DAY_SUMMARY_NAME = "day-summary.json"
EVENTS_FILENAME = "events.jsonl"

COMBINED_FILLS_FIELDS = (
    "timestamp",
    "event_id",
    "specialist",
    "chain",
    "venue",
    "token_address",
    "token_symbol",
    "side",
    "size",
    "size_unit",
    "price",
    "price_unit",
    "tx_id",
    "order_id",
    "signal_context",
    "shield_checks",
    "outcome",
    "fee_amount",
    "fee_asset",
    "fee_usd",
    "pnl_usd",
    "notes",
)


class Specialist(str, Enum):
    """Roles inside the single Big Brain Ape memecoin sniper bot."""

    SCOUT = "scout"
    SNIPER = "sniper"
    PULSE = "pulse"
    LEDGER = "ledger"
    SHIELD = "shield"


class TokenRef(BaseModel):
    """Token identity captured at event time (enough to replay)."""

    model_config = ConfigDict(extra="allow")

    address: str = ""
    symbol: str = ""
    name: str = ""


class Fees(BaseModel):
    """Fees paid for a fill or attempt."""

    model_config = ConfigDict(extra="allow")

    amount: float = 0.0
    asset: str = ""
    usd: float = 0.0


class ArchiveEvent(BaseModel):
    """One specialist event — setup, entry, tape, day-log, or risk filter.

    Required replay fields: timestamp, specialist, chain, venue, token,
    side, size, price, tx/order id, signal context, shield checks,
    outcome, fees. Empty strings / zeros mean "not applicable", not
    invented data.
    """

    model_config = ConfigDict(use_enum_values=True, extra="allow")

    event_id: str = Field(default_factory=lambda: uuid4().hex)
    timestamp: Optional[datetime] = None
    timezone: str = ARCHIVE_TIMEZONE
    specialist: Specialist
    chain: str = ""
    venue: str = ""
    token: TokenRef = Field(default_factory=TokenRef)
    side: str = ""
    size: Optional[float] = None
    size_unit: str = ""
    price: Optional[float] = None
    price_unit: str = "USD"
    tx_id: str = ""
    order_id: str = ""
    signal_context: dict[str, Any] = Field(default_factory=dict)
    shield_checks: dict[str, Any] = Field(default_factory=dict)
    outcome: str = ""
    fees: Fees = Field(default_factory=Fees)
    pnl_usd: Optional[float] = None
    notes: str = ""

    @field_validator("specialist", mode="before")
    @classmethod
    def _normalise_specialist(cls, v: Any) -> Any:
        if isinstance(v, str):
            key = v.strip().lower()
            if key in RETIRED_SPECIALISTS:
                raise ValueError(
                    f"Retired specialist {v!r}. Pack 2 names are {list(SPECIALISTS)} "
                    f"(Guard→Shield, Arbiter→Ledger, Router→Pulse)."
                )
            if key in FORBIDDEN_ALIASES:
                raise ValueError(
                    f"Forbidden specialist folder {v!r}. "
                    f"Use one of {list(SPECIALISTS)} — not Perp/Swarm names."
                )
            try:
                return Specialist(key)
            except ValueError:
                raise ValueError(
                    f"Unknown specialist {v!r}. Expected one of {list(SPECIALISTS)}."
                )
        return v

    @field_validator("side", mode="before")
    @classmethod
    def _normalise_side(cls, v: Any) -> Any:
        if v is None:
            return ""
        return str(v).strip().lower()

    @field_validator("timezone", mode="before")
    @classmethod
    def _force_utc(cls, v: Any) -> str:
        if v in (None, "", "UTC", "utc", "Z"):
            return ARCHIVE_TIMEZONE
        raise ValueError(
            f"Archive timezone is {ARCHIVE_TIMEZONE}; got {v!r}. "
            "Convert timestamps to UTC before writing."
        )

    @field_validator("timestamp", mode="before")
    @classmethod
    def _aware_utc(cls, v: Any) -> Any:
        if v is None or v == "":
            return None
        if isinstance(v, str):
            raw = v.strip()
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            v = datetime.fromisoformat(raw)
        if isinstance(v, datetime):
            if v.tzinfo is None:
                return v.replace(tzinfo=timezone.utc)
            return v.astimezone(timezone.utc)
        return v

    @model_validator(mode="after")
    def _stamp_timezone(self) -> "ArchiveEvent":
        self.timezone = ARCHIVE_TIMEZONE
        return self

    def is_fill(self) -> bool:
        """True when this event belongs in combined-fills.csv."""
        return self.outcome in FILL_OUTCOMES and self.side in ("buy", "sell")

    def utc_date_key(self) -> str:
        if self.timestamp is None:
            raise ValueError("timestamp is required before dating an event")
        return self.timestamp.astimezone(timezone.utc).date().isoformat()


def empty_specialist_stats() -> dict[str, Any]:
    return {
        "events": 0,
        "fills": 0,
        "wins": 0,
        "losses": 0,
        "pnl_usd": 0.0,
        "fees_usd": 0.0,
        "volume": 0.0,
    }


def store_metadata() -> dict[str, Any]:
    """Where raw day folders live. No secrets. Schema stays in this repo."""
    return {
        "local_root": "data/trade-archives",
        "remote": PRIVATE_ARCHIVE_REPO,
        "note": (
            "Writer syncs/targets the private GitHub repo as the raw day-folder "
            "store. Schema and EXAMPLE stay in the public sniper repo. "
            "Do not publish fills to the public dashboard."
        ),
    }


def empty_day_summary(
    date_key: str,
    *,
    engine_live: bool = False,
    generated_at: Optional[str] = None,
    example: bool = False,
) -> dict[str, Any]:
    """Zeroed roll-up. Callers must not invent fills to populate this."""
    specialists = {name: empty_specialist_stats() for name in SPECIALISTS}
    summary: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "product": PRODUCT_NAME,
        "head_ape": HEAD_APE,
        "date": date_key,
        "timezone": ARCHIVE_TIMEZONE,
        "generated_at": generated_at or "",
        "engine_live": engine_live,
        "store": store_metadata(),
        "honesty": {
            "engine_live": engine_live,
            "invented_fills": False,
            "note": (
                "Zero counts mean no fills were recorded. "
                "The writer never invents fills."
                + (
                    ""
                    if engine_live
                    else " Phase 1 trading engine is not live."
                )
            ),
        },
        "specialists": specialists,
        "combined": empty_specialist_stats(),
    }
    if example:
        summary["example"] = True
        summary["example_note"] = (
            "EXAMPLE empty day — schema illustration only. "
            "Not live fills. Do not treat as production data."
        )
    return summary


def utc_iso(dt: datetime) -> str:
    """RFC 3339 UTC timestamp with millisecond precision and Z suffix."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
