import fs from "node:fs";
import path from "node:path";
import type { JournalRow } from "./journal.js";

const COLUMNS = [
  "timestamp",
  "session_id",
  "user_id",
  "agent",
  "action",
  "symbol",
  "chain",
  "size",
  "price",
  "pnl",
  "shield_reasons",
  "tags",
  "mode",
] as const;

export function journalToJsonl(rows: JournalRow[]): string {
  if (rows.length === 0) return "";
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function journalToCsv(rows: JournalRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.timestamp,
        row.session_id,
        row.user_id,
        row.agent,
        row.action,
        row.symbol ?? "",
        row.chain ?? "",
        num(row.size),
        num(row.price),
        num(row.pnl),
        JSON.stringify(row.shield_reasons),
        JSON.stringify(row.tags),
        row.mode,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function writeJournalExport(
  rows: JournalRow[],
  destDir: string,
  now: Date = new Date(),
): { csvPath: string; jsonlPath: string; count: number } {
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const csvPath = path.join(destDir, `journal-${stamp}.csv`);
  const jsonlPath = path.join(destDir, `journal-${stamp}.jsonl`);
  fs.writeFileSync(csvPath, journalToCsv(rows), "utf8");
  fs.writeFileSync(jsonlPath, journalToJsonl(rows), "utf8");
  return { csvPath, jsonlPath, count: rows.length };
}

function num(value: number | null): string {
  return value == null ? "" : String(value);
}

function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}
