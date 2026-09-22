import { isRealEncryptionKey } from "../security/key.js";

/** Operator must set this exact value. Anything else leaves the desk on paper. */
export const LIVE_CONFIRM_PHRASE = "I_UNDERSTAND";

/**
 * Live trading gate.
 * Live mode arms only when LIVE_TRADING is the exact string "true",
 * LIVE_TRADING_CONFIRM is I_UNDERSTAND, and WALLET_ENCRYPTION_KEY is a real secret.
 * This build still has no signer and no broadcaster, so funds cannot move.
 */
export interface ExecutionGate {
  requestedLive: boolean;
  confirmed: boolean;
  encryptionKeyReady: boolean;
  liveEnabled: boolean;
  broadcast: false;
  mode: "paper" | "live";
  modeLabel: "PAPER" | "LIVE_STUB";
  detail: string;
}

export function executionGate(
  env: Record<string, string | undefined> = process.env,
): ExecutionGate {
  const requestedLive = env.LIVE_TRADING === "true";
  const confirmed = env.LIVE_TRADING_CONFIRM === LIVE_CONFIRM_PHRASE;
  const encryptionKeyReady = isRealEncryptionKey(env.WALLET_ENCRYPTION_KEY);
  const liveEnabled = requestedLive && confirmed && encryptionKeyReady;
  const missing: string[] = [];
  if (!confirmed) missing.push("LIVE_TRADING_CONFIRM is not I_UNDERSTAND");
  if (!encryptionKeyReady) {
    missing.push("WALLET_ENCRYPTION_KEY is missing or still a placeholder");
  }

  let detail: string;
  if (liveEnabled) {
    detail =
      "Live gate is armed, but this build has no signer and no transaction broadcaster. Orders are refused before signing.";
  } else if (requestedLive) {
    detail = `Paper mode. Live was requested but the gate is closed (${missing.join("; ")}). No transaction broadcaster.`;
  } else {
    detail = "Paper mode. LIVE_TRADING is off. No wallet signatures and no broadcasts.";
  }

  return {
    requestedLive,
    confirmed,
    encryptionKeyReady,
    liveEnabled,
    broadcast: false,
    mode: liveEnabled ? "live" : "paper",
    modeLabel: liveEnabled ? "LIVE_STUB" : "PAPER",
    detail,
  };
}
