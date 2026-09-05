import pg from "pg";
import type { AgentStatus } from "@snipr/shared";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

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
  await pool.query(
    `UPDATE users SET agent_status = $2, updated_at = NOW() WHERE telegram_id = $1`,
    [telegramId, status],
  );
}
