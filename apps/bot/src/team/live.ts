import { executionGate } from "./gate.js";

export interface LiveOrderRequest {
  symbol: string;
  chain: string;
  side: "buy" | "sell";
  sizeUsd: number;
  shieldVerdict: "pass" | "caution" | "block" | "unknown";
}

export interface LiveOrderResult {
  accepted: false;
  signed: false;
  broadcast: false;
  txId: null;
  reason: string;
}

const MAX_STUB_USD = 100;

/**
 * Marked live path. This function never signs and never broadcasts.
 * It only runs safety checks and returns a refusal.
 */
export function submitLiveOrder(
  req: LiveOrderRequest,
  env: Record<string, string | undefined> = process.env,
): LiveOrderResult {
  const gate = executionGate(env);
  if (!gate.liveEnabled) {
    return refuse(`Live gate is closed. ${gate.detail}`);
  }
  if (!req.symbol || !/^[A-Z0-9]{2,15}$/.test(req.symbol)) {
    return refuse("Live order rejected: symbol is missing. Nothing was signed.");
  }
  if (!req.chain) {
    return refuse("Live order rejected: chain is missing. Nothing was signed.");
  }
  if (req.shieldVerdict === "block") {
    return refuse("Live order rejected: Shield blocked this name. Nothing was signed.");
  }
  if (!(req.sizeUsd > 0) || req.sizeUsd > MAX_STUB_USD) {
    return refuse(
      `Live order rejected: size must be above 0 and at most ${MAX_STUB_USD} USD in this stub. Nothing was signed.`,
    );
  }
  return refuse(
    "Live gate is armed, but this build has no signer and no transaction broadcaster. The order was not sent.",
  );
}

function refuse(reason: string): LiveOrderResult {
  return {
    accepted: false,
    signed: false,
    broadcast: false,
    txId: null,
    reason,
  };
}
