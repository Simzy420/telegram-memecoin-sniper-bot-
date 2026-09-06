"""SafetyResult model and scoring logic for the rug-pull detection pipeline.

Defines:
    - CheckResult  : outcome of a single safety check
    - SafetyResult : aggregated result with an overall 0-100 score and band
    - SafetyBand   : SAFE / CAUTION / DANGER enum
    - ScoringConfig: per-check weights & thresholds

The scoring is deliberately transparent: every check contributes a
weighted slice of the final score, and the worst-performing check can
cap the total (so a token that fails mint-authority can never be SAFE,
even if everything else is perfect).
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class CheckStatus(str, Enum):
    """Outcome of a single check."""

    PASS = "pass"      # check passed
    WARN = "warn"      # check passed with reservations
    FAIL = "fail"      # check failed — red flag
    SKIP = "skip"      # service down / not applicable — neutral
    ERROR = "error"    # check itself crashed — treated like SKIP


class SafetyBand(str, Enum):
    """Final safety classification derived from the 0-100 score."""

    SAFE = "safe"        # 80-100
    CAUTION = "caution"  # 50-79
    DANGER = "danger"    # 0-49


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class CheckResult(BaseModel):
    """Result of a single safety check.

    Attributes:
        name: Machine name of the check (e.g. "liquidity_check").
        status: PASS / WARN / FAIL / SKIP / ERROR.
        score: 0-100 contribution score for this check.
        weight: Weight this check carried in the final score (0-1).
        reason: Human-readable explanation of the outcome.
        details: Free-form per-check data (raw API responses, thresholds
            hit, etc.).
    """

    model_config = ConfigDict(use_enum_values=True, extra="allow")

    name: str = Field(..., description="Check identifier")
    status: CheckStatus = Field(..., description="Outcome of the check")
    score: float = Field(0.0, ge=0.0, le=100.0, description="0-100 score for this check")
    weight: float = Field(0.0, ge=0.0, le=1.0, description="Weight in final score")
    reason: str = Field("", description="Human-readable explanation")
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("status", mode="before")
    @classmethod
    def _normalise_status(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return CheckStatus(v.lower())
            except ValueError:
                raise ValueError(
                    f"Invalid check status: {v!r}. Expected one of {[s.value for s in CheckStatus]}"
                )
        return v

    @property
    def passed(self) -> bool:
        return self._status_value() == CheckStatus.PASS.value

    @property
    def failed(self) -> bool:
        return self._status_value() == CheckStatus.FAIL.value

    @property
    def skipped(self) -> bool:
        sv = self._status_value()
        return sv in (CheckStatus.SKIP.value, CheckStatus.ERROR.value)

    def _status_value(self) -> str:
        return self.status if isinstance(self.status, str) else self.status.value


class SafetyResult(BaseModel):
    """Aggregated result of the full safety pipeline.

    Attributes:
        token_address: Token this result applies to.
        score: Final 0-100 safety score.
        band: SAFE / CAUTION / DANGER derived from score.
        checks: List of individual CheckResult objects.
        reason: Top-level human-readable summary.
        run_time_ms: Wall-clock time the pipeline took, in ms.
        executed_at: ISO timestamp of when the pipeline ran.
    """

    model_config = ConfigDict(use_enum_values=True, extra="allow")

    token_address: str = Field(..., description="Token this result applies to")
    score: int = Field(0, ge=0, le=100, description="Final safety score 0-100")
    band: SafetyBand = Field(SafetyBand.DANGER, description="SAFE / CAUTION / DANGER")
    checks: list[CheckResult] = Field(default_factory=list, description="Individual check results")
    reason: str = Field("", description="Top-level human-readable summary")
    run_time_ms: Optional[float] = Field(None, description="Pipeline wall-clock time in ms")
    executed_at: Optional[str] = Field(None, description="ISO timestamp of pipeline run")

    @field_validator("band", mode="before")
    @classmethod
    def _normalise_band(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return SafetyBand(v.lower())
            except ValueError:
                raise ValueError(f"Invalid band: {v!r}")
        return v

    @model_validator(mode="after")
    def _sync_band(self) -> "SafetyResult":
        """Always derive the band from the score so they can never drift."""
        self.band = band_from_score(self.score)
        return self

    # ---- convenience ------------------------------------------------------
    @property
    def is_safe(self) -> bool:
        return self._band_value() == SafetyBand.SAFE.value

    @property
    def is_caution(self) -> bool:
        return self._band_value() == SafetyBand.CAUTION.value

    @property
    def is_danger(self) -> bool:
        return self._band_value() == SafetyBand.DANGER.value

    def _band_value(self) -> str:
        return self.band if isinstance(self.band, str) else self.band.value

    def failed_checks(self) -> list[CheckResult]:
        """Return only the checks that FAILed."""
        return [c for c in self.checks if c.failed]

    def skipped_checks(self) -> list[CheckResult]:
        """Return checks that were SKIPped / ERROred."""
        return [c for c in self.checks if c.skipped]

    def summary(self) -> str:
        """One-line human summary, e.g. ``CAUTION (62) — 2 warns, 1 skip``."""
        n_fail = len(self.failed_checks())
        n_skip = len(self.skipped_checks())
        n_warn = sum(1 for c in self.checks if c._status_value() == CheckStatus.WARN.value)
        parts = [f"{self._band_value().upper()} ({self.score})"]
        flags = []
        if n_fail:
            flags.append(f"{n_fail} fail")
        if n_warn:
            flags.append(f"{n_warn} warn")
        if n_skip:
            flags.append(f"{n_skip} skip")
        if flags:
            parts.append(" — " + ", ".join(flags))
        return "".join(parts)


# ---------------------------------------------------------------------------
# Scoring config
# ---------------------------------------------------------------------------
class ScoringConfig(BaseModel):
    """Weights & thresholds for the safety pipeline.

    Weights are normalised at scoring time so they don't have to sum to 1.
    """

    model_config = ConfigDict(extra="forbid")

    # per-check weights
    weight_liquidity: float = 0.25
    weight_honeypot: float = 0.20
    weight_mint_authority: float = 0.20
    weight_freeze_authority: float = 0.15
    weight_creator_analysis: float = 0.10
    weight_supply_concentration: float = 0.10

    # bands
    safe_min: int = 80
    caution_min: int = 50

    # If any check FAILs, cap the final score at this value so a single
    # hard fail can still produce a DANGER/CAUTION result even when the
    # weighted average would be high.
    fail_cap: int = 49

    # If any check is a hard FAIL, force the band to at most CAUTION.
    # If *two or more* hard FAILs, force DANGER regardless of score.
    hard_fail_caution_cap: int = 1
    hard_fail_danger_floor: int = 2

    @field_validator(
        "weight_liquidity", "weight_honeypot", "weight_mint_authority",
        "weight_freeze_authority", "weight_creator_analysis", "weight_supply_concentration",
    )
    @classmethod
    def _weights_positive(cls, v: float) -> float:
        if v < 0:
            raise ValueError("weights must be >= 0")
        return v

    def weights_map(self) -> dict[str, float]:
        """Return a {check_name: weight} mapping."""
        return {
            "liquidity_check": self.weight_liquidity,
            "honeypot_check": self.weight_honeypot,
            "mint_authority_check": self.weight_mint_authority,
            "freeze_authority_check": self.weight_freeze_authority,
            "creator_analysis": self.weight_creator_analysis,
            "supply_concentration": self.weight_supply_concentration,
        }


# ---------------------------------------------------------------------------
# Scoring logic
# ---------------------------------------------------------------------------
def band_from_score(score: int | float) -> SafetyBand:
    """Map a 0-100 score to a SafetyBand.

    Args:
        score: 0-100 safety score.
    Returns:
        SAFE (>=80), CAUTION (50-79), or DANGER (<50).
    """
    s = int(score)
    if s >= 80:
        return SafetyBand.SAFE
    if s >= 50:
        return SafetyBand.CAUTION
    return SafetyBand.DANGER


def compute_score(
    checks: list[CheckResult],
    config: Optional[ScoringConfig] = None,
) -> tuple[int, str]:
    """Compute the final 0-100 score from a list of CheckResults.

    Scoring rules:
        1.  Each check contributes ``score * weight``.
        2.  Weights are normalised over checks that actually ran
            (SKIP/ERROR checks are excluded from the denominator so a
            service outage doesn't tank the score).
        3.  If any check FAILs, the final score is capped at
            ``config.fail_cap`` (default 49 -> DANGER).
        4.  If >= ``hard_fail_danger_floor`` checks FAIL, force DANGER.

    Args:
        checks: List of CheckResult from the pipeline.
        config: ScoringConfig; defaults to a fresh instance.
    Returns:
        Tuple of (score, reason_string).
    """
    cfg = config or ScoringConfig()
    weights = cfg.weights_map()

    n_fail = sum(1 for c in checks if c.failed)
    n_skip = sum(1 for c in checks if c.skipped)

    # Weighted sum over checks that actually ran.
    weighted_total = 0.0
    weight_sum = 0.0
    for c in checks:
        if c.skipped:
            continue
        w = weights.get(c.name, 0.0)
        weighted_total += c.score * w
        weight_sum += w

    if weight_sum <= 0:
        # Everything skipped — we have no signal. Return 0 / DANGER.
        return 0, "All checks skipped — insufficient data to score."

    raw = weighted_total / weight_sum
    score = int(round(raw))
    score = max(0, min(100, score))

    # Hard-fail caps.
    if n_fail >= cfg.hard_fail_danger_floor:
        score = min(score, cfg.fail_cap)
        reason = f"{n_fail} hard fail(s) — forced DANGER."
    elif n_fail >= cfg.hard_fail_caution_cap:
        score = min(score, 79)  # cap at top of CAUTION
        reason = f"{n_fail} hard fail(s) — capped to CAUTION."
    else:
        reason = f"Weighted score {raw:.1f} over {len(checks) - n_skip} checks ({n_skip} skipped)."

    return score, reason


def build_result(
    token_address: str,
    checks: list[CheckResult],
    run_time_ms: Optional[float] = None,
    config: Optional[ScoringConfig] = None,
) -> SafetyResult:
    """Build a SafetyResult from a list of CheckResults.

    Convenience wrapper that runs :func:`compute_score` and packages
    everything into a :class:`SafetyResult` with a top-level reason.
    """
    score, reason = compute_score(checks, config)
    band = band_from_score(score)

    # Build a compact top-level reason that includes per-check highlights.
    highlights: list[str] = []
    for c in checks:
        if c.failed:
            highlights.append(f"FAIL:{c.name}")
        elif c.skipped:
            highlights.append(f"SKIP:{c.name}")
    if highlights:
        reason = reason + " [" + ", ".join(highlights) + "]"

    return SafetyResult(
        token_address=token_address,
        score=score,
        band=band,
        checks=checks,
        reason=reason,
        run_time_ms=run_time_ms,
        executed_at=None,
    )
