import pg from "pg";
import type { AgentStatus } from "@snipr/shared";
import { config } from "../config.js";
import {
  getStoredUser,
  openDurable,
  saveStoredWallet,
  setStoredAgentStatus,
  upsertStoredUser,
  type StoredUser,
} from "./durable.js";
import { durableDbPath } from "../team/paths.js";

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
let store: "postgres" | "sqlite" | "memory" | null = null;

export function userStoreKind(): "postgres" | "sqlite" | "memory" {
  return store ?? "memory";
}

export function resetUserStoreForTests(): void {
  store = null;
  memory.clear();
}

async function resolveStore(): Promise<"postgres" | "sqlite" | "memory"> {
  if (store) return store;
  if (process.env.SKIP_DATABASE === "1") {
    store = "memory";
    return store;
  }
  if (process.env.FORCE_DURABLE_SQLITE === "1") {
    store = "sqlite";
    return store;
  }
  try {
    await pool.query("SELECT 1");
    store = "postgres";
  } catch {
    if (process.env.SKIP_SQLITE === "1") {
      store = "memory";
      console.warn(
        "[bba] Postgres unavailable — user records stay in memory for this process.",
      );
    } else {
      store = "sqlite";
      console.warn(
        `[bba] Postgres unavailable — user wallets and the paper book use SQLite at ${durableDbPath()}.`,
      );
    }
  }
  return store;
}

async function canPersist(): Promise<boolean> {
  const kind = await resolveStore();
  return kind === "postgres";
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
  const kind = await resolveStore();
  if (kind === "sqlite") {
    openDurable(durableDbPath());
    return;
  }
  if (kind !== "postgres") return;
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

function fromStored(row: StoredUser): UserRow {
  return {
    telegram_id: row.telegram_id,
    username: row.username,
    agent_status: row.agent_status as AgentStatus,
    evm_address: row.evm_address,
    sol_address: row.sol_address,
    evm_pk_enc: row.evm_pk_enc,
    sol_pk_enc: row.sol_pk_enc,
    promo_started_at: row.promo_started_at ? new Date(row.promo_started_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function upsertUser(
  telegramId: string,
  username: string | null,
): Promise<UserRow> {
  if ((await resolveStore()) === "sqlite") {
    const now = new Date().toISOString();
    return fromStored(upsertStoredUser(openDurable(durableDbPath()), telegramId, username, now));
  }
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
  if ((await resolveStore()) === "sqlite") {
    const row = getStoredUser(openDurable(durableDbPath()), telegramId);
    return row ? fromStored(row) : null;
  }
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
  if ((await resolveStore()) === "sqlite") {
    const now = new Date().toISOString();
    return fromStored(
      saveStoredWallet(openDurable(durableDbPath()), telegramId, wallet, now),
    );
  }
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
  if ((await resolveStore()) === "sqlite") {
    setStoredAgentStatus(
      openDurable(durableDbPath()),
      telegramId,
      status,
      new Date().toISOString(),
    );
    return;
  }
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
