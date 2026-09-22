import type { JournalRow } from "./journal.js";
import { usd } from "./paper.js";

export interface RankedName {
  name: string;
  pnl: number;
}

export interface LearnSummary {
  rows: number;
  realised: number;
  flatExcluded: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancy: number | null;
  shieldBlocks: number;
  shieldCorrect: number;
  shieldWrong: number;
  shieldUnlabelled: number;
  shieldAccuracy: number | null;
  topSymbols: RankedName[];
  bottomSymbols: RankedName[];
  topStrategies: RankedName[];
  bottomStrategies: RankedName[];
  inventedFills: false;
}

const CLOSE_ACTIONS = new Set(["paper_close", "live_close"]);

export function summarizeJournal(rows: JournalRow[]): LearnSummary {
  const realised = rows.filter(isRealisedClose);
  const decided = realised.filter((row) => row.pnl !== 0);
  const flatExcluded = realised.length - decided.length;
  const wins = decided.filter((row) => (row.pnl ?? 0) > 0).length;
  const losses = decided.filter((row) => (row.pnl ?? 0) < 0).length;
  const decidedCount = wins + losses;
  const winRate = decidedCount === 0 ? null : wins / decidedCount;
  const expectancy =
    decidedCount === 0
      ? null
      : decided.reduce((sum, row) => sum + (row.pnl ?? 0), 0) / decidedCount;

  const shield = scoreShield(rows, decided);
  const symbols = rank(sumBy(decided, (row) => row.symbol));
  const strategies = rank(sumBy(decided, strategyName));

  return {
    rows: rows.length,
    realised: realised.length,
    flatExcluded,
    wins,
    losses,
    winRate,
    expectancy,
    shieldBlocks: shield.blocks,
    shieldCorrect: shield.correct,
    shieldWrong: shield.wrong,
    shieldUnlabelled: shield.unlabelled,
    shieldAccuracy: shield.accuracy,
    topSymbols: symbols.top,
    bottomSymbols: symbols.bottom,
    topStrategies: strategies.top,
    bottomStrategies: strategies.bottom,
    inventedFills: false,
  };
}

export function formatLearnSummary(summary: LearnSummary): string {
  const lines = [
    `Journal rows: ${summary.rows}. Invented fills: 0.`,
    winRateLine(summary),
    expectancyLine(summary),
    flatLine(summary),
    shieldLine(summary),
    rankLine("Top symbols", summary.topSymbols),
    rankLine("Bottom symbols", summary.bottomSymbols),
    rankLine("Top strategies", summary.topStrategies),
    rankLine("Bottom strategies", summary.bottomStrategies),
  ];
  return lines.join("\n");
}

function isRealisedClose(row: JournalRow): boolean {
  if (typeof row.pnl !== "number" || Number.isNaN(row.pnl)) return false;
  if (CLOSE_ACTIONS.has(row.action)) return true;
  return row.tags.includes("outcome:realised");
}

function winRateLine(summary: LearnSummary): string {
  if (summary.winRate == null) {
    return "Win rate: no realised closes with non-zero PnL.";
  }
  const pct = (summary.winRate * 100).toFixed(1);
  return `Win rate: ${pct}% (${summary.wins} wins, ${summary.losses} losses) on realised closes.`;
}

function expectancyLine(summary: LearnSummary): string {
  if (summary.expectancy == null) {
    return "Expectancy: unavailable. No non-zero PnL rows were recorded.";
  }
  return `Expectancy: ${usd(summary.expectancy)} average PnL per realised close.`;
}

function flatLine(summary: LearnSummary): string {
  if (summary.flatExcluded === 0) return "Flat closes excluded: 0.";
  return `Flat closes excluded: ${summary.flatExcluded}. PnL was exactly 0, so they are not counted as wins or losses.`;
}

function shieldLine(summary: LearnSummary): string {
  if (summary.shieldBlocks === 0) {
    return "Shield block accuracy: no Shield blocks in the journal.";
  }
  if (summary.shieldAccuracy == null) {
    return `Shield block accuracy: not enough labelled outcomes (${summary.shieldBlocks} blocks, ${summary.shieldUnlabelled} unlabelled). Unlabelled blocks are not scored.`;
  }
  const pct = (summary.shieldAccuracy * 100).toFixed(1);
  return `Shield block accuracy: ${pct}% (${summary.shieldCorrect} correct, ${summary.shieldWrong} wrong, ${summary.shieldUnlabelled} unlabelled). A block is labelled only when a later realised close on that symbol has non-zero PnL.`;
}

function rankLine(label: string, ranks: RankedName[]): string {
  if (ranks.length === 0) return `${label}: none with non-zero realised PnL.`;
  return `${label}: ${ranks.map((rank) => `${rank.name} ${usd(rank.pnl)}`).join(", ")}.`;
}

function scoreShield(
  rows: JournalRow[],
  decided: JournalRow[],
): { blocks: number; correct: number; wrong: number; unlabelled: number; accuracy: number | null } {
  const blocks = rows.filter(
    (row) => row.agent === "shield" && row.symbol && verdictOf(row) === "block",
  );
  let correct = 0;
  let wrong = 0;
  let unlabelled = 0;
  for (const block of blocks) {
    const later = decided.filter(
      (row) =>
        row.symbol === block.symbol &&
        row.user_id === block.user_id &&
        row.timestamp > block.timestamp,
    );
    if (later.length === 0) {
      unlabelled += 1;
      continue;
    }
    const pnl = later.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
    if (pnl < 0) correct += 1;
    else if (pnl > 0) wrong += 1;
    else unlabelled += 1;
  }
  const labelled = correct + wrong;
  return {
    blocks: blocks.length,
    correct,
    wrong,
    unlabelled,
    accuracy: labelled === 0 ? null : correct / labelled,
  };
}

function verdictOf(row: JournalRow): string | null {
  const tagged = row.tags.find((tag) => tag.startsWith("verdict:"));
  if (tagged) return tagged.slice("verdict:".length);
  const reason = row.shield_reasons.find((item) => item.startsWith("verdict:"));
  return reason ? reason.slice("verdict:".length) : null;
}

function strategyName(row: JournalRow): string | null {
  const tagged = row.tags.find((tag) => tag.startsWith("strategy:"));
  return tagged ?? null;
}

function sumBy(rows: JournalRow[], keyOf: (row: JournalRow) => string | null): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + (row.pnl ?? 0));
  }
  for (const [key, pnl] of totals) {
    if (pnl === 0) totals.delete(key);
  }
  return totals;
}

function rank(totals: Map<string, number>): { top: RankedName[]; bottom: RankedName[] } {
  const ranked = [...totals.entries()]
    .map(([name, pnl]) => ({ name, pnl }))
    .sort((a, b) => b.pnl - a.pnl || a.name.localeCompare(b.name));
  return {
    top: ranked.slice(0, 3),
    bottom: [...ranked].sort((a, b) => a.pnl - b.pnl || a.name.localeCompare(b.name)).slice(0, 3),
  };
}
