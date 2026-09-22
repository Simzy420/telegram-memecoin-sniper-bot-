import fs from "node:fs";
import path from "node:path";

function canWriteDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory() && fs.accessSync(dir, fs.constants.W_OK) === undefined;
  } catch {
    return false;
  }
}

/**
 * Persistent root.
 * Hugging Face: mount Space storage or a bucket at `/data` (the image sets DATA_DIR=/data).
 * Locally, when `/data` is missing, this is `./data`.
 */
export function resolveDataDir(): string {
  const fromEnv = process.env.DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (canWriteDir("/data")) return "/data";
  return path.resolve("data");
}

/** Daily JSONL lives at `{journalRoot}/days/YYYY-MM-DD/events.jsonl`. */
export function journalRoot(): string {
  const fromEnv = process.env.JOURNAL_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const data = resolveDataDir();
  if (process.env.DATA_DIR?.trim() || data === "/data") return path.join(data, "logs");
  return path.resolve("logs");
}

export function durableDbPath(): string {
  const fromEnv = process.env.DURABLE_DB_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveDataDir(), "durable.sqlite");
}

export function exportDir(): string {
  const fromEnv = process.env.EXPORT_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveDataDir(), "exports");
}

/** Tests stay quiet unless they point at a temp journal or database. */
export function shouldPersistJournal(): boolean {
  if (process.env.JOURNAL_DISABLED === "1") return false;
  if (
    process.env.NODE_TEST_CONTEXT &&
    !process.env.JOURNAL_ROOT?.trim() &&
    !process.env.DURABLE_DB_PATH?.trim()
  ) {
    return false;
  }
  return true;
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function journalFileForDay(root: string, day: string): string {
  return path.join(root, "days", day, "events.jsonl");
}
