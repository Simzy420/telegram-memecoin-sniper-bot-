"""User model for the memecoin sniper bot.

Captures everything the bot needs to know about a Telegram user that has
interacted with it: subscription tier, wallet, per-user settings, and
running trade statistics.  Pydantic v2 so it serialises cleanly to /
from SQLite JSON columns and Telegram callback payloads.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .token import Chain


class SubscriptionTier(str, Enum):
    """Subscription tiers — gates feature access & position limits."""

    FREE = "free"
    BASIC = "basic"
    PRO = "pro"
    WHALE = "whale"


class RiskLevel(str, Enum):
    """User-selected risk appetite.

    Maps to a minimum safety score the pipeline must beat before
    auto-sniping:
      LOW    -> score >= 80
      MEDIUM -> score >= 60
      HIGH   -> score >= 40
      DEGEN  -> score >= 0 (anything goes)
    """

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    DEGEN = "degen"


# tier -> default max position in SOL
_TIER_DEFAULT_MAX_SOL: dict[str, float] = {
    SubscriptionTier.FREE.value: 0.05,
    SubscriptionTier.BASIC.value: 0.25,
    SubscriptionTier.PRO.value: 1.0,
    SubscriptionTier.WHALE.value: 5.0,
}


class UserSettings(BaseModel):
    """Per-user trading preferences."""

    model_config = ConfigDict(use_enum_values=True, extra="forbid")

    risk_level: RiskLevel = Field(RiskLevel.MEDIUM, description="Risk appetite (low/medium/high/degen)")
    max_position_sol: float = Field(0.25, gt=0.0, description="Max SOL per auto-sniped position")
    auto_snipe: bool = Field(False, description="If True, bot auto-buys tokens passing the safety gate")
    enabled_chains: list[Chain] = Field(
        default_factory=lambda: [Chain.SOLANA],
        description="Chains the user wants to receive alerts / auto-snipe on",
    )

    @field_validator("risk_level", mode="before")
    @classmethod
    def _normalise_risk(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return RiskLevel(v.lower())
            except ValueError:
                raise ValueError(
                    f"Invalid risk_level: {v!r}. Expected one of {[r.value for r in RiskLevel]}"
                )
        return v

    @field_validator("enabled_chains", mode="before")
    @classmethod
    def _normalise_chains(cls, v: Any) -> Any:
        if v is None:
            return [Chain.SOLANA]
        if isinstance(v, list):
            out: list[Chain] = []
            for item in v:
                if isinstance(item, Chain):
                    out.append(item)
                elif isinstance(item, str):
                    out.append(Chain(item.lower()))
                else:
                    raise ValueError(f"Invalid chain entry: {item!r}")
            return out
        raise ValueError("enabled_chains must be a list")

    @model_validator(mode="after")
    def _validate_max_position(self) -> "UserSettings":
        if self.max_position_sol <= 0:
            raise ValueError("max_position_sol must be > 0")
        return self


class UserStats(BaseModel):
    """Running trade statistics for a user."""

    model_config = ConfigDict(extra="forbid")

    total_trades: int = Field(0, ge=0)
    wins: int = Field(0, ge=0)
    losses: int = Field(0, ge=0)
    total_pnl_sol: float = Field(0.0, description="Cumulative realised PnL in SOL")
    total_pnl_usd: float = Field(0.0, description="Cumulative realised PnL in USD")
    best_trade_pnl_sol: float = Field(0.0)
    worst_trade_pnl_sol: float = Field(0.0)

    @property
    def win_rate(self) -> float:
        """Win rate as a 0-1 fraction (0.0 if no trades)."""
        if self.total_trades == 0:
            return 0.0
        return self.wins / self.total_trades

    def record_trade(self, pnl_sol: float, pnl_usd: float = 0.0) -> None:
        """Update stats after a closed trade.

        Args:
            pnl_sol: realised PnL in SOL (negative for a loss).
            pnl_usd: realised PnL in USD.
        """
        self.total_trades += 1
        self.total_pnl_sol += pnl_sol
        self.total_pnl_usd += pnl_usd
        if pnl_sol >= 0:
            self.wins += 1
            if pnl_sol > self.best_trade_pnl_sol:
                self.best_trade_pnl_sol = pnl_sol
        else:
            self.losses += 1
            if pnl_sol < self.worst_trade_pnl_sol:
                self.worst_trade_pnl_sol = pnl_sol


class User(BaseModel):
    """A Telegram user that has interacted with the bot."""

    model_config = ConfigDict(use_enum_values=True, populate_by_name=True, extra="allow")

    telegram_id: int = Field(..., gt=0, description="Telegram user ID (int64)")
    username: Optional[str] = Field(None, max_length=64, description="@username (without @)")
    subscription_tier: SubscriptionTier = Field(SubscriptionTier.FREE, description="Subscription tier")
    wallet_address: Optional[str] = Field(None, description="User's trading wallet address")
    settings: UserSettings = Field(default_factory=UserSettings)
    stats: UserStats = Field(default_factory=UserStats)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_banned: bool = False
    is_active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

    # ---- validators -------------------------------------------------------
    @field_validator("subscription_tier", mode="before")
    @classmethod
    def _normalise_tier(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return SubscriptionTier(v.lower())
            except ValueError:
                raise ValueError(
                    f"Invalid subscription_tier: {v!r}. Expected one of {[t.value for t in SubscriptionTier]}"
                )
        return v

    @field_validator("username")
    @classmethod
    def _strip_username(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v.startswith("@"):
            v = v[1:]
        return v or None

    @field_validator("wallet_address")
    @classmethod
    def _strip_wallet(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _apply_tier_defaults(self) -> "User":
        """If the user hasn't raised their max position above the tier
        default, keep them at the tier default.  This lets upgrades to
        ``pro``/``whale`` automatically raise the cap without overwriting
        a manually-set lower cap.
        """
        tier_default = _TIER_DEFAULT_MAX_SOL.get(
            self.subscription_tier if isinstance(self.subscription_tier, str) else self.subscription_tier.value,
            0.25,
        )
        # Only auto-bump up; never force a downgrade of a manually set cap.
        if self.settings.max_position_sol < tier_default and self.settings.max_position_sol <= 0.25:
            self.settings.max_position_sol = tier_default
        return self

    # ---- convenience ------------------------------------------------------
    @property
    def tier(self) -> SubscriptionTier:
        """Subscription tier as an enum (works whether stored as str or enum)."""
        if isinstance(self.subscription_tier, SubscriptionTier):
            return self.subscription_tier
        return SubscriptionTier(self.subscription_tier)

    @property
    def is_paid(self) -> bool:
        """True if the user is on a paid tier."""
        return self.tier != SubscriptionTier.FREE

    def can_auto_snipe(self) -> bool:
        """True if the user is allowed to use auto-snipe (paid + enabled)."""
        return self.is_paid and self.settings.auto_snipe and self.is_active and not self.is_banned

    def min_safety_score_for_risk(self) -> int:
        """Minimum safety score required for auto-snipe given the user's risk level."""
        mapping = {
            RiskLevel.LOW.value: 80,
            RiskLevel.MEDIUM.value: 60,
            RiskLevel.HIGH.value: 40,
            RiskLevel.DEGEN.value: 0,
        }
        key = self.settings.risk_level if isinstance(self.settings.risk_level, str) else self.settings.risk_level.value
        return mapping.get(key, 60)
