import type { Candidate } from "./candidates.js";
import type { SpecialistId } from "./personas.js";
import { SPECIALIST_IDS } from "./personas.js";
import type { ShieldVerdict } from "./safety.js";

export const PAPER_BANKROLL_USD = 1000;
export const PAPER_SIZE_USD = 50;
export const PAPER_CAUTION_USD = 25;

export interface PaperPosition {
  id: string;
  symbol: string;
  chain: string;
  address: string;
  sizeUsd: number;
  openedAt: string;
  status: "open" | "closed";
  pnlUsd: number;
  note: string;
  /** DexScreener USD mark at the paper fill. Null when that read failed. */
  entryPriceUsd?: number | null;
  /**
   * Later observed USD mark (ledger refresh). Not set at the fill.
   * A failed close may use this. It must not reuse the entry print as an exit.
   */
  lastMarkUsd?: number | null;
}

export interface PaperClose {
  state: DeskState;
  closed: PaperPosition | null;
  /** Exit mark used for PnL, or null when no exit mark was observed. */
  exitPriceUsd: number | null;
  /**
   * Realised paper PnL for the journal.
   * Null when entry or exit was not observed. Zero is a real flat move.
   */
  journalPnlUsd: number | null;
}

export interface JournalEntry {
  at: string;
  text: string;
}

export interface DeskState {
  hired: SpecialistId[];
  watching: boolean;
  bankrollUsd: number;
  cashUsd: number;
  positions: PaperPosition[];
  journal: JournalEntry[];
  lastCandidates: Candidate[];
}

export function freshDesk(): DeskState {
  return {
    hired: [],
    watching: false,
    bankrollUsd: PAPER_BANKROLL_USD,
    cashUsd: PAPER_BANKROLL_USD,
    positions: [],
    journal: [],
    lastCandidates: [],
  };
}

