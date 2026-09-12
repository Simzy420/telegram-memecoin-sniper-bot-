"""Default configuration for the sniper bot."""
import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SolanaConfig:
    rpc_url: str = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    wss_url: str = os.getenv("SOLANA_WSS_URL", "")
    pumpfun_program: str = "6EF8rrecthR5DkSon8Fukf1BA2ssVkh1Yq8hCNz1mMo3"


@dataclass
class BaseConfig:
    rpc_url: str = os.getenv("BASE_RPC_URL", "https://mainnet.base.org")
    wss_url: str = os.getenv("BASE_WSS_URL", "")
    uniswap_factory: str = "0x1F98431c8aD98503651532e81eb4f4b4AE0A6E4"


@dataclass
class SafetyConfig:
    min_liquidity_usd: float = 5000.0
    min_safety_score: int = 50
    max_creator_supply_pct: float = 20.0
    check_honeypot: bool = True
    check_liquidity_lock: bool = True
    check_mint_authority: bool = True


@dataclass
class TradingConfig:
    default_slippage_pct: float = 10.0
    max_retries: int = 3
    max_position_sol: float = 0.5
    stop_loss_pct: float = 30.0
    take_profit_pct: float = 100.0


@dataclass
class ArchiveConfig:
    """Daily trade-archive root. Calendar days are UTC; live path is gitignored.

    Raw day folders sync to the private store (bba-trade-archives).
    Schema stays in this repo. No secrets belong here.
    """

    root: str = os.getenv("TRADE_ARCHIVE_ROOT", "data/trade-archives")
    timezone: str = "UTC"
    remote_store: str = os.getenv(
        "TRADE_ARCHIVE_REMOTE",
        "https://github.com/Simzy420/bba-trade-archives",
    )
    # Phase 1: trading engine is not live. Writer still creates empty day folders.
    engine_live: bool = os.getenv("TRADE_ENGINE_LIVE", "false").lower() in ("1", "true", "yes")


@dataclass
class Config:
    solana: SolanaConfig = field(default_factory=SolanaConfig)
    base: BaseConfig = field(default_factory=BaseConfig)
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    trading: TradingConfig = field(default_factory=TradingConfig)
    archives: ArchiveConfig = field(default_factory=ArchiveConfig)
    admin_id: int = int(os.getenv("ADMIN_TELEGRAM_ID", "0"))
