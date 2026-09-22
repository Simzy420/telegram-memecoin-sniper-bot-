import pg from "pg";
import type { AgentStatus } from "@snipr/shared";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 2000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.warn("[bba] postgres pool error", err.message);
});

const memory = new Map<string, UserRow>();
let persist: boolean | null = null;

export function userStoreKind(): "postgres" | "memory" {
  return persist === true ? "postgres" : "memory";
}

async function canPersist(): Promise<boolean> {
  if (process.env.SKIP_DATABASE === "1") {
    persist = false;
    return false;
  }
  if (persist !== null) return persist;
  try {
    await pool.query("SELECT 1");
    persist = true;
  } catch {
    persist = false;
    console.warn(
      "[bba] Postgres unavailable — user records stay in memory for this process.",
    );
  }
  return persist;
}

function blankUser(telegramId: string, username: string | null): UserRow {
  const now = new Date();
  return {
    telegram_id: telegramId,
    username,
    agent_status: "new",
    evm_address: null,
    sol_address: null,
    evm_pk_enc: null,
    sol_pk_enc: null,
    promo_started_at: null,
    created_at: now,
    updated_at: now,
  };
}

export interface UserRow {
  telegram_id: string;
  username: string | null;
  agent_status: AgentStatus;
  evm_address: string | null;
  sol_address: string | null;
  evm_pk_enc: string | null;
  sol_pk_enc: string | null;
  promo_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function migrate(): Promise<void> {
  if (!(await canPersist())) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      agent_status TEXT NOT NULL DEFAULT 'new',
      evm_address TEXT,
      sol_address TEXT,
      evm_pk_enc TEXT,
      sol_pk_enc TEXT,
      promo_started_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function upsertUser(
  telegramId: string,
  username: string | null,
): Promise<UserRow> {
  if (!(await canPersist())) {
    const existing = memory.get(telegramId);
    if (existing) {
      existing.username = username;
      existing.updated_at = new Date();
      return existing;
    }
    const created = blankUser(telegramId, username);
    memory.set(telegramId, created);
    return created;
  }
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (telegram_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       updated_at = NOW()
     RETURNING *`,
    [telegramId, username],
  );
  return rows[0]!;
}

export async function getUser(telegramId: string): Promise<UserRow | null> {
  if (!(await canPersist())) return memory.get(telegramId) ?? null;
  const { rows } = await pool.query<UserRow>(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return rows[0] ?? null;
}

export async function saveGeneratedWallet(
  telegramId: string,
  wallet: {
    evmAddress: string;
    solAddress: string;
    evmPrivateKeyEnc: string;
    solPrivateKeyEnc: string;
  },
): Promise<UserRow> {
  if (!(await canPersist())) {
    const existing = memory.get(telegramId) ?? blankUser(telegramId, null);
    existing.evm_address = wallet.evmAddress;
    existing.sol_address = wallet.solAddress;
    existing.evm_pk_enc = wallet.evmPrivateKeyEnc;
    existing.sol_pk_enc = wallet.solPrivateKeyEnc;
    existing.agent_status = "wallet_ready";
    existing.promo_started_at = existing.promo_started_at ?? new Date();
    existing.updated_at = new Date();
    memory.set(telegramId, existing);
    return existing;
  }
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET
       evm_address = $2,
       sol_address = $3,
       evm_pk_enc = $4,
       sol_pk_enc = $5,
       agent_status = 'wallet_ready',
       promo_started_at = COALESCE(promo_started_at, NOW()),
       updated_at = NOW()
     WHERE telegram_id = $1
     RETURNING *`,
    [
      telegramId,
      wallet.evmAddress,
      wallet.solAddress,
      wallet.evmPrivateKeyEnc,
      wallet.solPrivateKeyEnc,
    ],
  );
  return rows[0]!;
}

export async function setAgentStatus(
  telegramId: string,
  status: AgentStatus,
): Promise<void> {
  if (!(await canPersist())) {
    const existing = memory.get(telegramId);
    if (existing) {
      existing.agent_status = status;
      existing.updated_at = new Date();
    }
    return;
  }
  await pool.query(
    `UPDATE users SET agent_status = $2, updated_at = NOW() WHERE telegram_id = $1`,
    [telegramId, status],
  );
}
