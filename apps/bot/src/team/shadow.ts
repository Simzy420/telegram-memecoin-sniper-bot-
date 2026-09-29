import { fetchTokenMarkUsd } from "./candidates.js";
import { appendJournalRows, loadJournalRows, type JournalRow } from "./journal.js";
import { paperPnlUsd } from "./paper.js";
import { shouldPersistJournal } from "./paths.js";

/** Fixed clock for a block label and for an open clip's mark. Not a close. */
export const MARK_HORIZON_MS = 15 * 60 * 1000;

/** Hypothetical size used only to sign a blocked name. Cash does not move. */
export const SHADOW_SIZE_USD = 50;

const MAX_MARKS_PER_SETTLE = 8;

let settling: Promise<number> | null = null;

interface Anchor {
  kind: "check" | "paper_fill";
  action: "shadow_mark" | "horizon_mark";
  timestamp: string;
  sessionId: string;
  userId: string;
  symbol: string;
  chain: string;
  address: string;
  entryPrice: number;
  sizeUsd: number;
  strategy: string | null;
}

export function anchorTag(kind: "check" | "paper_fill", timestamp: string, symbol: string): string {
  return `anchor:${kind}:${timestamp}:${symbol}`;
}

/**
 * Journal rows for blocks and open clips whose 15m mark is due.
 * A missing exit price writes nothing, so the next pass can try again.
 * These rows are not fills and do not change paper cash.
 */
export async function resolveDueMarks(opts: {
  rows: JournalRow[];
  now?: Date;
  fetchImpl?: typeof fetch;
  horizonMs?: number;
  limit?: number;
}): Promise<JournalRow[]> {
  const now = opts.now ?? new Date();
  const horizon = opts.horizonMs ?? MARK_HORIZON_MS;
  const limit = opts.limit ?? MAX_MARKS_PER_SETTLE;
  const due = dueAnchors(opts.rows, now, horizon).slice(0, limit);
  const created: JournalRow[] = [];
  for (const anchor of due) {
    const exit = await fetchTokenMarkUsd(anchor.chain, anchor.address, opts.fetchImpl);
    const pnl = paperPnlUsd(anchor.sizeUsd, anchor.entryPrice, exit);
    if (exit == null || pnl == null) continue;
    created.push(markRow(anchor, exit, pnl, now));
  }
  return created;
}

/** Persist due shadow and horizon marks. No-op when the journal is not being stored. */
export function settleJournalMarks(opts: {
  now?: Date;
  fetchImpl?: typeof fetch;
  userId?: string;
} = {}): Promise<number> {
  if (settling) return settling;
  settling = settleInner(opts).finally(() => {
    settling = null;
  });
  return settling;
}

async function settleInner(opts: {
  now?: Date;
  fetchImpl?: typeof fetch;
  userId?: string;
}): Promise<number> {
  if (!shouldPersistJournal()) return 0;
  const rows = loadJournalRows(opts.userId ? { userId: opts.userId } : {});
  const due = await resolveDueMarks({
    rows,
    now: opts.now,
    fetchImpl: opts.fetchImpl,
  });
  if (due.length === 0) return 0;
  appendJournalRows(due);
  return due.length;
}

function dueAnchors(rows: JournalRow[], now: Date, horizonMs: number): Anchor[] {
  const labelled = new Set(rows.flatMap((row) => row.tags.filter((tag) => tag.startsWith("anchor:"))));
  const anchors: Anchor[] = [];
  for (const row of rows) {
    if (!row.symbol || !row.chain || !usableMint(row.address)) continue;
    if (row.price == null || !(row.price > 0)) continue;
    const age = now.getTime() - Date.parse(row.timestamp);
    if (!Number.isFinite(age) || age < horizonMs) continue;
    if (row.action === "check" && verdictOf(row) === "block") {
      const tag = anchorTag("check", row.timestamp, row.symbol);
      if (labelled.has(tag)) continue;
      anchors.push({
        kind: "check",
        action: "shadow_mark",
        timestamp: row.timestamp,
        sessionId: row.session_id,
        userId: row.user_id,
        symbol: row.symbol,
        chain: row.chain,
        address: row.address,
        entryPrice: row.price,
        sizeUsd: SHADOW_SIZE_USD,
        strategy: null,
      });
    } else if (row.action === "paper_fill") {
      const tag = anchorTag("paper_fill", row.timestamp, row.symbol);
      if (labelled.has(tag)) continue;
      anchors.push({
        kind: "paper_fill",
        action: "horizon_mark",
        timestamp: row.timestamp,
        sessionId: row.session_id,
        userId: row.user_id,
        symbol: row.symbol,
        chain: row.chain,
        address: row.address,
        entryPrice: row.price,
        sizeUsd: row.size != null && row.size > 0 ? row.size : SHADOW_SIZE_USD,
        strategy: strategyOf(row),
      });
    }
  }
  return anchors;
}

function markRow(anchor: Anchor, exit: number, pnl: number, now: Date): JournalRow {
  const shadow = anchor.action === "shadow_mark";
  return {
    timestamp: now.toISOString(),
    session_id: anchor.sessionId,
    user_id: anchor.userId,
    agent: shadow ? "shield" : "ledger",
    action: anchor.action,
    symbol: anchor.symbol,
    chain: anchor.chain,
    address: anchor.address,
    size: anchor.sizeUsd,
    price: exit,
    pnl,
    shield_reasons: [
      shadow
        ? "shadow:15m mark after a block. Not a fill. Cash unchanged."
        : "horizon:15m mark on an open clip. Not a close. Cash unchanged.",
    ],
    tags: [
      anchorTag(anchor.kind, anchor.timestamp, anchor.symbol),
      shadow ? "outcome:shadow" : "outcome:horizon",
      shadow ? "shadow:no-fill" : "horizon:open-clip",
      ...(anchor.strategy ? [anchor.strategy] : []),
    ],
    mode: "paper",
  };
}

function usableMint(address: string | null): address is string {
  return Boolean(address) && !address!.startsWith("EXAMPLE_");
}

function verdictOf(row: JournalRow): string | null {
  const tagged = row.tags.find((tag) => tag.startsWith("verdict:"));
  if (tagged) return tagged.slice("verdict:".length);
  const reason = row.shield_reasons.find((item) => item.startsWith("verdict:"));
  return reason ? reason.slice("verdict:".length) : null;
}

function strategyOf(row: JournalRow): string | null {
  return row.tags.find((tag) => tag.startsWith("strategy:")) ?? null;
}
