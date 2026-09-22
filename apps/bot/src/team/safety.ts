import type { Candidate } from "./candidates.js";

export type FlagStatus = "ok" | "warn" | "bad" | "unknown";
export type ShieldVerdict = "pass" | "caution" | "block";

export interface ShieldFlag {
  label: string;
  status: FlagStatus;
  detail: string;
}

export interface ShieldReport {
  verdict: ShieldVerdict;
  flags: ShieldFlag[];
  summary: string;
}

export function runShield(candidate: Candidate): ShieldReport {
  const flags: ShieldFlag[] = [
    flagHoneypot(candidate),
    flagTax(candidate),
    flagLiquidity(candidate),
    flagMint(candidate),
    flagFreeze(candidate),
    flagLp(candidate),
  ];

  const bad = flags.filter((f) => f.status === "bad").length;
  const warn = flags.filter((f) => f.status === "warn").length;
  const unknown = flags.filter((f) => f.status === "unknown").length;

  let verdict: ShieldVerdict = "pass";
  if (bad > 0) verdict = "block";
  else if (warn > 0 || unknown > 0) verdict = "caution";

  const summary =
    verdict === "block"
      ? `${candidate.symbol} fails the checklist. I will not size it, even on paper.`
      : verdict === "caution"
        ? `${candidate.symbol} is not clean. Paper size only, and small.`
        : `${candidate.symbol} clears the checklist on the fields I can see. Still paper.`;

  return { verdict, flags, summary };
}

function flagHoneypot(c: Candidate): ShieldFlag {
  if (c.honeypot === true) {
    return { label: "Honeypot", status: "bad", detail: "sell path looks blocked" };
  }
  if (c.honeypot === false) {
    return { label: "Honeypot", status: "ok", detail: "no honeypot flag on this card" };
  }
  return { label: "Honeypot", status: "unknown", detail: "not checked" };
}

function flagTax(c: Candidate): ShieldFlag {
  if (c.taxPct == null) {
    return { label: "Tax", status: "unknown", detail: "buy/sell tax not on the card" };
  }
  if (c.taxPct >= 10) {
    return { label: "Tax", status: "bad", detail: `${c.taxPct}% tax` };
  }
  if (c.taxPct >= 5) {
    return { label: "Tax", status: "warn", detail: `${c.taxPct}% tax` };
  }
  return { label: "Tax", status: "ok", detail: `${c.taxPct}% tax` };
}

function flagLiquidity(c: Candidate): ShieldFlag {
  if (c.liqUsd == null) {
    return { label: "Liquidity", status: "unknown", detail: "pool depth unknown" };
  }
  const shown = `$${Math.round(c.liqUsd).toLocaleString("en-US")}`;
  if (c.liqUsd < 5_000) {
    return { label: "Liquidity", status: "bad", detail: `${shown} — too thin` };
  }
  if (c.liqUsd < 20_000) {
    return { label: "Liquidity", status: "warn", detail: `${shown} — thin` };
  }
  return { label: "Liquidity", status: "ok", detail: shown };
}

function flagMint(c: Candidate): ShieldFlag {
  if (c.mintAuthority === true) {
    return { label: "Mint authority", status: "bad", detail: "supply can still inflate" };
  }
  if (c.mintAuthority === false) {
    return { label: "Mint authority", status: "ok", detail: "revoked or absent" };
  }
  return { label: "Mint authority", status: "unknown", detail: "not checked" };
}

function flagFreeze(c: Candidate): ShieldFlag {
  if (c.freezeAuthority === true) {
    return { label: "Freeze authority", status: "warn", detail: "freeze authority is set" };
  }
  if (c.freezeAuthority === false) {
    return { label: "Freeze authority", status: "ok", detail: "no freeze authority" };
  }
  return { label: "Freeze authority", status: "unknown", detail: "not checked" };
}

function flagLp(c: Candidate): ShieldFlag {
  if (c.lpLocked === true) {
    return { label: "LP lock", status: "ok", detail: "marked locked on this card" };
  }
  if (c.lpLocked === false) {
    return { label: "LP lock", status: "warn", detail: "LP not locked" };
  }
  return { label: "LP lock", status: "unknown", detail: "lock status unknown" };
}

const MARK: Record<FlagStatus, string> = {
  ok: "OK",
  warn: "WARN",
  bad: "BLOCK",
  unknown: "UNKNOWN",
};

export function formatShield(report: ShieldReport): string {
  const lines = report.flags.map(
    (f) => `${MARK[f.status]} ${f.label} — ${f.detail}`,
  );
  return [`Verdict: ${report.verdict.toUpperCase()}`, ...lines, report.summary].join(
    "\n",
  );
}
