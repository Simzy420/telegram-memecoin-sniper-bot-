import fs from "node:fs";
import path from "node:path";
import { loadPaperWallet, openDurable, savePaperWallet } from "../db/durable.js";
import { durableDbPath } from "./paths.js";
import { freshDesk, type DeskState } from "./paper.js";

const memory = new Map<string, DeskState>();

function persistPath(): string | null {
  if (process.env.PAPER_DESK_PATH === "") return null;
  if (process.env.PAPER_DESK_PATH) return process.env.PAPER_DESK_PATH;
  return null;
}

function useSqlite(): boolean {
  if (process.env.PAPER_DESK_PATH === "") return false;
  if (process.env.PAPER_DESK_PATH) return false;
  if (process.env.NODE_TEST_CONTEXT && !process.env.DURABLE_DB_PATH?.trim()) return false;
  return true;
}

export function loadSession(telegramId: string): DeskState {
  const cached = memory.get(telegramId);
  if (cached) return structuredClone(cached);
  const state = readOne(telegramId) ?? freshDesk();
  memory.set(telegramId, state);
  return structuredClone(state);
}

export function saveSession(telegramId: string, state: DeskState): void {
  const copy = structuredClone(state);
  memory.set(telegramId, copy);
  if (useSqlite()) {
    savePaperWallet(openDurable(durableDbPath()), {
      userId: telegramId,
      cashUsd: copy.cashUsd,
      bankrollUsd: copy.bankrollUsd,
      stateJson: JSON.stringify(copy),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  const file = persistPath();
  if (!file) return;
  const all = readAll();
  all[telegramId] = copy;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all));
}

export function resetSessionsForTests(): void {
  memory.clear();
}

function readOne(telegramId: string): DeskState | null {
  if (useSqlite()) {
    const row = loadPaperWallet(openDurable(durableDbPath()), telegramId);
    if (!row) return null;
    return parseState(row.stateJson);
  }
  return readAll()[telegramId] ?? null;
}

function parseState(raw: string): DeskState | null {
  try {
    const parsed = JSON.parse(raw) as DeskState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readAll(): Record<string, DeskState> {
  const file = persistPath();
  if (!file || !fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, DeskState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
