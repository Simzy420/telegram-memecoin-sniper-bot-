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
class Config:
    solana: SolanaConfig = field(default_factory=SolanaConfig)
    base: BaseConfig = field(default_factory=BaseConfig)
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    trading: TradingConfig = field(default_factory=TradingConfig)
    admin_id: int = int(os.getenv("ADMIN_TELEGRAM_ID", "0"))
