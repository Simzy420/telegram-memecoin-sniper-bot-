import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JournalRow } from "../team/journal.js";
import { durableDbPath } from "../team/paths.js";

const cache = new Map<string, DatabaseSync>();

export function openDurable(dbPath: string = durableDbPath()): DatabaseSync {
  const existing = cache.get(dbPath);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 3000");
  migrateDurable(db);
  cache.set(dbPath, db);
  return db;
}

export function closeDurable(dbPath?: string): void {
  if (!dbPath) {
    for (const db of cache.values()) db.close();
    cache.clear();
    return;
  }
  const db = cache.get(dbPath);
  if (!db) return;
  db.close();
  cache.delete(dbPath);
}

export function migrateDurable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      day TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      symbol TEXT,
      chain TEXT,
      size REAL,
      price REAL,
      pnl REAL,
      shield_reasons TEXT NOT NULL,
      tags TEXT NOT NULL,
      mode TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journal_events_user_time
      ON journal_events (user_id, timestamp);
    CREATE TABLE IF NOT EXISTS paper_wallets (
      user_id TEXT PRIMARY KEY,
      cash_usd REAL NOT NULL,
      bankroll_usd REAL NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      agent_status TEXT NOT NULL DEFAULT 'new',
      evm_address TEXT,
      sol_address TEXT,
      evm_pk_enc TEXT,
      sol_pk_enc TEXT,
      promo_started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function insertJournalRows(db: DatabaseSync, rows: JournalRow[]): void {
  if (rows.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO journal_events (
      timestamp, day, session_id, user_id, agent, action, symbol, chain,
      size, price, pnl, shield_reasons, tags, mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      insert.run(
        row.timestamp,
        row.timestamp.slice(0, 10),
        row.session_id,
        row.user_id,
        row.agent,
        row.action,
        row.symbol,
        row.chain,
        row.size,
        row.price,
        row.pnl,
        JSON.stringify(row.shield_reasons),
        JSON.stringify(row.tags),
        row.mode,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listJournal(
  db: DatabaseSync,
  filter: { userId?: string; day?: string } = {},
): JournalRow[] {
  const clauses: string[] = [];
  const params: Array<string | null> = [];
  if (filter.userId) {
    clauses.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.day) {
    clauses.push("day = ?");
    params.push(filter.day);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = db
    .prepare(
      `SELECT timestamp, session_id, user_id, agent, action, symbol, chain, size, price, pnl, shield_reasons, tags, mode
       FROM journal_events ${where} ORDER BY timestamp, id`,
    )
    .all(...params);
  return result.map(parseJournalRow);
}

function parseJournalRow(raw: Record<string, unknown>): JournalRow {
  return {
    timestamp: String(raw.timestamp),
    session_id: String(raw.session_id),
    user_id: String(raw.user_id),
    agent: String(raw.agent) as JournalRow["agent"],
    action: String(raw.action),
    symbol: raw.symbol == null ? null : String(raw.symbol),
    chain: raw.chain == null ? null : String(raw.chain),
    size: raw.size == null ? null : Number(raw.size),
    price: raw.price == null ? null : Number(raw.price),
    pnl: raw.pnl == null ? null : Number(raw.pnl),
    shield_reasons: parseStringList(raw.shield_reasons),
    tags: parseStringList(raw.tags),
    mode: raw.mode === "live" ? "live" : "paper",
  };
}

function parseStringList(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export interface PaperWalletRecord {
  userId: string;
  cashUsd: number;
  bankrollUsd: number;
  stateJson: string;
  updatedAt: string;
}

export function savePaperWallet(db: DatabaseSync, record: PaperWalletRecord): void {
  db.prepare(
    `INSERT INTO paper_wallets (user_id, cash_usd, bankroll_usd, state_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       cash_usd = excluded.cash_usd,
       bankroll_usd = excluded.bankroll_usd,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  ).run(record.userId, record.cashUsd, record.bankrollUsd, record.stateJson, record.updatedAt);
}

export function loadPaperWallet(db: DatabaseSync, userId: string): PaperWalletRecord | null {
  const row = db
    .prepare(
      `SELECT user_id, cash_usd, bankroll_usd, state_json, updated_at
       FROM paper_wallets WHERE user_id = ?`,
    )
    .get(userId);
  if (!row) return null;
  return {
    userId: String(row.user_id),
    cashUsd: Number(row.cash_usd),
    bankrollUsd: Number(row.bankroll_usd),
    stateJson: String(row.state_json),
    updatedAt: String(row.updated_at),
  };
}

export interface StoredUser {
  telegram_id: string;
  username: string | null;
  agent_status: string;
  evm_address: string | null;
  sol_address: string | null;
  evm_pk_enc: string | null;
  sol_pk_enc: string | null;
  promo_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertStoredUser(
  db: DatabaseSync,
  telegramId: string,
  username: string | null,
  nowIso: string,
): StoredUser {
  db.prepare(
    `INSERT INTO users (telegram_id, username, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       updated_at = excluded.updated_at`,
  ).run(telegramId, username, nowIso, nowIso);
  return getStoredUser(db, telegramId)!;
}

export function getStoredUser(db: DatabaseSync, telegramId: string): StoredUser | null {
  const row = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
  if (!row) return null;
  return {
    telegram_id: String(row.telegram_id),
    username: row.username == null ? null : String(row.username),
    agent_status: String(row.agent_status),
    evm_address: row.evm_address == null ? null : String(row.evm_address),
    sol_address: row.sol_address == null ? null : String(row.sol_address),
    evm_pk_enc: row.evm_pk_enc == null ? null : String(row.evm_pk_enc),
    sol_pk_enc: row.sol_pk_enc == null ? null : String(row.sol_pk_enc),
    promo_started_at: row.promo_started_at == null ? null : String(row.promo_started_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function saveStoredWallet(
  db: DatabaseSync,
  telegramId: string,
  wallet: {
    evmAddress: string;
    solAddress: string;
    evmPrivateKeyEnc: string;
    solPrivateKeyEnc: string;
  },
  nowIso: string,
): StoredUser {
  const existing = getStoredUser(db, telegramId);
  if (!existing) {
    upsertStoredUser(db, telegramId, null, nowIso);
  }
  db.prepare(
    `UPDATE users SET
       evm_address = ?,
       sol_address = ?,
       evm_pk_enc = ?,
       sol_pk_enc = ?,
       agent_status = 'wallet_ready',
       promo_started_at = COALESCE(promo_started_at, ?),
       updated_at = ?
     WHERE telegram_id = ?`,
  ).run(
    wallet.evmAddress,
    wallet.solAddress,
    wallet.evmPrivateKeyEnc,
    wallet.solPrivateKeyEnc,
    nowIso,
    nowIso,
    telegramId,
  );
  return getStoredUser(db, telegramId)!;
}

export function setStoredAgentStatus(
  db: DatabaseSync,
  telegramId: string,
  status: string,
  nowIso: string,
): void {
  db.prepare(`UPDATE users SET agent_status = ?, updated_at = ? WHERE telegram_id = ?`).run(
    status,
    nowIso,
    telegramId,
  );
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key);
  return row ? String(row.value) : null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
