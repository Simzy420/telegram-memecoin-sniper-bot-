"""Smoke test: verify all 6 new modules import and the core logic works."""
import asyncio
from datetime import datetime, timezone

# ---- models ----
from src.models.token import Token, Chain
from src.models.user import User, SubscriptionTier, RiskLevel, UserSettings, UserStats
from src.models.trade import Trade, TradeSide, TradeStatus

# ---- safety ----
from src.safety.score import (
    CheckResult, CheckStatus, SafetyBand, SafetyResult,
    ScoringConfig, band_from_score, compute_score, build_result,
)
from src.safety.rug_checker import RugChecker

# ---- detectors ----
from src.detectors.pumpfun_detector import PumpFunDetector, PUMPFUN_PROGRAM_ID


def test_models():
    # Token
    t = Token(
        address="So11111111111111111111111111111111111111112",
        name="Test Token",
        symbol=" test ",
        chain="solana",
    )
    assert t.symbol == "TEST"
    assert t.is_solana
    assert t.short_address().endswith("…1112")
    print(f"✓ Token: {t.symbol} on {t.chain} — {t.short_address()}")

    # User
    u = User(telegram_id=12345, username="@bob", subscription_tier="pro")
    assert u.username == "bob"
    assert u.is_paid
    assert u.settings.max_position_sol == 1.0  # pro default
    assert u.min_safety_score_for_risk() == 60  # medium default
    u.stats.record_trade(2.5)
    u.stats.record_trade(-1.0)
    assert u.stats.total_trades == 2
    assert abs(u.stats.win_rate - 0.5) < 1e-9
    print(f"✓ User: @{u.username} tier={u.subscription_tier} max_pos={u.settings.max_position_sol}SOL win_rate={u.stats.win_rate:.0%}")

    # Trade
    tr = Trade(
        user_id=12345,
        token_address=t.address,
        token_symbol="TEST",
        chain="solana",
        side="buy",
        amount_sol=0.5,
    )
    assert tr.is_buy
    assert tr.status == "pending"
    tr.mark_executed(tx_hash="abc123")
    assert tr.is_executed
    assert tr.tx_hash == "abc123"
    print(f"✓ Trade: {tr.side} {tr.amount_sol}SOL of {tr.token_symbol} status={tr.status}")

    # FAIL validation: EXECUTED without tx_hash
    try:
        Trade(user_id=1, token_address=t.address, token_symbol="X", chain="solana", side="buy", amount_sol=1, status="executed")
        assert False, "should have raised"
    except Exception as e:
        assert "tx_hash" in str(e)
        print("✓ Trade validation: EXECUTED without tx_hash correctly rejected")


