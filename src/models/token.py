"""Token data model for detected memecoins.

Represents a token detected by the snipers (Pump.fun, Raydium, Uniswap)
before and after safety analysis.  Uses Pydantic v2 for validation and
JSON (de)serialisation so tokens can flow through asyncio queues, be
persisted to SQLite, or sent over the Telegram bot wire cheaply.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Chain(str, Enum):
    """Supported trading chains."""

    SOLANA = "solana"
    BASE = "base"


class Token(BaseModel):
    """A memecoin detected by one of the snipers.

    Attributes:
        address: On-chain token mint address (Solana) or contract
            address (Base).
        name: Human-readable token name (e.g. "Dogecoin 2.0").
        symbol: Ticker symbol (e.g. "DOGE2").
        chain: Chain the token lives on.
        launch_time: UTC datetime when the token was first observed /
            created on-chain.
        initial_liquidity_usd: USD value of liquidity at launch time.
            ``None`` until the first liquidity snapshot succeeds.
        creator_wallet: Wallet address that created / deployed the token.
        supply: Total / max supply in base units (human-readable, not
            raw lamports).  ``None`` until fetched.
        safety_score: Final safety score 0-100 assigned by the safety
            pipeline.  ``None`` until :class:`RugChecker` has run.
        metadata: Free-form bag for platform-specific data — pump.fun
            bond curve progress, raydium pool id, image URI, socials,
            etc.
    """

    model_config = ConfigDict(
        use_enum_values=True,
        populate_by_name=True,
        extra="allow",
    )

    address: str = Field(..., min_length=32, max_length=64, description="Token mint / contract address")
    name: str = Field(..., min_length=1, max_length=128, description="Token name")
    symbol: str = Field(..., min_length=1, max_length=32, description="Ticker symbol")
    chain: Chain = Field(..., description="Chain the token lives on")
    launch_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC launch / detection time")
    initial_liquidity_usd: Optional[float] = Field(None, ge=0.0, description="USD liquidity at launch")
    creator_wallet: Optional[str] = Field(None, description="Deployer wallet address")
    supply: Optional[float] = Field(None, ge=0.0, description="Total supply in base units")
    safety_score: Optional[int] = Field(None, ge=0, le=100, description="Safety pipeline score 0-100")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Platform-specific extras")

    # ---- validators -------------------------------------------------------
    @field_validator("chain", mode="before")
    @classmethod
    def _normalise_chain(cls, v: Any) -> Any:
        """Accept bare strings ("solana") or Chain members."""
        if isinstance(v, str) and not isinstance(v, Chain):
            try:
                return Chain(v.lower())
            except ValueError:
                raise ValueError(f"Unsupported chain: {v!r}. Expected one of {[c.value for c in Chain]}")
        return v

    @field_validator("address", "creator_wallet")
    @classmethod
    def _strip_whitespace(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("address / creator_wallet cannot be empty")
        return v

    @field_validator("symbol")
    @classmethod
    def _upper_symbol(cls, v: str) -> str:
        return v.strip().upper()

    # ---- convenience ------------------------------------------------------
    @property
    def is_solana(self) -> bool:
        """True if this token lives on Solana."""
        return self.chain == Chain.SOLANA.value or self.chain == Chain.SOLANA

    @property
    def is_base(self) -> bool:
        """True if this token lives on Base."""
        return self.chain == Chain.BASE.value or self.chain == Chain.BASE

    def short_address(self, prefix: int = 4, suffix: int = 4) -> str:
        """Return a shortened address like ``So11…Mo3`` for display."""
        if len(self.address) <= prefix + suffix + 1:
            return self.address
        return f"{self.address[:prefix]}…{self.address[-suffix:]}"
