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
  const position: PaperPosition = {
    id: `${candidate.symbol}-${at}`,
    symbol: candidate.symbol,
    chain: candidate.chain,
    address: candidate.address,
    sizeUsd: size,
    openedAt: at,
    status: "open",
    pnlUsd: 0,
    note:
      verdict === "caution"
        ? "Caution clip. Mark-to-market is not wired, so PnL stays flat."
        : "Paper fill. Mark-to-market is not wired, so PnL stays flat.",
  };
  const next = note(
    {
      ...state,
      cashUsd: round2(state.cashUsd - size),
      positions: [...state.positions, position],
    },
    at,
    `Paper fill ${candidate.symbol} ${usd(size)} on ${candidate.chain}. No transaction broadcast.`,
  );
  return { state: next, position, reason: position.note };
}

export function closePaperPosition(
  state: DeskState,
  symbol: string,
  at: string,
): { state: DeskState; closed: PaperPosition | null } {
  const idx = state.positions.findIndex(
    (p) => p.status === "open" && p.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (idx < 0) return { state, closed: null };
  const current = state.positions[idx]!;
  const closed: PaperPosition = { ...current, status: "closed" };
  const positions = state.positions.slice();
  positions[idx] = closed;
  const next = note(
    {
      ...state,
      positions,
      cashUsd: round2(state.cashUsd + closed.sizeUsd),
    },
    at,
    `Paper close ${closed.symbol} ${usd(closed.sizeUsd)}. PnL ${usd(closed.pnlUsd)}. No transaction broadcast.`,
  );
  return { state: next, closed };
}

export function formatLedger(state: DeskState): string {
  const open = state.positions.filter((p) => p.status === "open");
  const openLines =
    open.length === 0
      ? "Open: none"
      : open
          .map(
            (p) =>
              `Open: ${p.symbol} ${usd(p.sizeUsd)} · ${p.chain} · PnL ${usd(p.pnlUsd)} · ${p.note}`,
          )
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

function note(state: DeskState, at: string, text: string): DeskState {
  const journal = [...state.journal, { at, text }].slice(-20);
  return { ...state, journal };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
