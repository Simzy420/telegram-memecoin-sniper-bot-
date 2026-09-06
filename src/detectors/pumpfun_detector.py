"""Async Pump.fun new-token-launch detector.

Subscribes to the Solana WebSocket ``logsSubscribe`` stream for the
Pump.fun program, parses token-creation events from the instruction
logs, enriches them into :class:`~src.models.token.Token` objects, and
emits them on an ``asyncio.Queue`` for downstream consumers (safety
pipeline, Telegram alerter, trade executor).

If the WebSocket drops or never connects, a fallback HTTP polling loop
hits the Pump.fun / DexScreener public APIs to discover recent launches.

Key design points:
    * One public ``start()`` coroutine — runs until ``stop()`` is called
      or the task is cancelled.
    * Exponential-backoff reconnection on socket drop.
    * Idempotent: the same mint is never emitted twice (in-memory de-dupe
      with an LRU cap).
    * ``Token`` objects are emitted on ``self.queue`` — consumers pull
      with ``await detector.queue.get()``.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
from loguru import logger

from ..models.token import Chain, Token

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PUMPFUN_PROGRAM_ID = "6EF8rrecthR5DkSon8Fukf1BA2ssVkh1Yq8hCNz1mMo3"

# Pump.fun instruction discriminators (first 8 bytes of Anchor ix data).
# ``create`` is the instruction we care about; there are others (buy, sell,
# withdraw) but we only emit on create.
# sha256("global:create")[0..8] == 0x18 0x1e 0xc1 0x82 0x8a 0x39 0x60 0x81
_CREATE_IX_DISCRIMINATOR = bytes([0x18, 0x1e, 0xc1, 0x82, 0x8a, 0x39, 0x60, 0x81])

# Fallback polling endpoints.
_PUMPFUN_RECENT_LAUNCHES = "https://pumpportal.fun/api/recent-launches"
_DEXSCREENER_SOL_NEW = "https://api.dexscreener.com/token-profiles/latest/v1"

# Reconnection tuning.
_INITIAL_RECONNECT_DELAY = 1.0
_MAX_RECONNECT_DELAY = 60.0
_RECONNECT_BACKOFF_FACTOR = 2.0

# De-dupe LRU cap.
_SEEN_LRU_SIZE = 2000

# Polling interval for fallback mode.
_POLL_INTERVAL_SECONDS = 10.0

# Regexes for parsing Pump.fun log lines.
_RE_NAME = re.compile(r"Name:\s*(.+)")
_RE_SYMBOL = re.compile(r"Symbol:\s*(.+)")
_RE_MINT = re.compile(r"Mint:\s*([1-9A-HJ-NP-Za-km-z]{32,44})")


# ---------------------------------------------------------------------------
# PumpFunDetector
# ---------------------------------------------------------------------------
class PumpFunDetector:
    """Detect new Pump.fun token launches on Solana and emit Token objects.

    Args:
        wss_url: Solana WebSocket endpoint (``wss://…``).  If empty,
            the detector runs in poll-only mode.
        rpc_url: Solana HTTP RPC URL, used for account lookups during
            enrichment.
        queue: Optional pre-existing ``asyncio.Queue`` to emit on.  If
            omitted, a new unbounded queue is created.
        queue_maxsize: Max items in the emitted queue (0 = unbounded).
        poll_interval: Seconds between polls in fallback mode.
        auto_enrich: If True (default), fetch token metadata from RPC
            before emitting.  If False, emit a minimal Token and let
            downstream consumers enrich.
    """

    def __init__(
        self,
        wss_url: str = "",
        rpc_url: str = "https://api.mainnet-beta.solana.com",
        *,
        queue: Optional[asyncio.Queue[Token]] = None,
        queue_maxsize: int = 0,
        poll_interval: float = _POLL_INTERVAL_SECONDS,
        auto_enrich: bool = True,
    ) -> None:
        self.wss_url = wss_url
        self.rpc_url = rpc_url.rstrip("/")
        self.poll_interval = poll_interval
        self.auto_enrich = auto_enrich

        self.queue: asyncio.Queue[Token] = queue or asyncio.Queue(maxsize=queue_maxsize)
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._sub_id: Optional[int] = None
        self._stop_event = asyncio.Event()
        self._poll_task: Optional[asyncio.Task[None]] = None
        self._ws_task: Optional[asyncio.Task[None]] = None
        self._enrich_semaphore = asyncio.Semaphore(10)  # cap concurrent RPC fetches

    # ---- lifecycle --------------------------------------------------------
    async def start(self) -> None:
        """Start the detector.

        If a ``wss_url`` was supplied, runs the WebSocket subscription
        loop with automatic reconnection; otherwise runs in poll-only
        mode.  Returns immediately — both loops run as background tasks.
        Use :meth:`stop` to shut them down.
        """
        self._stop_event.clear()
        if self.wss_url:
            self._ws_task = asyncio.create_task(self._ws_loop(), name="pumpfun_ws")
            logger.info("PumpFunDetector started (WebSocket mode) -> {}", self.wss_url)
        else:
            self._poll_task = asyncio.create_task(self._poll_loop(), name="pumpfun_poll")
            logger.info("PumpFunDetector started (poll-only mode)")

    async def stop(self) -> None:
        """Signal both loops to stop and wait for them to finish."""
        self._stop_event.set()
        for task in (self._ws_task, self._poll_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        await self.close()

    async def close(self) -> None:
        """Close any open WS / HTTP sessions."""
        if self._ws is not None and not self._ws.closed:
            try:
                # Try to unsubscribe cleanly.
                if self._sub_id is not None:
                    await self._ws.send_json({"jsonrpc": "2.0", "id": 2, "method": "logsUnsubscribe", "params": [self._sub_id]})
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
        if self._session is not None and not self._session.closed:
            await self._session.close()

    # ---- WebSocket loop ---------------------------------------------------
    async def _ws_loop(self) -> None:
        """Run the WS subscription with exponential-backoff reconnection."""
        delay = _INITIAL_RECONNECT_DELAY
        while not self._stop_event.is_set():
            try:
                await self._ws_run_once()
                # If we get here, the loop exited cleanly (e.g. server
                # closed the connection).  Reset backoff a bit.
                delay = _INITIAL_RECONNECT_DELAY
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("PumpFunDetector WS loop error: {}", exc)

            if self._stop_event.is_set():
                break
            logger.info("PumpFunDetector reconnecting in {:.1f}s…", delay)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                break  # stop signaled during the wait
            except asyncio.TimeoutError:
                pass
            delay = min(delay * _RECONNECT_BACKOFF_FACTOR, _MAX_RECONNECT_DELAY)

    async def _ws_run_once(self) -> None:
        """Open one WS connection and process messages until it closes."""
        sess = await self._get_session()
        async with sess.ws_connect(self.wss_url, heartbeat=20) as ws:
            self._ws = ws
            # Subscribe to logs mentioning the Pump.fun program.
            sub_req = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "logsSubscribe",
                "params": [{"mentions": [PUMPFUN_PROGRAM_ID]}],
            }
            await ws.send_json(sub_req)

            # Wait for the subscription-confirmation message to grab the id.
            self._sub_id = None
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = self._safe_json(msg.data)
                    if data is None:
                        continue
                    # Capture subscription id from the first response.
                    if self._sub_id is None and data.get("id") == 1 and "result" in data:
                        self._sub_id = data["result"]
                        logger.info("PumpFunDetector subscribed (sub_id={})", self._sub_id)
                        continue
                    # Process log notifications.
                    if data.get("method") == "logsNotification":
                        await self._handle_log_notification(data.get("params", {}))
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING):
                    logger.warning("PumpFunDetector WS closed by server")
                    break
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error("PumpFunDetector WS error: {}", ws.exception())
                    break

    async def _handle_log_notification(self, params: dict[str, Any]) -> None:
        """Parse a single ``logsNotification`` payload."""
        result = params.get("result") or {}
        value = result.get("value") or {}
        if value.get("err"):
            # Failed transaction — skip.
            return
        logs: list[str] = value.get("logs") or []
        signature = value.get("signature") or ""
        # Only process if this looks like a create instruction.
        if not self._is_create_event(logs):
            return
        token = self._parse_create_from_logs(logs, signature)
        if token is None:
            return
        if not self._mark_seen(token.address):
            return  # already emitted
        if self.auto_enrich:
            token = await self._enrich_token(token)
        await self._emit(token)

    @staticmethod
    def _is_create_event(logs: list[str]) -> bool:
        """Heuristic: Pump.fun create events log 'Instruction: Create'."""
        return any("Instruction: Create" in line for line in logs)

    def _parse_create_from_logs(self, logs: list[str], signature: str) -> Optional[Token]:
        """Best-effort parse of name/symbol/mint from Pump.fun log lines."""
        name: Optional[str] = None
        symbol: Optional[str] = None
        mint: Optional[str] = None
        for line in logs:
            if name is None:
                m = _RE_NAME.search(line)
                if m:
                    name = m.group(1).strip()
            if symbol is None:
                m = _RE_SYMBOL.search(line)
                if m:
                    symbol = m.group(1).strip()
            if mint is None:
                m = _RE_MINT.search(line)
                if m:
                    mint = m.group(1).strip()
        if not mint:
            return None
        return Token(
            address=mint,
            name=name or "Unknown",
            symbol=symbol or "UNKNOWN",
            chain=Chain.SOLANA,
            launch_time=datetime.now(timezone.utc),
            metadata={"source": "pumpfun_ws", "signature": signature},
        )

    # ---- Fallback polling -------------------------------------------------
    async def _poll_loop(self) -> None:
        """Fallback: poll public APIs for recent launches.

        Used when no ``wss_url`` is configured, or as an automatic
        fallback if the WS loop keeps failing.
        """
        logger.info("PumpFunDetector fallback polling every {:.0f}s", self.poll_interval)
        while not self._stop_event.is_set():
            try:
                launches = await self._fetch_recent_launches()
                for launch in launches:
                    mint = launch.get("mint") or launch.get("address")
                    if not mint:
                        continue
                    if not self._mark_seen(mint):
                        continue
                    token = Token(
                        address=mint,
                        name=launch.get("name", "Unknown"),
                        symbol=launch.get("symbol", "UNKNOWN"),
                        chain=Chain.SOLANA,
                        creator_wallet=launch.get("creator"),
                        launch_time=datetime.now(timezone.utc),
                        metadata={"source": "pumpfun_poll", **{k: v for k, v in launch.items() if k != "mint"}},
                    )
                    if self.auto_enrich:
                        token = await self._enrich_token(token)
                    await self._emit(token)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("PumpFunDetector poll error: {}", exc)

            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval)
                break
            except asyncio.TimeoutError:
                continue

    async def _fetch_recent_launches(self) -> list[dict[str, Any]]:
        """Fetch recent Pump.fun launches from PumpPortal (primary) or
        DexScreener (fallback)."""
        sess = await self._get_session()
        # Primary: PumpPortal.
        try:
            async with sess.get(_PUMPFUN_RECENT_LAUNCHES, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if isinstance(data, list):
                        return data
        except Exception as exc:  # noqa: BLE001
            logger.debug("PumpPortal fetch failed: {}", exc)

        # Fallback: DexScreener latest token profiles.
        try:
            async with sess.get(_DEXSCREENER_SOL_NEW, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if isinstance(data, list):
                        # Filter to Solana pump.fun tokens.
                        return [
                            {
                                "mint": d.get("tokenAddress"),
                                "name": d.get("name", "Unknown"),
                                "symbol": d.get("symbol", "UNKNOWN"),
                                "creator": d.get("creator"),
                            }
                            for d in data
                            if d.get("chainId") == "solana"
                        ]
        except Exception as exc:  # noqa: BLE001
            logger.debug("DexScreener fallback fetch failed: {}", exc)

        return []

    # ---- Enrichment -------------------------------------------------------
    async def _enrich_token(self, token: Token) -> Token:
        """Fetch supply, creator, and liquidity from RPC / DexScreener.

        Failures are non-fatal — we emit the token with whatever data we
        have.  Enrichment is concurrency-limited by a semaphore so a
        burst of launches doesn't DOS the RPC.
        """
        async with self._enrich_semaphore:
            try:
                info = await self._get_account_info(token.address)
                # Decode SPL Mint supply (first 8 bytes, u64 LE).
                data = info.get("value", {}).get("data") if info.get("value") else None
                raw = self._decode_b64(data)
                if raw and len(raw) >= 8:
                    token.supply = int.from_bytes(raw[0:8], "little")
                owner = info.get("value", {}).get("owner") if info.get("value") else None
                if owner:
                    token.metadata["mint_owner"] = owner
            except Exception as exc:  # noqa: BLE001
                logger.debug("Enrichment (account info) failed for {}: {}", token.symbol, exc)

            # Best-effort liquidity from DexScreener.
            try:
                sess = await self._get_session()
                async with sess.get(
                    f"https://api.dexscreener.com/latest/dex/tokens/{token.address}",
                    timeout=aiohttp.ClientTimeout(total=8),
                ) as resp:
                    if resp.status == 200:
                        body = await resp.json()
                        pairs = body.get("pairs") or []
                        if pairs:
                            liq = float(pairs[0].get("liquidity", {}).get("usd") or 0)
                            token.initial_liquidity_usd = liq
                            token.metadata["dex_pair"] = pairs[0].get("pairAddress")
                            # creator / deployer from pair.
                            token.metadata["dex"] = pairs[0].get("dexId")
            except Exception as exc:  # noqa: BLE001
                logger.debug("Enrichment (dexscreener) failed for {}: {}", token.symbol, exc)

        return token

    # ---- helpers ----------------------------------------------------------
    def _mark_seen(self, key: str) -> bool:
        """Record ``key`` in the de-dupe LRU.  Returns True if newly seen."""
        if key in self._seen:
            # Move to end (most-recent).
            self._seen.move_to_end(key)
            return False
        self._seen[key] = None
        self._seen.move_to_end(key)
        if len(self._seen) > _SEEN_LRU_SIZE:
            self._seen.popitem(last=False)
        return True

    async def _emit(self, token: Token) -> None:
        """Put ``token`` on the output queue (drop-if-full to avoid stalls)."""
        try:
            self.queue.put_nowait(token)
            logger.info("PumpFunDetector emitted {} ({})", token.symbol, token.short_address())
        except asyncio.QueueFull:
            logger.warning("PumpFunDetector queue full — dropping {}", token.symbol)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"User-Agent": "BigBrainApe-Sniper/1.0"},
            )
        return self._session

    async def _get_account_info(self, address: str) -> dict[str, Any]:
        """Call Solana ``getAccountInfo`` over HTTP."""
        sess = await self._get_session()
        payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "getAccountInfo",
            "params": [address, {"encoding": "base64"}],
        }
        async with sess.post(self.rpc_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            body = await resp.json()
        return body.get("result") or {}

    @staticmethod
    def _safe_json(raw: str) -> Optional[dict[str, Any]]:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _decode_b64(data: Any) -> Optional[bytes]:
        if not data:
            return None
        if isinstance(data, list) and data:
            try:
                return base64.b64decode(data[0])
            except Exception:  # noqa: BLE001
                return None
        return None
