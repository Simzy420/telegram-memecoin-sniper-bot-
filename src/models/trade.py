"""Trade model for the memecoin sniper bot.

Records every buy / sell the bot places (or attempts to place) on behalf
of a user.  Designed to be persisted to SQLite and surfaced in the
Telegram bot's position / history views.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .token import Chain


class TradeSide(str, Enum):
    """Trade direction."""

    BUY = "buy"
    SELL = "sell"


class TradeStatus(str, Enum):
    """Lifecycle of a trade record.

    PENDING  -> created, not yet submitted on-chain
    EXECUTED -> transaction confirmed on-chain
    FAILED   -> submission / confirmation failed
    """

    PENDING = "pending"
    EXECUTED = "executed"
    FAILED = "failed"


class Trade(BaseModel):
    """A single buy or sell attempt for a user.

    Attributes:
        id: Unique trade ID (UUID hex).  Auto-generated if not supplied.
        user_id: Telegram ID of the owning user.
        token_address: Mint / contract address of the traded token.
        token_symbol: Ticker at trade time (cached for display).
        chain: Chain the trade was placed on.
        side: buy or sell.
        amount_sol: Size of the order in SOL.
        price_usd: Token price in USD at execution (optional pre-fill).
        slippage_pct: Slippage tolerance used for the order.
        tx_hash: On-chain transaction signature / hash once submitted.
        safety_score: Safety score of the token at trade time.
        timestamp: When the trade record was created (UTC).
        pnl: Realised PnL in SOL (filled on sell).
        pnl_usd: Realised PnL in USD (filled on sell).
        status: Current lifecycle state.
        error: Optional human-readable error message (for FAILED trades).
        metadata: Free-form extras (raydium amm, jito tip, etc.).
    """

    model_config = ConfigDict(use_enum_values=True, populate_by_name=True, extra="allow")

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, description="Unique trade ID")
    user_id: int = Field(..., gt=0, description="Owning user's Telegram ID")
    token_address: str = Field(..., min_length=32, max_length=64, description="Token mint / contract address")
    token_symbol: str = Field(..., min_length=1, max_length=32, description="Ticker at trade time")
    chain: Chain = Field(..., description="Chain the trade was placed on")
    side: TradeSide = Field(..., description="buy or sell")
    amount_sol: float = Field(..., gt=0.0, description="Order size in SOL")
    price_usd: Optional[float] = Field(None, ge=0.0, description="Token price in USD at execution")
    slippage_pct: float = Field(10.0, ge=0.0, le=100.0, description="Slippage tolerance %")
    tx_hash: Optional[str] = Field(None, description="On-chain transaction signature / hash")
    safety_score: Optional[int] = Field(None, ge=0, le=100, description="Safety score at trade time")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Trade creation time (UTC)")
    pnl: Optional[float] = Field(None, description="Realised PnL in SOL (filled on sell)")
    pnl_usd: Optional[float] = Field(None, description="Realised PnL in USD (filled on sell)")
    status: TradeStatus = Field(TradeStatus.PENDING, description="Trade lifecycle state")
    error: Optional[str] = Field(None, description="Error message for FAILED trades")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Free-form extras")

    # ---- validators -------------------------------------------------------
    @field_validator("chain", mode="before")
    @classmethod
    def _normalise_chain(cls, v: Any) -> Any:
        if isinstance(v, str) and not isinstance(v, Chain):
            try:
                return Chain(v.lower())
            except ValueError:
                raise ValueError(f"Unsupported chain: {v!r}")
        return v

    @field_validator("side", mode="before")
    @classmethod
    def _normalise_side(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return TradeSide(v.lower())
            except ValueError:
                raise ValueError(f"Invalid side: {v!r}. Expected 'buy' or 'sell'")
        return v

    @field_validator("status", mode="before")
    @classmethod
    def _normalise_status(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return TradeStatus(v.lower())
            except ValueError:
                raise ValueError(
                    f"Invalid status: {v!r}. Expected one of {[s.value for s in TradeStatus]}"
                )
        return v

    @field_validator("token_symbol")
    @classmethod
    def _upper_symbol(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("token_address", "tx_hash")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _validate_state(self) -> "Trade":
        """Cross-field consistency:
        - EXECUTED trades must have a tx_hash
        - FAILED trades should carry an error
        - SELL trades may carry pnl; BUY trades normally don't
        """
        status_val = self.status if isinstance(self.status, str) else self.status.value

        if status_val == TradeStatus.EXECUTED.value and not self.tx_hash:
            raise ValueError("EXECUTED trades must have a tx_hash")

        if status_val == TradeStatus.FAILED.value and not self.error:
            # Not a hard error — just annotate so the UI can show *why*.
            self.error = "Unknown error"

        return self

    # ---- convenience ------------------------------------------------------
    @property
    def is_buy(self) -> bool:
        return (self.side if isinstance(self.side, str) else self.side.value) == TradeSide.BUY.value

    @property
    def is_sell(self) -> bool:
        return (self.side if isinstance(self.side, str) else self.side.value) == TradeSide.SELL.value

    @property
    def is_executed(self) -> bool:
        return (self.status if isinstance(self.status, str) else self.status.value) == TradeStatus.EXECUTED.value

    @property
    def is_failed(self) -> bool:
        return (self.status if isinstance(self.status, str) else self.status.value) == TradeStatus.FAILED.value

    def mark_executed(self, tx_hash: str, price_usd: Optional[float] = None) -> None:
        """Transition PENDING -> EXECUTED."""
        self.tx_hash = tx_hash
        self.status = TradeStatus.EXECUTED
        if price_usd is not None:
            self.price_usd = price_usd

    def mark_failed(self, error: str) -> None:
        """Transition PENDING -> FAILED."""
        self.status = TradeStatus.FAILED
        self.error = error

    def realise_pnl(self, pnl_sol: float, pnl_usd: float = 0.0) -> None:
        """Attach realised PnL (used when a SELL is executed)."""
        self.pnl = pnl_sol
        self.pnl_usd = pnl_usd
