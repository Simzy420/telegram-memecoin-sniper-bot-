/**
 * Read-only parsers for Solana Shield fields.
 * A missing or unreadable field stays null. Callers must not turn null into a pass.
 */

export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export interface ShieldFields {
  liqUsd: number | null;
  taxPct: number | null;
  honeypot: boolean | null;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  lpLocked: boolean | null;
}

export interface ShieldFacts {
  liqUsd?: number | null;
  taxPct?: number | null;
  honeypot?: boolean | null;
  mintAuthority?: boolean | null;
  freezeAuthority?: boolean | null;
  lpLocked?: boolean | null;
}

export interface PairLiquidity {
  liquidity?: { usd?: number };
}

/** Sum pair depth. Null when no pair reported a finite liquidity number. */
export function sumLiquidityUsd(pairs: PairLiquidity[]): number | null {
  let sum = 0;
  let seen = false;
  for (const pair of pairs) {
    const usd = pair.liquidity?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) continue;
    seen = true;
    sum += usd;
  }
  return seen ? sum : null;
}

export function shieldFactsPresent(facts: ShieldFacts): boolean {
  return (
    facts.liqUsd != null ||
    facts.taxPct != null ||
    facts.honeypot != null ||
    facts.mintAuthority != null ||
    facts.freezeAuthority != null ||
    facts.lpLocked != null
  );
}

/**
 * Overlay new observations onto a card.
 * Dangerous booleans (honeypot, mint, freeze) stay true if any source says true.
 * An unlocked LP stays unlocked if any judged source says so.
 * Tax uses the higher percent. Liquidity already on the card is kept.
 */
export function mergeShieldFacts<T extends ShieldFields>(base: T, facts: ShieldFacts): T {
  const next: T = { ...base };
  if (next.liqUsd == null && facts.liqUsd != null) next.liqUsd = facts.liqUsd;
  if (facts.taxPct != null) {
    next.taxPct = next.taxPct == null ? facts.taxPct : Math.max(next.taxPct, facts.taxPct);
  }
  next.honeypot = mergeDanger(next.honeypot, facts.honeypot);
  next.mintAuthority = mergeDanger(next.mintAuthority, facts.mintAuthority);
  next.freezeAuthority = mergeDanger(next.freezeAuthority, facts.freezeAuthority);
  next.lpLocked = mergeLock(next.lpLocked, facts.lpLocked);
  return next;
}

/**
 * SPL Token and Token-2022 mint account.
 * Classic SPL has no transfer-fee extension, so tax is 0 when the mint decodes.
 * Token-2022 tax stays null when the fee extension is truncated.
 * Honeypot is set only for a clear mint-level sell block (non-transferable or
 * a permanent delegate). A plain mint does not prove the pool can be sold.
 */
export function parseMintAccount(dataBase64: string, owner: string): ShieldFacts {
  if (owner !== SPL_TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID) return {};
  let raw: Buffer;
  try {
    raw = Buffer.from(dataBase64, "base64");
  } catch {
    return {};
  }
  if (raw.length < 82 || raw[45] !== 1) return {};
  const mintAuthority = readCOption(raw, 0);
  const freezeAuthority = readCOption(raw, 46);
  if (mintAuthority == null || freezeAuthority == null) return {};

  if (owner === SPL_TOKEN_PROGRAM_ID) {
    return { mintAuthority, freezeAuthority, taxPct: 0 };
  }

  const extensions = parseToken2022Extensions(raw);
  const facts: ShieldFacts = { mintAuthority, freezeAuthority };
  if (extensions.taxPct != null) facts.taxPct = extensions.taxPct;
  if (extensions.honeypot === true) facts.honeypot = true;
  return facts;
}

/** RugCheck public report. Fields that are absent stay unset. */
export function parseRugcheckReport(payload: unknown): ShieldFacts {
  const rec = asRecord(payload);
  if (!rec || rec.error != null) return {};
  const facts: ShieldFacts = {};
  const token = asRecord(rec.token);
  if (token && "mintAuthority" in token) {
    const mintAuthority = authorityOn(token.mintAuthority);
    if (mintAuthority != null) facts.mintAuthority = mintAuthority;
  }
  if (token && "freezeAuthority" in token) {
    const freezeAuthority = authorityOn(token.freezeAuthority);
    if (freezeAuthority != null) facts.freezeAuthority = freezeAuthority;
  }

  const taxPct = taxFromRugcheck(rec);
  if (taxPct != null) facts.taxPct = taxPct;

  if (typeof rec.totalMarketLiquidity === "number" && Number.isFinite(rec.totalMarketLiquidity)) {
    if (rec.totalMarketLiquidity >= 0) facts.liqUsd = rec.totalMarketLiquidity;
  }

  const lpLocked = lpFromMarkets(rec.markets);
  if (lpLocked != null) facts.lpLocked = lpLocked;

  const honeypot = honeypotFromReport(rec);
  if (honeypot != null) facts.honeypot = honeypot;
  return facts;
}

