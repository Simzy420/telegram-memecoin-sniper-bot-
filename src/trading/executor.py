"""Async trade execution orchestrator.

Pipeline::

    receive token + safety result
        → calculate position size
        → get Jupiter quote
        → set slippage
        → execute swap (with retry & adjusted slippage)
        → track confirmation
        → record position
        → set stop-loss
        → notify

Uses aiohttp for all Jupiter API calls and delegates signing / broadcast
to :class:`WalletManager`.
"""
from __future__ import annotations

import asyncio
import base64
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import aiohttp
from loguru import logger

from src.trading.wallet import WalletManager
from src.trading.position import Position, PositionTracker, PositionStatus
from src.analytics.tracker import AnalyticsTracker
from src.archives.writer import TradeArchiveWriter

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
JUPITER_API = os.getenv("JUPITER_API_URL", "https://quote-api.jup.ag/v6")
SOL_MINT = "So11111111111111111111111111111111111111112"
MAX_RETRIES = int(os.getenv("TRADE_MAX_RETRIES", "3"))
SOL_PRICE_USD_FALLBACK = 150.0  # used if we can't fetch SOL price


# --------------------------------------------------------------------------- #
# Result objects
# --------------------------------------------------------------------------- #
@dataclass
class SafetyResult:
    """Minimal safety result interface (mirrors src.safety module)."""

    safe: bool
    safety_score: int
    liquidity_usd: float
    reasons: list[str] = field(default_factory=list)
    token_address: str = ""
    token_symbol: str = ""
    chain: str = "solana"


@dataclass
class TradeResult:
    """Outcome of a trade execution attempt."""

    success: bool
    user_id: int
    token_address: str
    token_symbol: str
    side: str  # "buy" | "sell"
    amount_sol: float
    price_usd: float
    quantity: float
    tx_signature: str = ""
    position_id: str = ""
    error: str = ""
    attempts: int = 0
    slippage_used: float = 0.0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "user_id": self.user_id,
            "token_address": self.token_address,
            "token_symbol": self.token_symbol,
            "side": self.side,
            "amount_sol": self.amount_sol,
            "price_usd": self.price_usd,
            "quantity": self.quantity,
            "tx_signature": self.tx_signature,
            "position_id": self.position_id,
            "error": self.error,
            "attempts": self.attempts,
            "slippage_used": self.slippage_used,
            "timestamp": self.timestamp,
        }


# --------------------------------------------------------------------------- #
# Notification callback
# --------------------------------------------------------------------------- #
NotifyCallback = Any  # callable(user_id: int, message: str, **kwargs)


