/** Typical wait shown on the generate bar. The job can finish sooner or run long. */
export const GENERATE_EXPECTED_MS = 5 * 60 * 1000;
export const EXTEND_EXPECTED_MS = 6 * 60 * 1000;

/**
 * Map elapsed time onto a bar that reaches 95% at the estimate, then creeps.
 * remainingMs is 0 once the estimate has passed.
 */
export function generateProgress(elapsedMs, expectedMs = GENERATE_EXPECTED_MS) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const expected = Math.max(1000, Number(expectedMs) || GENERATE_EXPECTED_MS);
  if (elapsed < expected) {
    return {
      percent: Math.min(95, Math.round((elapsed / expected) * 95)),
      remainingMs: expected - elapsed,
      over: false,
    };
  }
  const extraRatio = (elapsed - expected) / expected;
  return {
    percent: Math.min(99, 95 + Math.round(extraRatio * 8)),
    remainingMs: 0,
    over: true,
  };
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function progressLabel(state) {
  if (!state || state.over) return "Still working. This is taking longer than usual.";
  return `About ${formatRemaining(state.remainingMs)} left`;
}
