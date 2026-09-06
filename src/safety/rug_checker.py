"""Rug-pull detection safety pipeline.

Takes a :class:`~src.models.token.Token`, runs every safety check in
sequence, and returns a :class:`~src.safety.score.SafetyResult` with a
0-100 score and per-check reasoning.

Design rules:
    * Every check is its own async method so they can be run in parallel
      later if desired (currently sequential for predictability).
    * If a backing service (RPC, RugCheck.xyz, Birdeye, …) is unreachable
      the check returns ``SKIP`` — never FAIL — so a transient outage
      doesn't black-hole every token.
    * Each check returns a :class:`CheckResult` with a human-readable
      ``reason`` so the Telegram bot can show *why* a token scored the
      way it did.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
from loguru import logger

from ..models.token import Chain, Token
from .score import (
    CheckResult,
    CheckStatus,
    ScoringConfig,
    SafetyResult,
    build_result,
    compute_score,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Default timeout for outbound HTTP calls (RugCheck, Birdeye, DexScreener).
_HTTP_TIMEOUT_SECONDS = 10.0

# Third-party APIs (all have free tiers).
_RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/{addr}/report"
_BIRDEYE_API = "https://public-api.birdeye.so/defi/token_overview?address={addr}"
_DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/{addr}"


# ---------------------------------------------------------------------------
# RugChecker
# ---------------------------------------------------------------------------
class RugChecker:
    """Run the full safety pipeline against a token.

    Usage::

        checker = RugChecker(rpc_url="https://api.mainnet-beta.solana.com")
        result = await checker.check(token)
        if result.is_safe:
            ...  # green-light for auto-snipe
    """

    def __init__(
        self,
        rpc_url: str = "https://api.mainnet-beta.solana.com",
        *,
        config: Optional[ScoringConfig] = None,
        session: Optional[aiohttp.ClientSession] = None,
        timeout: float = _HTTP_TIMEOUT_SECONDS,
        user_agent: str = "BigBrainApe-Sniper/1.0",
    ) -> None:
        self.rpc_url = rpc_url.rstrip("/")
        self.config = config or ScoringConfig()
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._user_agent = user_agent
        self._session = session  # may be None; created lazily
        self._owns_session = session is None

    # ---- public API -------------------------------------------------------
    async def check(self, token: Token) -> SafetyResult:
        """Run every check against ``token`` and return a SafetyResult."""
        start = time.perf_counter()
        logger.info("Running safety pipeline for {} ({})", token.symbol, token.short_address())

        checks: list[CheckResult] = []
        # Sequential — predictable & easy to reason about.  Each check
        # is independent so they could be gathered later.
        for fn in (
            self.liquidity_check,
            self.honeypot_check,
            self.mint_authority_check,
            self.freeze_authority_check,
            self.creator_analysis,
            self.supply_concentration,
        ):
            try:
                res = await fn(token)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — we want every failure mode
                logger.exception("Check {} crashed", fn.__name__)
                res = CheckResult(
                    name=fn.__name__,
                    status=CheckStatus.ERROR,
                    score=0.0,
                    weight=self._weight_for(fn.__name__),
                    reason=f"Check crashed: {exc}",
                )
            checks.append(res)

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        result = build_result(
            token_address=token.address,
            checks=checks,
            run_time_ms=round(elapsed_ms, 1),
            config=self.config,
        )
        result.executed_at = datetime.now(timezone.utc).isoformat()

        # Reflect the score back onto the token for downstream callers.
        token.safety_score = result.score

        logger.info(
            "Safety pipeline done for {}: {} ({}ms)",
            token.symbol, result.summary(), int(elapsed_ms),
        )
        return result

    # ---- individual checks ------------------------------------------------
    async def liquidity_check(self, token: Token) -> CheckResult:
        """Verify the token has enough locked / pooled liquidity.

        Uses DexScreener to pull current liquidity, then compares against
        ``config``-style thresholds.  SKIPs if DexScreener is unreachable.
        """
        weight = self._weight_for("liquidity_check")
        name = "liquidity_check"

        if token.chain == Chain.BASE.value:
            # Base liquidity check would go via Uniswap subgraph; left as
            # a SKIP for now until the Base detector lands.
            return CheckResult(
                name=name, status=CheckStatus.SKIP, score=0.0, weight=weight,
                reason="Liquidity check for Base not yet implemented.",
            )

        try:
            data = await self._fetch_json(_DEXSCREENER_API.format(addr=token.address))
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"DexScreener unavailable: {exc}")

        pairs = data.get("pairs") or []
        if not pairs:
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=0.0, weight=weight,
                reason="No liquidity pairs found on DexScreener.",
                details={"api": "dexscreener"},
            )

        # Sum liquidity across all pairs (token may be on Raydium + Orca).
        liq_usd = 0.0
        for p in pairs:
            liq_usd += float(p.get("liquidity", {}).get("usd") or 0)

        # Cache back onto the token.
        if token.initial_liquidity_usd is None or token.initial_liquidity_usd == 0:
            token.initial_liquidity_usd = liq_usd

        # Scoring bands (tunable).
        if liq_usd >= 50_000:
            status, score, reason = CheckStatus.PASS, 100.0, f"Strong liquidity ${liq_usd:,.0f}."
        elif liq_usd >= 10_000:
            status, score, reason = CheckStatus.PASS, 80.0, f"Adequate liquidity ${liq_usd:,.0f}."
        elif liq_usd >= 5_000:
            status, score, reason = CheckStatus.WARN, 55.0, f"Low liquidity ${liq_usd:,.0f}."
        else:
            status, score, reason = CheckStatus.FAIL, 10.0, f"Insufficient liquidity ${liq_usd:,.0f}."

        return CheckResult(
            name=name, status=status, score=score, weight=weight,
            reason=reason, details={"liquidity_usd": liq_usd, "pairs": len(pairs)},
        )

    async def honeypot_check(self, token: Token) -> CheckResult:
        """Detect honeypot tokens (can buy but can't sell).

        Uses RugCheck.xyz's report endpoint which aggregates multiple
        signals.  SKIPs if the API is unreachable.
        """
        weight = self._weight_for("honeypot_check")
        name = "honeypot_check"

        if token.chain == Chain.BASE.value:
            return CheckResult(
                name=name, status=CheckStatus.SKIP, score=0.0, weight=weight,
                reason="Honeypot check for Base not yet implemented.",
            )

        try:
            report = await self._fetch_json(_RUGCHECK_API.format(addr=token.address))
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"RugCheck unavailable: {exc}")

        # RugCheck returns a 'score' (lower is better) and 'risks' list.
        rug_score = float(report.get("score") or 0)
        risks = report.get("risks") or []

        # Map RugCheck risks to our status.
        critical_risks = [r for r in risks if (r.get("score") or 0) >= 8]
        high_risks = [r for r in risks if 4 <= (r.get("score") or 0) < 8]

        if critical_risks:
            names = ", ".join(r.get("name", "?") for r in critical_risks[:3])
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=5.0, weight=weight,
                reason=f"Critical honeypot risks: {names}.",
                details={"rugcheck_score": rug_score, "critical_risks": len(critical_risks)},
            )

        if high_risks:
            names = ", ".join(r.get("name", "?") for r in high_risks[:3])
            return CheckResult(
                name=name, status=CheckStatus.WARN, score=50.0, weight=weight,
                reason=f"Elevated risks: {names}.",
                details={"rugcheck_score": rug_score, "high_risks": len(high_risks)},
            )

        # No notable risks.
        if rug_score <= 5:
            score = 100.0
        elif rug_score <= 20:
            score = 75.0
        else:
            score = 55.0
        return CheckResult(
            name=name, status=CheckStatus.PASS, score=score, weight=weight,
            reason=f"RugCheck clean (score {rug_score:.0f}).",
            details={"rugcheck_score": rug_score, "risks": len(risks)},
        )

    async def mint_authority_check(self, token: Token) -> CheckResult:
        """Verify mint authority is renounced / burned.

        If the creator can still mint more tokens they can dilute holders
        to zero.  Uses Solana RPC ``getAccountInfo`` on the SPL mint.
        """
        weight = self._weight_for("mint_authority_check")
        name = "mint_authority_check"

        if token.chain == Chain.BASE.value:
            return CheckResult(
                name=name, status=CheckStatus.SKIP, score=0.0, weight=weight,
                reason="Mint authority check not applicable to ERC-20 (supply fixed at deploy).",
            )

        try:
            mint_info = await self._solana_get_account_info(token.address)
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"Solana RPC unavailable: {exc}")

        # SPL Mint account layout: bytes 0..4 = supply, byte 4 = decimals,
        # byte 5 = is_initialized, bytes 5+4..5+4+32 = mint authority (or
        # all-zero = None / renounced).  More precisely, mint authority
        # is a COption<Pubkey>: 4-byte LE option (1=Some, 0=None) + 32-byte key.
        data = mint_info.get("value", {}).get("data", [None, None])
        raw = self._decode_b64_account(data)
        if raw is None or len(raw) < 46:
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=0.0, weight=weight,
                reason="Could not decode mint account data.",
            )

        # COption discriminator at offset 4 (after 8-byte supply) … actually
        # SPL Mint layout: 43-byte header.  Mint authority COption starts at
        # offset 4.  Layout: [0..4] supply u64 LE, [4] decimals u8,
        # [5] is_initialized bool, [6..10] reserved, [10..14] COption u32 LE
        # (1=Some / 0=None), [14..46] mint authority pubkey.
        option = int.from_bytes(raw[10:14], "little") if len(raw) >= 46 else 0
        authority = raw[14:46].hex() if len(raw) >= 46 else ""

        if option == 0 or authority == "0" * 64:
            return CheckResult(
                name=name, status=CheckStatus.PASS, score=100.0, weight=weight,
                reason="Mint authority renounced / burned.",
                details={"mint_authority": None},
            )

        # Authority still live — flag it.
        return CheckResult(
            name=name, status=CheckStatus.FAIL, score=10.0, weight=weight,
            reason="Mint authority NOT renounced — creator can mint more tokens.",
            details={"mint_authority": authority},
        )

    async def freeze_authority_check(self, token: Token) -> CheckResult:
        """Verify freeze authority is renounced.

        A live freeze authority lets the creator freeze holder accounts,
        effectively locking them out of their tokens.  Same SPL layout
        as mint authority, just at a different offset.
        """
        weight = self._weight_for("freeze_authority_check")
        name = "freeze_authority_check"

        if token.chain == Chain.BASE.value:
            return CheckResult(
                name=name, status=CheckStatus.SKIP, score=0.0, weight=weight,
                reason="Freeze authority check not applicable to ERC-20.",
            )

        try:
            mint_info = await self._solana_get_account_info(token.address)
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"Solana RPC unavailable: {exc}")

        data = mint_info.get("value", {}).get("data", [None, None])
        raw = self._decode_b64_account(data)
        if raw is None or len(raw) < 82:
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=0.0, weight=weight,
                reason="Could not decode mint account data.",
            )

        # Freeze authority COption at offset 46..50, pubkey 50..82.
        option = int.from_bytes(raw[46:50], "little")
        authority = raw[50:82].hex()

        if option == 0 or authority == "0" * 64:
            return CheckResult(
                name=name, status=CheckStatus.PASS, score=100.0, weight=weight,
                reason="Freeze authority renounced.",
                details={"freeze_authority": None},
            )

        return CheckResult(
            name=name, status=CheckStatus.FAIL, score=15.0, weight=weight,
            reason="Freeze authority NOT renounced — creator can freeze holders.",
            details={"freeze_authority": authority},
        )

    async def creator_analysis(self, token: Token) -> CheckResult:
        """Heuristic analysis of the creator wallet.

        Looks at how many tokens the creator has launched (serial rug
        deployers) and their on-chain age.  Uses Birdeye for token
        overview; falls back to a mild WARN if we have no creator address.
        """
        weight = self._weight_for("creator_analysis")
        name = "creator_analysis"

        creator = token.creator_wallet
        if not creator:
            return CheckResult(
                name=name, status=CheckStatus.WARN, score=50.0, weight=weight,
                reason="No creator wallet supplied — cannot analyse.",
            )

        # We don't have a free, reliable "tokens by deployer" API in the
        # scaffold, so we use Birdeye's token overview as a proxy: if the
        # token is brand-new with no market activity and a deployer that
        # Birdeye has never seen, that's a mild warning.
        try:
            overview = await self._fetch_json(
                _BIRDEYE_API.format(addr=token.address),
                headers={"X-API-KEY": "", "accept": "application/json"},
            )
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"Birdeye unavailable: {exc}")

        age_hours = self._token_age_hours(token)
        tx_count = int(overview.get("tx", 0) or 0)

        if age_hours < 1 and tx_count < 5:
            return CheckResult(
                name=name, status=CheckStatus.WARN, score=45.0, weight=weight,
                reason=f"Brand-new token (age {age_hours:.1f}h, {tx_count} txs) — high risk.",
                details={"age_hours": age_hours, "tx_count": tx_count},
            )

        if age_hours < 6 and tx_count < 50:
            return CheckResult(
                name=name, status=CheckStatus.WARN, score=60.0, weight=weight,
                reason=f"Very young token (age {age_hours:.1f}h) — limited history.",
                details={"age_hours": age_hours, "tx_count": tx_count},
            )

        return CheckResult(
            name=name, status=CheckStatus.PASS, score=80.0, weight=weight,
            reason=f"Token has some history (age {age_hours:.1f}h, {tx_count} txs).",
            details={"age_hours": age_hours, "tx_count": tx_count},
        )

    async def supply_concentration(self, token: Token) -> CheckResult:
        """Check that supply isn't concentrated in a few wallets.

        Uses RugCheck's ``holders`` data if available; otherwise SKIPs
        (we don't want to mass-RPC-scan holders for every new token).
        """
        weight = self._weight_for("supply_concentration")
        name = "supply_concentration"

        if token.chain == Chain.BASE.value:
            return CheckResult(
                name=name, status=CheckStatus.SKIP, score=0.0, weight=weight,
                reason="Supply concentration check for Base not yet implemented.",
            )

        try:
            report = await self._fetch_json(_RUGCHECK_API.format(addr=token.address))
        except _ServiceUnavailable as exc:
            return self._skip(name, weight, f"RugCheck unavailable: {exc}")

        top_holders = report.get("topHolders") or []
        if not top_holders:
            return self._skip(name, weight, "No holder data returned by RugCheck.")

        # Compute % of supply held by the top 10 wallets (excluding
        # the LP / burn addresses heuristically).
        concentrations: list[float] = []
        for h in top_holders[:10]:
            pct = float(h.get("pct") or h.get("pct_held") or 0)
            # Skip obvious LP / null addresses.
            owner = (h.get("owner") or "").lower()
            if owner in {"11111111111111111111111111111111", "1nc1nerator11111111111111111111111111111111"}:
                continue
            concentrations.append(pct)

        top_pct = sum(concentrations)
        max_single = max(concentrations) if concentrations else 0.0

        if max_single > 50:
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=5.0, weight=weight,
                reason=f"Single holder owns {max_single:.1f}% — extreme concentration.",
                details={"top10_pct": top_pct, "max_single_pct": max_single},
            )
        if top_pct > 80:
            return CheckResult(
                name=name, status=CheckStatus.FAIL, score=15.0, weight=weight,
                reason=f"Top 10 wallets hold {top_pct:.1f}% — high concentration.",
                details={"top10_pct": top_pct, "max_single_pct": max_single},
            )
        if top_pct > 50:
            return CheckResult(
                name=name, status=CheckStatus.WARN, score=55.0, weight=weight,
                reason=f"Top 10 wallets hold {top_pct:.1f}% — moderate concentration.",
                details={"top10_pct": top_pct, "max_single_pct": max_single},
            )

        return CheckResult(
            name=name, status=CheckStatus.PASS, score=90.0, weight=weight,
            reason=f"Well distributed (top 10 hold {top_pct:.1f}%).",
            details={"top10_pct": top_pct, "max_single_pct": max_single},
        )

    # ---- helpers ----------------------------------------------------------
    def _weight_for(self, check_name: str) -> float:
        """Look up the configured weight for a check."""
        return self.config.weights_map().get(check_name, 0.0)

    @staticmethod
    def _skip(name: str, weight: float, reason: str) -> CheckResult:
        return CheckResult(
            name=name, status=CheckStatus.SKIP, score=0.0, weight=weight, reason=reason,
        )

    @staticmethod
    def _token_age_hours(token: Token) -> float:
        """Hours since the token's ``launch_time``."""
        now = datetime.now(timezone.utc)
        launch = token.launch_time
        if launch.tzinfo is None:
            launch = launch.replace(tzinfo=timezone.utc)
        return max(0.0, (now - launch).total_seconds() / 3600.0)

    @staticmethod
    def _decode_b64_account(data: Any) -> Optional[bytes]:
        """Decode Solana RPC account data.

        RPC returns ``[base64_str, encoding]`` or ``{"data": ..., "encoding": ...}``.
        """
        if not data:
            return None
        if isinstance(data, list) and len(data) >= 1:
            import base64
            try:
                return base64.b64decode(data[0])
            except Exception:  # noqa: BLE001
                return None
        return None

    # ---- network ----------------------------------------------------------
    async def _get_session(self) -> aiohttp.ClientSession:
        """Lazily create / return the shared aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=self._timeout,
                headers={"User-Agent": self._user_agent},
            )
            self._owns_session = True
        return self._session

    async def _fetch_json(
        self, url: str, *, headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        """GET ``url`` and return parsed JSON.

        Raises:
            _ServiceUnavailable: on network / HTTP / parse errors so
                callers can convert to SKIP.
        """
        sess = await self._get_session()
        try:
            async with sess.get(url, headers=headers or {}) as resp:
                if resp.status == 404:
                    # Token not found on the service — distinct from outage.
                    raise _ServiceUnavailable(f"HTTP 404 for {url}")
                if resp.status >= 500:
                    raise _ServiceUnavailable(f"HTTP {resp.status} for {url}")
                if resp.status >= 400:
                    # 4xx (other than 404) — treat as soft-skip too.
                    raise _ServiceUnavailable(f"HTTP {resp.status} for {url}")
                return await resp.json(content_type=None)
        except aiohttp.ClientError as exc:
            raise _ServiceUnavailable(f"network error: {exc}") from exc
        except _ServiceUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _ServiceUnavailable(f"unexpected: {exc}") from exc

    async def _solana_get_account_info(self, address: str) -> dict[str, Any]:
        """Call Solana JSON-RPC ``getAccountInfo`` with base64 encoding."""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [address, {"encoding": "base64"}],
        }
        sess = await self._get_session()
        try:
            async with sess.post(self.rpc_url, json=payload) as resp:
                if resp.status != 200:
                    raise _ServiceUnavailable(f"Solana RPC HTTP {resp.status}")
                body = await resp.json(content_type=None)
        except aiohttp.ClientError as exc:
            raise _ServiceUnavailable(f"Solana RPC network error: {exc}") from exc
        except _ServiceUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _ServiceUnavailable(f"Solana RPC error: {exc}") from exc

        if body.get("error"):
            raise _ServiceUnavailable(f"Solana RPC error: {body['error']}")
        result = body.get("result") or {}
        value = result.get("value")
        if value is None:
            raise _ServiceUnavailable(f"Account {address} not found on RPC")
        return result

    # ---- lifecycle --------------------------------------------------------
    async def close(self) -> None:
        """Close the shared aiohttp session if we own it."""
        if self._session and self._owns_session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> "RugChecker":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()


# ---------------------------------------------------------------------------
# Internal exceptions
# ---------------------------------------------------------------------------
class _ServiceUnavailable(Exception):
    """Raised when a backing API / RPC is unreachable.

    Callers convert this into a ``CheckStatus.SKIP`` result so a
    transient outage never produces a false DANGER.
    """
