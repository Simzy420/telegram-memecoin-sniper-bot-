import fs from "node:fs";
import path from "node:path";
import { freshDesk, type DeskState } from "./paper.js";

const memory = new Map<string, DeskState>();

function persistPath(): string | null {
  if (process.env.PAPER_DESK_PATH === "") return null;
  if (process.env.PAPER_DESK_PATH) return process.env.PAPER_DESK_PATH;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return path.resolve("data/paper-desk.json");
}

export function loadSession(telegramId: string): DeskState {
  const cached = memory.get(telegramId);
  if (cached) return structuredClone(cached);
  const fromDisk = readAll()[telegramId];
  const state = fromDisk ?? freshDesk();
  memory.set(telegramId, state);
  return structuredClone(state);
}

export function saveSession(telegramId: string, state: DeskState): void {
  const copy = structuredClone(state);
  memory.set(telegramId, copy);
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
