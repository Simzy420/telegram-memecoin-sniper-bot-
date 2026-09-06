"""Position tracker with async price monitoring and auto exit logic.

Tracks every open position taken by the bot.  A background asyncio task
polls DexScreener for current prices, updates unrealised P&L, and
automatically triggers stop-loss / take-profit exits when thresholds
are breached.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

import aiohttp
from loguru import logger

DEXSCREENER_API = os.getenv("DEXSCREENER_API_URL", "https://api.dexscreener.com")
PRICE_POLL_INTERVAL = int(os.getenv("POSITION_POLL_INTERVAL", "30"))  # seconds


# --------------------------------------------------------------------------- #
# Enums & data models
# --------------------------------------------------------------------------- #
class PositionStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"
    LIQUIDATED = "liquidated"


@dataclass
class Position:
    """A single open trade position."""

    id: str
    user_id: int
    token_address: str
    token_symbol: str
    chain: str
    entry_price: float
    current_price: float
    size_sol: float
    quantity: float
    stop_loss_price: float
    take_profit_price: float
    status: PositionStatus = PositionStatus.OPEN
    pnl_pct: float = 0.0
    pnl_usd: float = 0.0
    opened_at: float = field(default_factory=time.time)
    closed_at: Optional[float] = None
    close_price: Optional[float] = None
    tx_signature: str = ""

    def update_price(self, new_price: float) -> None:
        """Recalculate P&L from a new spot price."""
        self.current_price = new_price
        if self.entry_price > 0:
            self.pnl_pct = ((new_price - self.entry_price) / self.entry_price) * 100
        # rough USD P&L: size_sol * pnl_pct / 100 * ~$150 SOL price
        # (DexScreener gives exact USD; we use SOL value as proxy)
        self.pnl_usd = self.size_sol * (self.pnl_pct / 100) * 150.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "token_address": self.token_address,
            "token_symbol": self.token_symbol,
            "chain": self.chain,
            "entry_price": self.entry_price,
            "current_price": self.current_price,
            "size_sol": self.size_sol,
            "quantity": self.quantity,
            "stop_loss_price": self.stop_loss_price,
            "take_profit_price": self.take_profit_price,
            "status": self.status.value,
            "pnl_pct": round(self.pnl_pct, 2),
            "pnl_usd": round(self.pnl_usd, 2),
            "opened_at": self.opened_at,
            "closed_at": self.closed_at,
            "tx_signature": self.tx_signature,
        }


# --------------------------------------------------------------------------- #
# Callback signature for exits
# --------------------------------------------------------------------------- #
ExitCallback = Callable[[Position, str], "asyncio.Future"]  # (position, reason)


# --------------------------------------------------------------------------- #
# Tracker
# --------------------------------------------------------------------------- #
class PositionTracker:
    """In-memory position store with async price monitor.

    Args:
        stop_loss_pct:  default stop-loss percentage below entry.
        take_profit_pct: default take-profit percentage above entry.
        poll_interval:  seconds between price polls.
        exit_callback:  async callable invoked when a position should be
                         closed.  Receives ``(position, reason)`` where
                         reason is ``"stop_loss"`` or ``"take_profit"``.
    """

    def __init__(
        self,
        stop_loss_pct: float = 30.0,
        take_profit_pct: float = 100.0,
        poll_interval: int = PRICE_POLL_INTERVAL,
        exit_callback: Optional[ExitCallback] = None,
    ) -> None:
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.poll_interval = poll_interval
        self.exit_callback = exit_callback

        self._positions: dict[str, Position] = {}  # id → Position
        self._user_positions: dict[int, set[str]] = {}  # user_id → {pos_ids}
        self._monitor_task: Optional[asyncio.Task] = None
        self._running = False
        self._session: Optional[aiohttp.ClientSession] = None

    # --------------------------- lifecycle -------------------------------- #
    async def start(self) -> None:
        """Start the background price monitor."""
        if self._running:
            return
        self._running = True
        self._session = aiohttp.ClientSession()
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("PositionTracker monitor started")

    async def stop(self) -> None:
        """Stop the monitor and clean up."""
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
            self._monitor_task = None
        if self._session:
            await self._session.close()
            self._session = None
        logger.info("PositionTracker monitor stopped")

    # --------------------------- public API ------------------------------- #
    async def open_position(
        self,
        user_id: int,
        token_address: str,
        token_symbol: str,
        entry_price: float,
        size_sol: float,
        quantity: float,
        chain: str = "solana",
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
        tx_signature: str = "",
    ) -> Position:
        """Register a new open position and return it."""
        pos_id = str(uuid.uuid4())
        sl_pct = stop_loss_pct if stop_loss_pct is not None else self.stop_loss_pct
        tp_pct = take_profit_pct if take_profit_pct is not None else self.take_profit_pct

        pos = Position(
            id=pos_id,
            user_id=user_id,
            token_address=token_address,
            token_symbol=token_symbol,
            chain=chain,
            entry_price=entry_price,
            current_price=entry_price,
            size_sol=size_sol,
            quantity=quantity,
            stop_loss_price=entry_price * (1 - sl_pct / 100),
            take_profit_price=entry_price * (1 + tp_pct / 100),
            tx_signature=tx_signature,
        )

        self._positions[pos_id] = pos
        self._user_positions.setdefault(user_id, set()).add(pos_id)
        logger.info(
            f"Opened position {pos_id[:8]} for user {user_id}: "
            f"{token_symbol} @ {entry_price:.8f} | SL {pos.stop_loss_price:.8f} TP {pos.take_profit_price:.8f}"
        )
        return pos

    async def close_position(
        self,
        position_id: str,
        close_price: float,
        status: PositionStatus = PositionStatus.CLOSED,
    ) -> Optional[Position]:
        """Mark a position as closed and remove it from active tracking."""
        pos = self._positions.get(position_id)
        if pos is None:
            return None

        pos.update_price(close_price)
        pos.status = status
        pos.close_price = close_price
        pos.closed_at = time.time()

        # Remove from active maps
        user_positions = self._user_positions.get(pos.user_id)
        if user_positions:
            user_positions.discard(position_id)

        closed = self._positions.pop(position_id, None)
        logger.info(
            f"Closed position {position_id[:8]} ({status.value}) "
            f"P&L: {pos.pnl_pct:+.2f}%"
        )
        return pos

    def get_position(self, position_id: str) -> Optional[Position]:
        return self._positions.get(position_id)

    def get_user_positions(self, user_id: int) -> list[Position]:
        ids = self._user_positions.get(user_id, set())
        return [self._positions[pid] for pid in ids if pid in self._positions]

    def get_all_positions(self) -> list[Position]:
        return list(self._positions.values())

    def set_stop_loss(self, position_id: str, sl_price: float) -> bool:
        pos = self._positions.get(position_id)
        if pos is None:
            return False
        pos.stop_loss_price = sl_price
        return True

    def set_take_profit(self, position_id: str, tp_price: float) -> bool:
        pos = self._positions.get(position_id)
        if pos is None:
            return False
        pos.take_profit_price = tp_price
        return True

    # --------------------------- monitor loop ------------------------------ #
    async def _monitor_loop(self) -> None:
        """Continuously poll prices and trigger exits."""
        while self._running:
            try:
                await self._check_all_positions()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Monitor loop error: {exc}")
            await asyncio.sleep(self.poll_interval)

    async def _check_all_positions(self) -> None:
        """Fetch current prices for all open positions and check SL/TP."""
        if not self._positions:
            return

        # Group positions by token address to batch price fetches
        token_map: dict[str, list[Position]] = {}
        for pos in self._positions.values():
            token_map.setdefault(pos.token_address, []).append(pos)

        for token_address, positions in token_map.items():
            price = await self._fetch_price(token_address)
            if price is None:
                continue
            for pos in positions:
                pos.update_price(price)
                reason = self._check_exit(pos)
                if reason and self.exit_callback:
                    try:
                        await self.exit_callback(pos, reason)
                    except Exception as exc:
                        logger.error(f"Exit callback failed for {pos.id[:8]}: {exc}")

    def _check_exit(self, pos: Position) -> Optional[str]:
        """Return ``"stop_loss"`` / ``"take_profit"`` if exit should trigger."""
        if pos.status != PositionStatus.OPEN:
            return None
        if pos.current_price <= pos.stop_loss_price:
            return "stop_loss"
        if pos.current_price >= pos.take_profit_price:
            return "take_profit"
        return None

    # --------------------------- DexScreener ------------------------------- #
    async def _fetch_price(self, token_address: str) -> Optional[float]:
        """Fetch the current USD price for a token from DexScreener."""
        if self._session is None:
            self._session = aiohttp.ClientSession()
        try:
            url = f"{DEXSCREENER_API}/latest/dex/tokens/{token_address}"
            async with self._session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    logger.warning(f"DexScreener {resp.status} for {token_address}")
                    return None
                data = await resp.json()
                pairs = data.get("pairs") or []
                if not pairs:
                    return None
                # Use the first pair's priceUsd
                price_str = pairs[0].get("priceUsd")
                if price_str is None:
                    return None
                return float(price_str)
        except asyncio.TimeoutError:
            logger.warning(f"DexScreener timeout for {token_address}")
        except Exception as exc:
            logger.warning(f"Price fetch error for {token_address}: {exc}")
        return None

    # --------------------------- snapshot ---------------------------------- #
    def snapshot(self) -> list[dict[str, Any]]:
        """Return a JSON-serialisable snapshot of all open positions."""
        return [p.to_dict() for p in self._positions.values()]