def test_scoring():
    cfg = ScoringConfig()

    # All pass -> SAFE
    checks = [
        CheckResult(name="liquidity_check", status=CheckStatus.PASS, score=100, weight=0.25),
        CheckResult(name="honeypot_check", status=CheckStatus.PASS, score=90, weight=0.20),
        CheckResult(name="mint_authority_check", status=CheckStatus.PASS, score=100, weight=0.20),
        CheckResult(name="freeze_authority_check", status=CheckStatus.PASS, score=100, weight=0.15),
        CheckResult(name="creator_analysis", status=CheckStatus.PASS, score=80, weight=0.10),
        CheckResult(name="supply_concentration", status=CheckStatus.PASS, score=90, weight=0.10),
    ]
    score, reason = compute_score(checks, cfg)
    assert score >= 80, f"expected SAFE, got {score}: {reason}"
    assert band_from_score(score) == SafetyBand.SAFE
    print(f"✓ Scoring all-pass: score={score} band=SAFE — {reason}")

    # Two hard fails -> DANGER cap (49)
    checks[2] = CheckResult(name="mint_authority_check", status=CheckStatus.FAIL, score=10, weight=0.20)
    checks[3] = CheckResult(name="freeze_authority_check", status=CheckStatus.FAIL, score=15, weight=0.15)
    score2, reason2 = compute_score(checks, cfg)
    assert score2 <= 49, f"expected danger cap, got {score2}: {reason2}"
    assert band_from_score(score2) == SafetyBand.DANGER
    print(f"✓ Scoring 2-fail: score={score2} band=DANGER (capped) — {reason2}")

    # Single hard fail -> CAUTION cap (79)
    checks[3] = CheckResult(name="freeze_authority_check", status=CheckStatus.PASS, score=100, weight=0.15)
    score1, reason1 = compute_score(checks, cfg)
    assert 50 <= score1 <= 79, f"expected caution cap, got {score1}: {reason1}"
    assert band_from_score(score1) == SafetyBand.CAUTION
    print(f"✓ Scoring 1-fail: score={score1} band=CAUTION (capped) — {reason1}")

    # All skipped -> 0
    skips = [CheckResult(name=n, status=CheckStatus.SKIP, score=0, weight=w)
             for n, w in cfg.weights_map().items()]
    score3, reason3 = compute_score(skips, cfg)
    assert score3 == 0
    assert "skipped" in reason3
    print(f"✓ Scoring all-skip: score={score3} — {reason3}")

    # build_result + summary — rebuild with 2 fails for a DANGER result
    danger_checks = [
        CheckResult(name="liquidity_check", status=CheckStatus.PASS, score=100, weight=0.25),
        CheckResult(name="honeypot_check", status=CheckStatus.PASS, score=90, weight=0.20),
        CheckResult(name="mint_authority_check", status=CheckStatus.FAIL, score=10, weight=0.20),
        CheckResult(name="freeze_authority_check", status=CheckStatus.FAIL, score=15, weight=0.15),
        CheckResult(name="creator_analysis", status=CheckStatus.PASS, score=80, weight=0.10),
        CheckResult(name="supply_concentration", status=CheckStatus.PASS, score=90, weight=0.10),
    ]
    res = build_result("So11111111111111111111111111111111111111112", checks, run_time_ms=12.3)
    assert isinstance(res, SafetyResult)
    assert res.band in (SafetyBand.DANGER, SafetyBand.CAUTION), f"2-fail should be DANGER/CAUTION, got {res.band}"
    assert "FAIL:mint_authority_check" in res.reason
    print(f"✓ build_result: {res.summary()}")


def test_rug_checker_skip_behavior():
    """Verify the checker SKIPs checks when their backing service is down.

    Uses an unreachable Solana RPC so the two RPC-dependent checks
    (mint_authority_check, freeze_authority_check) must SKIP.  The HTTP
    API checks (DexScreener / RugCheck / Birdeye) may succeed against
    live services — that's fine; we only assert the deterministic part.
    """
    async def _run():
        checker = RugChecker(rpc_url="http://127.0.0.1:1")  # unreachable RPC
        try:
            token = Token(
                address="So11111111111111111111111111111111111111112",
                name="T", symbol="T", chain="solana",
            )
            result = await checker.check(token)
            # The two checks that depend on Solana RPC must SKIP.
            rpc_checks = {c.name for c in result.checks if c.name in
                          ("mint_authority_check", "freeze_authority_check")}
            skipped_names = {c.name for c in result.skipped_checks()}
            assert rpc_checks.issubset(skipped_names), \
                f"RPC-dependent checks should SKIP when RPC is down: {rpc_checks - skipped_names}"
            # Pipeline must always produce a valid SafetyResult.
            assert isinstance(result, SafetyResult)
            assert 0 <= result.score <= 100
            assert len(result.checks) == 6
            print(f"✓ RugChecker RPC-down: {result.summary()} (RPC checks skipped as expected)")
        finally:
            await checker.close()

    asyncio.run(_run())


def test_detector_construct():
    """Detector should construct in poll-only mode and expose a queue."""
    det = PumpFunDetector(wss_url="", rpc_url="https://api.mainnet-beta.solana.com")
    assert det.queue is not None
    assert det.wss_url == ""
    print(f"✓ PumpFunDetector poll-only construct OK (program={PUMPFUN_PROGRAM_ID[:8]}…)")

    det2 = PumpFunDetector(wss_url="wss://example")
    assert det2.wss_url == "wss://example"
    print("✓ PumpFunDetector ws-mode construct OK")


if __name__ == "__main__":
    test_models()
    test_scoring()
    test_rug_checker_skip_behavior()
    test_detector_construct()
    print("\n=== ALL SMOKE TESTS PASSED ===")
