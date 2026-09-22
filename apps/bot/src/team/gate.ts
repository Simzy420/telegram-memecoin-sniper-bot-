/**
 * Live trading gate.
 * LIVE_TRADING=true only records that an operator asked for live mode.
 * This build has no signer and no broadcaster, so funds cannot move.
 */
export interface ExecutionGate {
  requestedLive: boolean;
  broadcast: false;
  modeLabel: "PAPER";
  detail: string;
}

export function executionGate(
  env: Record<string, string | undefined> = process.env,
): ExecutionGate {
  const requestedLive = env.LIVE_TRADING === "true";
  return {
    requestedLive,
    broadcast: false,
    modeLabel: "PAPER",
    detail: requestedLive
      ? "LIVE_TRADING=true, but this build has no transaction broadcaster. Funds cannot move. The desk stays on paper."
      : "Paper mode. LIVE_TRADING is off. No wallet signatures and no broadcasts.",
  };
}