function parseToken2022Extensions(raw: Buffer): { taxPct: number | null; honeypot: boolean | null } {
  if (raw.length <= 165) return { taxPct: 0, honeypot: null };
  if (raw[165] !== 1) return { taxPct: null, honeypot: null };

  let offset = 166;
  let maxBps: number | null = null;
  let sawFee = false;
  let honeypot: boolean | null = null;
  while (offset + 4 <= raw.length) {
    const type = raw.readUInt16LE(offset);
    const len = raw.readUInt16LE(offset + 2);
    if (type === 0 && len === 0) break;
    if (offset + 4 + len > raw.length) return { taxPct: null, honeypot };
    const body = raw.subarray(offset + 4, offset + 4 + len);
    offset += 4 + len;
    if (type === 1) {
      if (len < 108) return { taxPct: null, honeypot };
      sawFee = true;
      const older = body.readUInt16LE(88);
      const newer = body.readUInt16LE(106);
      const bps = Math.max(older, newer);
      maxBps = maxBps == null ? bps : Math.max(maxBps, bps);
    } else if (type === 9) {
      honeypot = true;
    } else if (type === 12 && len >= 32 && !body.subarray(0, 32).every((byte) => byte === 0)) {
      honeypot = true;
    }
  }
  return { taxPct: sawFee ? (maxBps ?? 0) / 100 : 0, honeypot };
}

function taxFromRugcheck(rec: Record<string, unknown>): number | null {
  let tax: number | null = null;
  const fee = asRecord(rec.transferFee);
  if (fee && typeof fee.pct === "number" && Number.isFinite(fee.pct) && fee.pct >= 0) {
    tax = fee.pct;
  }
  const ext = asRecord(rec.token_extensions);
  const config = ext ? feeConfigBps(ext.transferFeeConfig) : null;
  if (config != null) tax = tax == null ? config / 100 : Math.max(tax, config / 100);
  return tax;
}

function feeConfigBps(value: unknown): number | null {
  const config = asRecord(value);
  if (!config) return null;
  const older = bpsOf(config.olderTransferFee ?? config.older_transfer_fee);
  const newer = bpsOf(config.newerTransferFee ?? config.newer_transfer_fee);
  const found = [older, newer].filter((bps): bps is number => bps != null);
  if (found.length === 0) return null;
  return Math.max(...found);
}

function bpsOf(value: unknown): number | null {
  const row = asRecord(value);
  if (!row) return null;
  const bps = row.transferFeeBasisPoints ?? row.transfer_fee_basis_points;
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps < 0) return null;
  return bps;
}

function lpFromMarkets(value: unknown): boolean | null {
  if (!Array.isArray(value)) return null;
  let bestUsd = -1;
  let best: boolean | null = null;
  for (const market of value) {
    const lp = asRecord(asRecord(market)?.lp);
    if (!lp) continue;
    const pct =
      typeof lp.lpLockedPct === "number" && Number.isFinite(lp.lpLockedPct) ? lp.lpLockedPct : null;
    const lockedAmt = finiteNumber(lp.lpLocked);
    const unlockedAmt = finiteNumber(lp.lpUnlocked);
    const hasPosition = (lockedAmt ?? 0) + (unlockedAmt ?? 0) > 0;
    const lpMint = typeof lp.lpMint === "string" ? lp.lpMint : "";
    const realMint = lpMint !== "" && lpMint !== SYSTEM_PROGRAM;
    const judged = hasPosition || realMint || (pct != null && pct > 0);
    if (!judged) continue;
    const depth = (finiteNumber(lp.baseUSD) ?? 0) + (finiteNumber(lp.quoteUSD) ?? 0);
    const locked =
      (pct != null && pct >= 95) || (unlockedAmt === 0 && (lockedAmt ?? 0) > 0 && (pct == null || pct >= 95));
    if (depth >= bestUsd) {
      bestUsd = depth;
      best = locked;
    }
  }
  return best;
}

function honeypotFromReport(rec: Record<string, unknown>): boolean | null {
  if (rec.rugged === true) return true;
  const ext = asRecord(rec.token_extensions);
  if (ext?.nonTransferable === true) return true;
  if (ext && ext.permanentDelegate != null) return true;
  if (ext && ext.pausableConfig != null) return true;
  const risks = Array.isArray(rec.risks) ? rec.risks : [];
  if (risks.some((risk) => isSellDanger(risk))) return true;

  const hook = ext ? ext.transferHook != null : false;
  if (hook) return null;
  const token = asRecord(rec.token);
  const initialized = token?.isInitialized === true;
  const hasMarket = Array.isArray(rec.markets) && rec.markets.length > 0;
  const cleanRisks = !risks.some((risk) => riskLevel(risk) === "danger");
  if (rec.rugged === false && initialized && hasMarket && cleanRisks) return false;
  return null;
}

function isSellDanger(risk: unknown): boolean {
  if (riskLevel(risk) !== "danger") return false;
  const name = String(asRecord(risk)?.name ?? "").toLowerCase();
  return /honeypot|non-?transfer|cannot sell|can't sell|blacklist|pausable/.test(name);
}

function riskLevel(risk: unknown): string {
  return String(asRecord(risk)?.level ?? "").toLowerCase();
}

function authorityOn(value: unknown): boolean | null {
  if (value == null || value === "" || value === SYSTEM_PROGRAM) return false;
  if (typeof value === "string") return true;
  return null;
}

function readCOption(raw: Buffer, offset: number): boolean | null {
  if (raw.length < offset + 36) return null;
  const tag = raw.readUInt32LE(offset);
  if (tag === 0) return false;
  if (tag !== 1) return null;
  const key = raw.subarray(offset + 4, offset + 36);
  return key.every((byte) => byte === 0) ? false : true;
}

function mergeDanger(current: boolean | null, incoming: boolean | null | undefined): boolean | null {
  if (incoming == null) return current;
  if (current === true || incoming === true) return true;
  return false;
}

function mergeLock(current: boolean | null, incoming: boolean | null | undefined): boolean | null {
  if (incoming == null) return current;
  if (current === false || incoming === false) return false;
  if (current === true || incoming === true) return true;
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
