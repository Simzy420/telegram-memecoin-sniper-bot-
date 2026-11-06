/**
 * Runpod reports executionTime in milliseconds of worker time for one job.
 * dollarsPerHour is the GPU rate while that job ran, when we have one.
 */

export function clipCompute(executionTimeMs, dollarsPerHour) {
  const ms = Number(executionTimeMs);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.max(0, Math.round(ms / 1000));
  const rate = Number(dollarsPerHour);
  const hasRate = Number.isFinite(rate) && rate > 0;
  const dollars = hasRate ? (ms / 3_600_000) * rate : null;
  return {
    executionTimeMs: ms,
    seconds,
    dollarsPerHour: hasRate ? rate : null,
    dollars,
  };
}

export function formatGpuTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes <= 0) return `${remain} sec`;
  return `${minutes} min ${remain} sec`;
}

export function formatClipCost(compute) {
  if (!compute) return "";
  const time = `GPU time ${formatGpuTime(compute.seconds)}`;
  if (compute.dollars == null) return `${time}.`;
  const money = compute.dollars < 0.01 ? "under $0.01" : `about $${compute.dollars.toFixed(2)}`;
  return `${time} · ${money} at $${compute.dollarsPerHour.toFixed(2)}/hr.`;
}
