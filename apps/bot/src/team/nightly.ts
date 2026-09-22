import { getMeta, setMeta, openDurable } from "../db/durable.js";
import { loadJournalRows, type JournalRow } from "./journal.js";
import { formatLearnSummary, summarizeJournal } from "./learn.js";
import { durableDbPath } from "./paths.js";

export function nightlyMessage(rows: JournalRow[], day: string): string | null {
  const todays = rows.filter((row) => row.timestamp.slice(0, 10) === day);
  if (todays.length === 0) return null;
  return [`Nightly journal ${day} UTC`, formatLearnSummary(summarizeJournal(todays))].join("\n");
}

export type NightlyTick = "skipped-hour" | "already" | "empty" | "sent";

export async function runNightlyTick(opts: {
  now?: Date;
  rows?: JournalRow[];
  alreadySent?: (day: string) => boolean;
  markSent?: (day: string) => void;
  send?: (text: string) => Promise<void>;
}): Promise<NightlyTick> {
  const now = opts.now ?? new Date();
  if (now.getUTCHours() !== 0) return "skipped-hour";
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  const day = yesterday.toISOString().slice(0, 10);
  if (opts.alreadySent?.(day)) return "already";
  const rows = opts.rows ?? loadJournalRows();
  const text = nightlyMessage(rows, day);
  if (!text) return "empty";
  if (opts.send) await opts.send(text);
  opts.markSent?.(day);
  return "sent";
}

export function startNightlyLearn(opts: {
  send: (text: string) => Promise<unknown>;
  intervalMs?: number;
}): { stop: () => void } {
  const timer = setInterval(() => {
    void runNightlyTick({
      send: async (text) => {
        await opts.send(text);
      },
      alreadySent: (day) => readSent(day),
      markSent: (day) => writeSent(day),
    }).catch((err) => {
      console.warn(
        "[bba] nightly journal summary failed",
        err instanceof Error ? err.message : "error",
      );
    });
  }, opts.intervalMs ?? 15 * 60 * 1000);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

function sentKey(day: string): string {
  return `nightly-sent:${day}`;
}

function readSent(day: string): boolean {
  try {
    return getMeta(openDurable(durableDbPath()), sentKey(day)) === "1";
  } catch {
    return false;
  }
}

function writeSent(day: string): void {
  setMeta(openDurable(durableDbPath()), sentKey(day), "1");
}