export function usd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Token marks can be far below one cent. PnL still uses usd(). */
export function formatMark(price: number): string {
  if (!Number.isFinite(price) || !(price > 0)) return "n/a";
  if (price >= 1) {
    return price.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  return `$${Number(price.toPrecision(6)).toString()}`;
}

/**
 * Paper mark-to-market PnL for a long clip.
 *
 * pnlUsd = sizeUsd * (exitPriceUsd - entryPriceUsd) / entryPriceUsd
 *
 * sizeUsd is the paper dollars spent at the entry mark, so the clip is fully
 * invested long. A higher exit mark is a gain. A lower exit mark is a loss.
 * Returns null when either price was not observed, is not finite, or is not
 * positive. This does not invent a price.
 */
export function paperPnlUsd(
  sizeUsd: number,
  entryPriceUsd: number | null | undefined,
  exitPriceUsd: number | null | undefined,
): number | null {
  const entry = observedPrice(entryPriceUsd);
  const exit = observedPrice(exitPriceUsd);
  if (entry == null || exit == null) return null;
  if (!Number.isFinite(sizeUsd)) return null;
  return round2((sizeUsd * (exit - entry)) / entry);
}

export function hireTroop(state: DeskState, at: string): DeskState {
  return note(
    { ...state, hired: [...SPECIALIST_IDS] },
    at,
    "Hired Scout, Sniper, Pulse, Ledger, and Shield onto the paper desk.",
  );
}

export function openPaperPosition(
  state: DeskState,
  candidate: Candidate,
  verdict: ShieldVerdict,
  at: string,
  entryPriceUsd: number | null = null,
): { state: DeskState; position: PaperPosition | null; reason: string } {
  if (verdict === "block") {
    return {
      state,
      position: null,
      reason: "Shield blocked this name. No paper fill.",
    };
  }
  const existing = state.positions.find(
    (p) => p.status === "open" && p.symbol === candidate.symbol,
  );
  if (existing) {
    return {
      state,
      position: existing,
      reason: `${candidate.symbol} is already an open paper position.`,
    };
  }
  const size = verdict === "caution" ? PAPER_CAUTION_USD : PAPER_SIZE_USD;
  if (state.cashUsd < size) {
    return {
      state,
      position: null,
      reason: `Paper cash ${usd(state.cashUsd)} is below the ${usd(size)} clip.`,
    };
  }
  const entry = observedPrice(entryPriceUsd);
  const position: PaperPosition = {
    id: `${candidate.symbol}-${at}`,
    symbol: candidate.symbol,
    chain: candidate.chain,
    address: candidate.address,
    sizeUsd: size,
    openedAt: at,
    status: "open",
    pnlUsd: 0,
    entryPriceUsd: entry,
    lastMarkUsd: null,
    note: fillNote(verdict, entry),
  };
  const priceBit =
    entry == null ? "Mark unavailable." : `Entry ${formatMark(entry)}.`;
  const next = note(
    {
      ...state,
      cashUsd: round2(state.cashUsd - size),
      positions: [...state.positions, position],
    },
    at,
    `Paper fill ${candidate.symbol} ${usd(size)} on ${candidate.chain}. ${priceBit} No transaction broadcast.`,
  );
  return { state: next, position, reason: position.note };
}

/**
 * Close a paper clip.
 *
 * exitPriceUsd is a fresh read. When that read fails, lastMarkUsd from a
 * later ledger refresh is the exit. The entry print is not reused as an
 * exit: with no observed exit, PnL stays 0 and journalPnlUsd stays null.
 *
 * Realised cash adds sizeUsd plus pnlUsd. See paperPnlUsd for the formula.
 */
export function closePaperPosition(
  state: DeskState,
  symbol: string,
  at: string,
  exitPriceUsd: number | null = null,
): PaperClose {
  const idx = state.positions.findIndex(
    (p) => p.status === "open" && p.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (idx < 0) {
    return { state, closed: null, exitPriceUsd: null, journalPnlUsd: null };
  }
  const current = state.positions[idx]!;
  const entry = observedPrice(current.entryPriceUsd);
  const fresh = observedPrice(exitPriceUsd);
  const last = observedPrice(current.lastMarkUsd);
  const source: "fresh" | "last_known" | "unavailable" =
    fresh != null ? "fresh" : last != null ? "last_known" : "unavailable";
  const exit = fresh ?? last;
  const journalPnlUsd =
    source === "unavailable" ? null : paperPnlUsd(current.sizeUsd, entry, exit);
  const closed: PaperPosition = {
    ...current,
    status: "closed",
    entryPriceUsd: entry,
    lastMarkUsd: exit ?? current.lastMarkUsd ?? null,
    pnlUsd: journalPnlUsd ?? 0,
    note: closeNote(
      current.note.toLowerCase().includes("caution"),
      entry,
      exit,
      source,
      journalPnlUsd,
    ),
  };
  const positions = state.positions.slice();
  positions[idx] = closed;
  const next = note(
    {
      ...state,
      positions,
      cashUsd: round2(state.cashUsd + closed.sizeUsd + (journalPnlUsd ?? 0)),
    },
    at,
    `Paper close ${closed.symbol} ${usd(closed.sizeUsd)}. ${closed.note} PnL ${usd(closed.pnlUsd)}. No transaction broadcast.`,
  );
  return {
    state: next,
    closed,
    exitPriceUsd: journalPnlUsd == null ? null : exit,
    journalPnlUsd,
  };
}

/** Store a later mark on an open clip and refresh unrealised PnL. */
export function applyOpenMark(
  state: DeskState,
  symbol: string,
  markUsd: number | null,
): DeskState {
  const mark = observedPrice(markUsd);
  if (mark == null) return state;
  const idx = state.positions.findIndex(
    (p) => p.status === "open" && p.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (idx < 0) return state;
  const current = state.positions[idx]!;
  const pnl = paperPnlUsd(current.sizeUsd, current.entryPriceUsd, mark);
  if (pnl == null) return state;
  const positions = state.positions.slice();
  positions[idx] = { ...current, lastMarkUsd: mark, pnlUsd: pnl };
  return { ...state, positions };
}

export function formatLedger(state: DeskState): string {
  const open = state.positions.filter((p) => p.status === "open");
  const openLines =
    open.length === 0
      ? "Open: none"
      : open
          .map((p) => formatOpenLine(p))
          .join("\n");
  const journal =
    state.journal.length === 0
      ? "Journal: empty"
      : state.journal
          .slice(-5)
          .map((j) => `• ${j.at} ${j.text}`)
          .join("\n");
  return [
    `Cash ${usd(state.cashUsd)} of ${usd(state.bankrollUsd)} paper bankroll`,
    openLines,
    "Journal:",
    journal,
  ].join("\n");
}

function formatOpenLine(p: PaperPosition): string {
  const entry = observedPrice(p.entryPriceUsd);
  const mark = observedPrice(p.lastMarkUsd);
  const entryText = entry == null ? "entry mark unavailable" : `entry ${formatMark(entry)}`;
  const markText = mark == null ? "" : ` · mark ${formatMark(mark)}`;
  return `Open: ${p.symbol} ${usd(p.sizeUsd)} · ${p.chain} · ${entryText}${markText} · MTM PnL ${usd(p.pnlUsd)} · ${p.note}`;
}

function fillNote(verdict: ShieldVerdict, entry: number | null): string {
  const clip = verdict === "caution" ? "Caution clip." : "Paper fill.";
  if (entry == null) return `${clip} Mark unavailable, so PnL stays flat.`;
  return `${clip} Entry mark ${formatMark(entry)}.`;
}

function closeNote(
  caution: boolean,
  entry: number | null,
  exit: number | null,
  source: "fresh" | "last_known" | "unavailable",
  pnl: number | null,
): string {
  const lead = caution ? "Caution clip close." : "Paper close.";
  if (pnl == null || entry == null || exit == null || source === "unavailable") {
    return `${lead} Mark unavailable, so PnL stays flat.`;
  }
  const via = source === "last_known" ? " Using last known mark." : "";
  return `${lead} Entry ${formatMark(entry)}, exit ${formatMark(exit)}.${via}`;
}

function observedPrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || !(value > 0)) return null;
  return value;
}

function note(state: DeskState, at: string, text: string): DeskState {
  const journal = [...state.journal, { at, text }].slice(-20);
  return { ...state, journal };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