# --------------------------------------------------------------------------- #
# Executor
# --------------------------------------------------------------------------- #
class TradeExecutor:
    """Orchestrates the full buy/sell pipeline via Jupiter aggregator.

    Args:
        wallet_manager:  handles signing & broadcast
        position_tracker: tracks open positions
        analytics:        records trades to SQLite
        archives:         optional daily trade-archive writer (UTC day folders)
        notify:           async callable ``notify(user_id, message)``
        max_position_sol: hard cap per trade (safety)
        default_slippage: starting slippage percentage
        max_retries:      retry attempts on failed swaps
    """

    def __init__(
        self,
        wallet_manager: WalletManager,
        position_tracker: PositionTracker,
        analytics: AnalyticsTracker,
        notify: Optional[NotifyCallback] = None,
        archives: Optional[TradeArchiveWriter] = None,
        max_position_sol: float = 0.5,
        default_slippage: float = 10.0,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.wallet = wallet_manager
        self.positions = position_tracker
        self.analytics = analytics
        self.archives = archives
        self.notify = notify
        self.max_position_sol = max_position_sol
        self.default_slippage = default_slippage
        self.max_retries = max_retries
        self._session: Optional[aiohttp.ClientSession] = None

    # --------------------------- lifecycle -------------------------------- #
    async def init(self) -> None:
        self._session = aiohttp.ClientSession()

    async def close(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    @property
    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            raise RuntimeError("TradeExecutor not initialised — call init()")
        return self._session

    # --------------------------- public API ------------------------------- #
    async def execute_buy(
        self,
        user_id: int,
        token_address: str,
        token_symbol: str,
        safety: SafetyResult,
        amount_sol: Optional[float] = None,
        chain: str = "solana",
    ) -> TradeResult:
        """Execute a buy order through Jupiter.

        If *amount_sol* is ``None`` the executor calculates a position size
        based on the user's tier and safety score.
        """
        # 0 — Safety gate
        if not safety.safe:
            result = TradeResult(
                success=False, user_id=user_id,
                token_address=token_address, token_symbol=token_symbol,
                side="buy", amount_sol=0, price_usd=0, quantity=0,
                error=f"Token failed safety check: {safety.reasons}",
            )
            self._archive_guard_block(result, safety, chain)
            return result

        # 1 — Calculate position size
        if amount_sol is None:
            amount_sol = self._calculate_position_size(safety)
        amount_sol = min(amount_sol, self.max_position_sol)

        if amount_sol <= 0:
            return TradeResult(
                success=False, user_id=user_id,
                token_address=token_address, token_symbol=token_symbol,
                side="buy", amount_sol=0, price_usd=0, quantity=0,
                error="Calculated position size is zero",
            )

        # 2 — Notify start
        await self._notify(
            user_id,
            f"🎯 <b>Sniping {token_symbol}</b>\n"
            f"Size: {amount_sol:.4f} SOL\n"
            f"Safety: {safety.safety_score}/100\n"
            f"Liquidity: ${safety.liquidity_usd:,.0f}\n"
            f"Status: Fetching quote…",
        )

        # 3 — Get quote + execute with retry
        result = await self._swap_with_retry(
            user_id=user_id,
            input_mint=SOL_MINT,
            output_mint=token_address,
            amount_sol=amount_sol,
            token_symbol=token_symbol,
            side="buy",
            chain=chain,
        )

        if not result.success:
            await self._notify(
                user_id,
                f"❌ <b>Buy failed</b> — {token_symbol}\n"
                f"Error: {result.error}\nAttempts: {result.attempts}",
            )
            self._archive_sniper_result(result, safety, chain, venue="jupiter")
            return result

        # 4 — Record position
        position = await self.positions.open_position(
            user_id=user_id,
            token_address=token_address,
            token_symbol=token_symbol,
            entry_price=result.price_usd,
            size_sol=amount_sol,
            quantity=result.quantity,
            chain=chain,
            tx_signature=result.tx_signature,
        )
        result.position_id = position.id

        # 5 — Record to analytics
        await self.analytics.record_trade(
            user_id=user_id,
            token_address=token_address,
            token_symbol=token_symbol,
            side="buy",
            amount_sol=amount_sol,
            price_usd=result.price_usd,
            quantity=result.quantity,
            tx_signature=result.tx_signature,
            status="confirmed",
            position_id=position.id,
            chain=chain,
        )

        # 6 — Notify success
        await self._notify(
            user_id,
            f"✅ <b>Position opened</b> — {token_symbol}\n"
            f"Entry: ${result.price_usd:.8f}\n"
            f"Size: {amount_sol:.4f} SOL\n"
            f"Qty: {result.quantity:,.2f}\n"
            f"TX: <code>{result.tx_signature[:20]}…</code>\n"
            f"SL: ${position.stop_loss_price:.8f}\n"
            f"TP: ${position.take_profit_price:.8f}",
        )

        self._archive_sniper_result(result, safety, chain, venue="jupiter")
        return result

    async def execute_sell(
        self,
        user_id: int,
        position_id: str,
        reason: str = "manual",
    ) -> TradeResult:
        """Execute a sell (close position) through Jupiter."""
        pos = self.positions.get_position(position_id)
        if pos is None:
            return TradeResult(
                success=False, user_id=user_id,
                token_address="", token_symbol="", side="sell",
                amount_sol=0, price_usd=0, quantity=0,
                error="Position not found",
            )

        await self._notify(
            user_id,
            f"🔄 <b>Closing position</b> — {pos.token_symbol}\n"
            f"Reason: {reason}\nStatus: Selling…",
        )

        result = await self._swap_with_retry(
            user_id=user_id,
            input_mint=pos.token_address,
            output_mint=SOL_MINT,
            amount_sol=0,  # not used for sells; we swap full quantity
            token_symbol=pos.token_symbol,
            side="sell",
            chain=pos.chain,
            swap_amount_tokens=pos.quantity,
        )

        if not result.success:
            await self._notify(
                user_id,
                f"❌ <b>Sell failed</b> — {pos.token_symbol}\nError: {result.error}",
            )
            self._archive_sniper_result(result, None, pos.chain, venue="jupiter")
            return result

        # Close position
        status = PositionStatus.CLOSED
        if reason == "stop_loss":
            status = PositionStatus.STOP_LOSS
        elif reason == "take_profit":
            status = PositionStatus.TAKE_PROFIT

        closed = await self.positions.close_position(
            position_id, result.price_usd, status
        )

        pnl_usd = closed.pnl_usd if closed else 0.0
        pnl_pct = closed.pnl_pct if closed else 0.0

        # Record to analytics
        await self.analytics.record_trade(
            user_id=user_id,
            token_address=pos.token_address,
            token_symbol=pos.token_symbol,
            side="sell",
            amount_sol=pos.size_sol,
            price_usd=result.price_usd,
            quantity=pos.quantity,
            tx_signature=result.tx_signature,
            status="closed",
            pnl_usd=pnl_usd,
            pnl_pct=pnl_pct,
            position_id=position_id,
            chain=pos.chain,
        )

        emoji = "🟢" if pnl_usd >= 0 else "🔴"
        await self._notify(
            user_id,
            f"{emoji} <b>Position closed</b> — {pos.token_symbol}\n"
            f"Exit: ${result.price_usd:.8f}\n"
            f"P&L: {pnl_pct:+.2f}% (${pnl_usd:+.2f})\n"
            f"Reason: {reason}\n"
            f"TX: <code>{result.tx_signature[:20]}…</code>",
        )

        self._archive_sniper_result(
            result, None, pos.chain, venue="jupiter", pnl_usd=pnl_usd, notes=reason
        )
        return result

    # --------------------------- internal --------------------------------- #
    def _calculate_position_size(self, safety: SafetyResult) -> float:
        """Position sizing: scale down with lower safety scores."""
        base = self.max_position_sol
        # Scale: score 100 → full size, score 50 → 25% size
        if safety.safety_score >= 80:
            return base
        elif safety.safety_score >= 65:
            return base * 0.75
        elif safety.safety_score >= 50:
            return base * 0.5
        else:
            return base * 0.25

    async def _swap_with_retry(
        self,
        user_id: int,
        input_mint: str,
        output_mint: str,
        amount_sol: float,
        token_symbol: str,
        side: str,
        chain: str,
        swap_amount_tokens: Optional[float] = None,
    ) -> TradeResult:
        """Attempt a Jupiter swap with retry logic and slippage adjustment.

        On each retry the slippage is bumped by 50% (capped at 50%).
        """
        slippage = self.default_slippage
        last_error = ""

        for attempt in range(1, self.max_retries + 1):
            try:
                # Get quote
                quote = await self._get_jupiter_quote(
                    input_mint=input_mint,
                    output_mint=output_mint,
                    amount_sol=amount_sol,
                    slippage_pct=slippage,
                    swap_amount_tokens=swap_amount_tokens,
                )
                if quote is None:
                    last_error = "Failed to get Jupiter quote"
                    logger.warning(f"[attempt {attempt}] {last_error} for {token_symbol}")
                    slippage = min(slippage * 1.5, 50.0)
                    continue

                # Get swap transaction
                swap_tx_b64 = await self._get_jupiter_swap_tx(quote, user_id)
                if swap_tx_b64 is None:
                    last_error = "Failed to get swap transaction from Jupiter"
                    slippage = min(slippage * 1.5, 50.0)
                    continue

                # Sign + broadcast (custodial) or return unsigned (non-custodial)
                tx_bytes = base64.b64decode(swap_tx_b64)
                tx_sig = await self.wallet.sign_and_broadcast(user_id, tx_bytes)

                # Confirm
                confirmed = await self._confirm_tx(tx_sig)
                if not confirmed:
                    last_error = f"Transaction not confirmed: {tx_sig}"
                    slippage = min(slippage * 1.5, 50.0)
                    continue

                # Parse result
                out_amount = int(quote.get("outAmount", 0))
                price_usd = float(quote.get("price", 0)) or 0.0

                if side == "buy":
                    # outAmount is token units; convert to float quantity
                    quantity = out_amount / (10 ** 6)  # assume 6 decimals default
                else:
                    quantity = swap_amount_tokens or 0.0
                    # price_usd for sells is the token price
                    if price_usd == 0.0:
                        price_usd = 0.0

                return TradeResult(
                    success=True,
                    user_id=user_id,
                    token_address=output_mint if side == "buy" else input_mint,
                    token_symbol=token_symbol,
                    side=side,
                    amount_sol=amount_sol,
                    price_usd=price_usd,
                    quantity=quantity,
                    tx_signature=tx_sig,
                    attempts=attempt,
                    slippage_used=slippage,
                )

            except Exception as exc:
                last_error = str(exc)
                logger.error(f"[attempt {attempt}] Swap error for {token_symbol}: {exc}")
                slippage = min(slippage * 1.5, 50.0)
                await asyncio.sleep(2 * attempt)  # backoff

        return TradeResult(
            success=False,
            user_id=user_id,
            token_address=output_mint if side == "buy" else input_mint,
            token_symbol=token_symbol,
            side=side,
            amount_sol=amount_sol,
            price_usd=0,
            quantity=0,
            error=last_error,
            attempts=self.max_retries,
            slippage_used=slippage,
        )

    async def _get_jupiter_quote(
        self,
        input_mint: str,
        output_mint: str,
        amount_sol: float,
        slippage_pct: float,
        swap_amount_tokens: Optional[float] = None,
    ) -> Optional[dict[str, Any]]:
        """Fetch a quote from Jupiter Quote API."""
        # For buys: amount in lamports (SOL → token)
        # For sells: amount in token base units
        if swap_amount_tokens is not None:
            amount = int(swap_amount_tokens * (10 ** 6))  # assume 6 decimals
        else:
            amount = int(amount_sol * 1_000_000_000)  # SOL → lamports

        params = {
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": amount,
            "slippageBps": int(slippage_pct * 100),  # bps = pct * 100
            "swapMode": "ExactIn",
        }
        try:
            async with self.session.get(
                f"{JUPITER_API}/quote", params=params,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"Jupiter quote {resp.status}: {await resp.text()}")
                    return None
                return await resp.json()
        except Exception as exc:
            logger.warning(f"Jupiter quote error: {exc}")
            return None

    async def _get_jupiter_swap_tx(
        self, quote: dict[str, Any], user_id: int
    ) -> Optional[str]:
        """POST the quote to Jupiter swap endpoint to get a serialised tx.

        Returns base64-encoded unsigned ``VersionedTransaction``.
        """
        wallet_info = await self.wallet.get_wallet_info(user_id)
        if wallet_info is None:
            logger.error(f"No wallet for user {user_id}")
            return None

        payload = {
            "quoteResponse": quote,
            "userPublicKey": wallet_info.public_key,
            "wrapUnwrapSOL": True,
            "computeUnitPriceMicroLamports": 500_000,  # priority fee
        }
        try:
            async with self.session.post(
                f"{JUPITER_API}/swap",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    logger.warning(f"Jupiter swap {resp.status}: {await resp.text()}")
                    return None
                data = await resp.json()
                return data.get("swapTransaction")
        except Exception as exc:
            logger.warning(f"Jupiter swap tx error: {exc}")
            return None

    async def _confirm_tx(self, tx_sig: str, timeout: int = 60) -> bool:
        """Poll the RPC until the transaction is confirmed or timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                resp = await self.wallet.client.get_signature_statuses([tx_sig])
                status = resp.value[0] if resp.value else None
                if status is not None:
                    if status.confirmation_status in ("confirmed", "finalized"):
                        return True
                    if status.err:
                        logger.warning(f"Tx {tx_sig} failed: {status.err}")
                        return False
            except Exception as exc:
                logger.warning(f"Confirm check error: {exc}")
            await asyncio.sleep(2)
        logger.warning(f"Tx {tx_sig} confirmation timeout")
        return False

    async def _notify(self, user_id: int, message: str) -> None:
        """Send a notification if a callback is configured."""
        if self.notify:
            try:
                await self.notify(user_id, message)
            except Exception as exc:
                logger.warning(f"Notify callback error: {exc}")

    def _archive_sniper_result(
        self,
        result: TradeResult,
        safety: Optional[SafetyResult],
        chain: str,
        *,
        venue: str,
        pnl_usd: Optional[float] = None,
        notes: str = "",
    ) -> None:
        """Record a real execution attempt. Does not invent fills."""
        if self.archives is None:
            return
        guard: dict[str, Any] = {}
        if safety is not None:
            guard = {
                "score": safety.safety_score,
                "passed": safety.safe,
                "reasons": list(safety.reasons),
                "liquidity_usd": safety.liquidity_usd,
            }
        try:
            self.archives.record_event(
                {
                    "specialist": "sniper",
                    "chain": chain,
                    "venue": venue,
                    "token": {
                        "address": result.token_address,
                        "symbol": result.token_symbol,
                    },
                    "side": result.side,
                    "size": result.amount_sol,
                    "size_unit": "SOL",
                    "price": result.price_usd,
                    "tx_id": result.tx_signature,
                    "order_id": result.position_id,
                    "guard_checks": guard,
                    "outcome": "filled" if result.success else "failed",
                    "pnl_usd": pnl_usd,
                    "notes": notes or result.error,
                }
            )
        except Exception as exc:
            logger.warning(f"Trade archive write failed: {exc}")

    def _archive_guard_block(
        self, result: TradeResult, safety: SafetyResult, chain: str
    ) -> None:
        """Record a real Guard block. Does not invent a fill."""
        if self.archives is None:
            return
        try:
            self.archives.record_event(
                {
                    "specialist": "guard",
                    "chain": chain,
                    "venue": "",
                    "token": {
                        "address": result.token_address,
                        "symbol": result.token_symbol,
                    },
                    "outcome": "blocked",
                    "guard_checks": {
                        "score": safety.safety_score,
                        "passed": False,
                        "reasons": list(safety.reasons),
                        "liquidity_usd": safety.liquidity_usd,
                    },
                    "notes": result.error,
                }
            )
        except Exception as exc:
            logger.warning(f"Trade archive write failed: {exc}")
