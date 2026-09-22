import fs from "node:fs";
import path from "node:path";
import { insertJournalRows, listJournal, openDurable } from "../db/durable.js";
import {
  durableDbPath,
  journalFileForDay,
  journalRoot,
  utcDay,
} from "./paths.js";

export type JournalAgent = "scout" | "sniper" | "pulse" | "ledger" | "shield";
export type JournalMode = "paper" | "live";

export interface JournalDraft {
  agent: JournalAgent;
  action: string;
  symbol?: string | null;
  chain?: string | null;
  size?: number | null;
  price?: number | null;
  pnl?: number | null;
  shieldReasons?: string[];
  tags?: string[];
  mode?: JournalMode;
}

/** One append-only desk event. Nulls mean the field was not observed. */
export interface JournalRow {
  timestamp: string;
  session_id: string;
  user_id: string;
  agent: JournalAgent;
  action: string;
  symbol: string | null;
  chain: string | null;
  size: number | null;
  price: number | null;
  pnl: number | null;
  shield_reasons: string[];
  tags: string[];
  mode: JournalMode;
}

export interface JournalAppendResult {
  stored: number;
  skipped: number;
  files: string[];
}

export function stampDrafts(
  drafts: JournalDraft[],
  ctx: { sessionId: string; userId: string; now?: Date; mode?: JournalMode },
): JournalRow[] {
  const now = ctx.now ?? new Date();
  const timestamp = now.toISOString();
  return drafts.map((draft) => ({
    timestamp,
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    agent: draft.agent,
    action: draft.action,
    symbol: draft.symbol ?? null,
    chain: draft.chain ?? null,
    size: draft.size ?? null,
    price: draft.price ?? null,
    pnl: draft.pnl ?? null,
    shield_reasons: draft.shieldReasons ?? [],
    tags: draft.tags ?? [],
    mode: draft.mode ?? ctx.mode ?? "paper",
  }));
}

export function appendJournalRows(
  rows: JournalRow[],
  opts: { root?: string; dbPath?: string } = {},
): JournalAppendResult {
  const root = opts.root ?? journalRoot();
  const dbPath = opts.dbPath ?? durableDbPath();
  const accepted: JournalRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (containsPrivateKeyMaterial(JSON.stringify(row))) {
      skipped += 1;
      continue;
    }
    accepted.push(row);
  }
  if (accepted.length === 0) return { stored: 0, skipped, files: [] };

  const files = writeJsonl(root, accepted);
  insertJournalRows(openDurable(dbPath), accepted);
  return { stored: accepted.length, skipped, files };
}

export function loadJournalRows(
  opts: { root?: string; dbPath?: string; userId?: string; day?: string } = {},
): JournalRow[] {
  const dbPath = opts.dbPath ?? durableDbPath();
  if (fs.existsSync(dbPath)) {
    try {
      const fromDb = listJournal(openDurable(dbPath), {
        userId: opts.userId,
        day: opts.day,
      });
      if (fromDb.length > 0) return fromDb;
    } catch (err) {
      console.warn(
        "[bba] journal sqlite read failed; falling back to JSONL.",
        err instanceof Error ? err.message : "error",
      );
    }
  }
  const fromFiles = readJournalFiles(opts.root ?? journalRoot());
  return fromFiles.filter((row) => {
    if (opts.userId && row.user_id !== opts.userId) return false;
    if (opts.day && row.timestamp.slice(0, 10) !== opts.day) return false;
    return true;
  });
}

export function readJournalFiles(root: string): JournalRow[] {
  const daysDir = path.join(root, "days");
  if (!fs.existsSync(daysDir)) return [];
  const rows: JournalRow[] = [];
  const days = fs.readdirSync(daysDir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
  for (const day of days) {
    const file = journalFileForDay(root, day);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<JournalRow>;
        if (!parsed || typeof parsed !== "object") continue;
        if (!parsed.timestamp || !parsed.agent || !parsed.action) continue;
        rows.push(normalizeRow(parsed));
      } catch {
        // Skip a torn line. Do not invent a replacement row.
      }
    }
  }
  return rows;
}

function writeJsonl(root: string, rows: JournalRow[]): string[] {
  const byDay = new Map<string, JournalRow[]>();
  for (const row of rows) {
    const day = utcDay(new Date(row.timestamp));
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }
  const files: string[] = [];
  for (const [day, bucket] of byDay) {
    const file = journalFileForDay(root, day);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = bucket.map((row) => JSON.stringify(row)).join("\n") + "\n";
    fs.appendFileSync(file, payload, "utf8");
    files.push(file);
  }
  return files;
}

function normalizeRow(parsed: Partial<JournalRow>): JournalRow {
  return {
    timestamp: String(parsed.timestamp),
    session_id: String(parsed.session_id ?? ""),
    user_id: String(parsed.user_id ?? ""),
    agent: parsed.agent as JournalAgent,
    action: String(parsed.action),
    symbol: parsed.symbol ?? null,
    chain: parsed.chain ?? null,
    size: parsed.size ?? null,
    price: parsed.price ?? null,
    pnl: parsed.pnl ?? null,
    shield_reasons: Array.isArray(parsed.shield_reasons)
      ? parsed.shield_reasons.map((item) => String(item))
      : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => String(item)) : [],
    mode: parsed.mode === "live" ? "live" : "paper",
  };
}

function containsPrivateKeyMaterial(value: string): boolean {
  if (/0x[a-fA-F0-9]{64}/.test(value)) return true;
  if (/[1-9A-HJ-NP-Za-km-z]{80,120}/.test(value)) return true;
  return false;
}
