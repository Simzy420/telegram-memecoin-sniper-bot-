import {
  discoverCandidates,
  EXAMPLE_CANDIDATES,
  fetchTokenMarkUsd,
  findCandidate,
  type Candidate,
  type Discovery,
} from "./candidates.js";
import { executionGate } from "./gate.js";
import type { JournalDraft } from "./journal.js";
import { submitLiveOrder } from "./live.js";
import { flavorChat } from "./openai.js";
import {
  applyOpenMark,
  closePaperPosition,
  formatLedger,
  freshDesk,
  hireTroop,
  openPaperPosition,
  PAPER_CAUTION_USD,
  PAPER_SIZE_USD,
  usd,
  type DeskState,
} from "./paper.js";
import { personaNameList, PERSONAS, SPECIALIST_IDS, type SpecialistId } from "./personas.js";
import type { Line } from "./render.js";
import { routeUserText } from "./router.js";
import { formatShield, runShield, type ShieldReport } from "./safety.js";

const HELP =
  "Talk to me in this chat. The troop answers under their own names.\n" +
  "Hire Team — seat Scout, Sniper, Pulse, Ledger, and Shield.\n" +
  "Watch Tape — Scout lists names, Shield checks the first one, Pulse reads it.\n" +
  "Desk Status — who is hired, and that the book is paper.\n" +
  "/learn — Ledger reads the journal: win rate, expectancy, Shield blocks. No invented fills.\n" +
  "/export — dump the journal as CSV and JSONL for a backtest.\n" +
  "Ledger shows the entry mark and open mark-to-market PnL when a DexScreener price was read.\n" +
  "Try: scout, shield check SLEEPAPE, snipe SLEEPAPE, ledger, close SLEEPAPE.\n" +
  "Commands: /hire /watch /status /paper /scout /sniper /pulse /ledger /shield /learn /export";

export interface DeskTurnInput {
  text: string;
  state?: DeskState;
  now?: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  discover?: (opts: {
    fetchImpl?: typeof fetch;
    heliusApiKey?: string;
    alchemyApiKey?: string;
    bypassCache?: boolean;
  }) => Promise<Discovery>;
}

export interface DeskTurn {
  state: DeskState;
  lines: Line[];
  events: JournalDraft[];
}

export function looksLikeSecret(text: string): boolean {
  if (/0x[a-fA-F0-9]{64}/.test(text)) return true;
  const trimmed = text.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{80,120}$/.test(trimmed)) return true;
  return false;
}

export async function handleDeskTurn(input: DeskTurnInput): Promise<DeskTurn> {
  const now = input.now ?? new Date();
  const at = now.toISOString().slice(11, 16) + "Z";
  let state = input.state ?? freshDesk();
  const env = input.env ?? process.env;
  const gate = executionGate(env);
  const events: JournalDraft[] = [];
  const done = (next: DeskState, lines: Line[]): DeskTurn => ({
    state: next,
    lines,
    events,
  });

  if (looksLikeSecret(input.text)) {
    return done(state, [
      {
        speaker: "boss",
        text:
          "That looks like a key. I will not repeat it or store it in the desk journal. Export keys only from the wallet menu, in a private chat.",
      },
    ]);
  }

  const route = routeUserText(input.text);

  if (route.intent === "hire") {
    state = hireTroop(state, at);
    for (const id of SPECIALIST_IDS) {
      events.push(draft(id, "hired", { tags: ["hire"] }));
    }
    return done(state, [
      {
        speaker: "boss",
        text: `Troop is hired. ${gate.detail}`,
      },
      ...SPECIALIST_IDS.map((id) => ({
        speaker: id,
        text: hireLine(id),
      })),
    ]);
  }

  if (route.intent === "help") {
    return done(state, [{ speaker: "boss", text: HELP }]);
  }

  if (route.intent === "status") {
    state = await refreshOpenMarks(state, input.fetchImpl);
    const hired =
      state.hired.length === 0
        ? "Nobody is hired yet. Tap Hire Team."
        : `Hired: ${personaNameList(state.hired)}.`;
    events.push(draft("ledger", "book", { tags: ["book", "status"] }));
    return done(state, [
      {
        speaker: "boss",
        text: `${hired} Watching: ${state.watching ? "yes" : "no"}. ${gate.detail} ${providerLine(env)}`,
      },
      { speaker: "ledger", text: formatLedger(state) },
    ]);
  }

  if (route.intent === "ledger") {
    state = await refreshOpenMarks(state, input.fetchImpl);
    events.push(draft("ledger", "book", { tags: ["book"] }));
    return done(state, [
      { speaker: "boss", text: "Ledger has the paper book." },
      { speaker: "ledger", text: formatLedger(state) },
    ]);
  }

  if (route.intent === "discover" || route.intent === "watch" || route.intent === "pulse") {
    const discovery = await loadDiscovery(input, state);
    state = { ...state, lastCandidates: discovery.candidates };
    if (route.intent === "watch") state = { ...state, watching: true };
    const top = discovery.candidates[0] ?? null;
    const lines: Line[] = [
      {
        speaker: "boss",
        text:
          route.intent === "watch"
            ? `Watching the tape. Scout, then Shield on the first name, then Pulse. ${gate.detail}`
            : route.intent === "pulse"
              ? "Pulse has the print."
              : "Scout has the board.",
      },
    ];
    if (route.intent !== "pulse") {
      lines.push({ speaker: "scout", text: formatScout(discovery) });
      for (const candidate of discovery.candidates.slice(0, 8)) {
        events.push(
          draft("scout", "scan", {
            symbol: candidate.symbol,
            chain: candidate.chain,
            tags: [`feed:${discovery.feed}`, "scan"],
          }),
        );
      }
    }
    if (route.intent === "watch" && top) {
      const report = runShield(top);
      lines.push({ speaker: "shield", text: formatShield(report) });
      events.push(shieldDraft(top, report));
    }
    if (route.intent === "watch" || route.intent === "pulse") {
      lines.push({
        speaker: "pulse",
        text: top ? pulseRead(top) : "No names on the board. Ask Scout to look again.",
      });
      events.push(
        draft("pulse", "tape", {
          symbol: top?.symbol ?? null,
          chain: top?.chain ?? null,
          tags: ["tape"],
        }),
      );
    }
    return done(state, lines);
  }

  if (route.intent === "safety") {
    const found = await resolveCandidate(route.symbol, state, input);
    state = found.state;
    if (!found.candidate) {
      return done(state, [
        {
          speaker: "boss",
          text: "Shield needs a name from the tape. Watch first, or say shield check SLEEPAPE.",
        },
        {
          speaker: "shield",
          text: "I do not invent a checklist for a symbol I have not seen.",
        },
      ]);
    }
    const report = runShield(found.candidate);
    events.push(shieldDraft(found.candidate, report));
    return done(state, [
      {
        speaker: "boss",
        text: `Shield is on ${found.candidate.symbol}. This is a checklist, not a buy.`,
      },
      { speaker: "shield", text: formatShield(report) },
    ]);
  }

  if (route.intent === "snipe") {
    if (state.hired.length === 0) {
      return done(state, [
        {
          speaker: "boss",
          text: "Hire the troop before anyone marks a paper fill.",
        },
      ]);
    }
    if (!route.symbol) {
      return done(state, [
        {
          speaker: "boss",
          text: "Sniper needs a symbol from the tape. Try snipe SLEEPAPE.",
        },
        {
          speaker: "sniper",
          text: "No target. I do not fire blind, even on paper.",
        },
      ]);
    }
    const found = await resolveCandidate(route.symbol, state, input);
    state = found.state;
    if (!found.candidate) {
      return done(state, [
        {
          speaker: "boss",
          text: `${route.symbol} is not on the example tape or the last watch. Ask Scout, or use PAPERPEPE, RUGPUP, or SLEEPAPE.`,
        },
        {
          speaker: "sniper",
          text: "I will not invent a mint. No paper fill.",
        },
      ]);
    }
    const report = runShield(found.candidate);
    events.push(shieldDraft(found.candidate, report));
    if (gate.liveEnabled) {
      const size = report.verdict === "caution" ? PAPER_CAUTION_USD : PAPER_SIZE_USD;
      const live = submitLiveOrder(
        {
          symbol: found.candidate.symbol,
          chain: found.candidate.chain,
          side: "buy",
          sizeUsd: size,
          shieldVerdict: report.verdict,
        },
        env,
      );
      events.push(
        draft("sniper", "live_refused", {
          symbol: found.candidate.symbol,
          chain: found.candidate.chain,
          size: report.verdict === "block" ? null : size,
          shieldReasons: shieldReasonList(report),
          tags: ["stub", "no-broadcast", `verdict:${report.verdict}`, strategyTag(report.verdict)],
          mode: "live",
        }),
      );
      return done(state, [
        {
          speaker: "boss",
          text: `Sniper asked for ${found.candidate.symbol}. The live path refused it. ${gate.detail}`,
        },
        { speaker: "shield", text: formatShield(report) },
        { speaker: "sniper", text: live.reason },
        { speaker: "ledger", text: formatLedger(state) },
      ]);
    }
    const entryPriceUsd =
      report.verdict === "block"
        ? null
        : await fetchTokenMarkUsd(
            found.candidate.chain,
            found.candidate.address,
            input.fetchImpl,
          );
    const opened = openPaperPosition(
      state,
      found.candidate,
      report.verdict,
      at,
      entryPriceUsd,
    );
    state = opened.state;
    const isNewFill = opened.position != null && opened.reason === opened.position.note;
    if (isNewFill && opened.position) {
      events.push(
        draft("sniper", "paper_fill", {
          symbol: opened.position.symbol,
          chain: opened.position.chain,
          size: opened.position.sizeUsd,
          price: opened.position.entryPriceUsd ?? null,
          pnl: null,
          shieldReasons: shieldReasonList(report),
          tags: ["fill", `verdict:${report.verdict}`, strategyTag(report.verdict)],
        }),
      );
      events.push(
        draft("ledger", "book", {
          symbol: opened.position.symbol,
          chain: opened.position.chain,
          size: opened.position.sizeUsd,
          price: opened.position.entryPriceUsd ?? null,
          tags: ["book", "position_opened"],
        }),
      );
    } else {
      events.push(
        draft("sniper", "refused", {
          symbol: found.candidate.symbol,
          chain: found.candidate.chain,
          shieldReasons: shieldReasonList(report),
          tags: ["refused", `verdict:${report.verdict}`],
        }),
      );
    }
    const sniperText = isNewFill
      ? `Paper entry ${found.candidate.symbol} ${usd(opened.position!.sizeUsd)} on ${found.candidate.chain}. ${opened.position!.note} ${gate.detail}`
      : `${opened.reason} ${gate.detail}`;
    return done(state, [
      {
        speaker: "boss",
        text: `Sniper asked for ${found.candidate.symbol}. Shield speaks before any paper clip. ${gate.detail}`,
      },
      { speaker: "shield", text: formatShield(report) },
      { speaker: "sniper", text: sniperText },
      { speaker: "ledger", text: formatLedger(state) },
    ]);
  }

  if (route.intent === "close") {
    const symbol = route.symbol;
    if (!symbol) {
      return done(state, [
        { speaker: "boss", text: "Name the paper position to close. Example: close SLEEPAPE." },
      ]);
    }
    const open = state.positions.find(
      (p) => p.status === "open" && p.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    const exitPriceUsd = open
      ? await fetchTokenMarkUsd(open.chain, open.address, input.fetchImpl)
      : null;
    const closed = closePaperPosition(state, symbol, at, exitPriceUsd);
    state = closed.state;
    if (!closed.closed) {
      events.push(draft("ledger", "book", { symbol, tags: ["book", "missing"] }));
      return done(state, [
        { speaker: "boss", text: `No open paper position named ${symbol}.` },
        { speaker: "ledger", text: formatLedger(state) },
      ]);
    }
    const strategy = closed.closed.note.toLowerCase().includes("caution")
      ? "strategy:caution-clip"
      : "strategy:paper-clip";
    events.push(
      draft("sniper", "paper_close", {
        symbol: closed.closed.symbol,
        chain: closed.closed.chain,
        size: closed.closed.sizeUsd,
        price: closed.exitPriceUsd,
        pnl: closed.journalPnlUsd,
        tags: ["outcome:realised", strategy],
      }),
    );
    events.push(
      draft("ledger", "book", {
        symbol: closed.closed.symbol,
        chain: closed.closed.chain,
        size: closed.closed.sizeUsd,
        price: closed.exitPriceUsd,
        pnl: closed.journalPnlUsd,
        tags: ["book", "position_closed"],
      }),
    );
    const exitLine =
      closed.journalPnlUsd == null
        ? `Paper exit ${closed.closed.symbol}. Mark unavailable, so PnL stays flat. I did not send a transaction.`
        : `Paper exit ${closed.closed.symbol}. PnL ${usd(closed.journalPnlUsd)}. I did not send a transaction.`;
    return done(state, [
      {
        speaker: "boss",
        text: `Closing ${closed.closed.symbol} on paper. ${gate.detail}`,
      },
      {
        speaker: "sniper",
        text: exitLine,
      },
      { speaker: "ledger", text: formatLedger(state) },
    ]);
  }

  const chat = chatLines(route.specialists);
  const flavored = await flavorChat(chat, env.OPENAI_API_KEY, input.fetchImpl);
  return done(state, flavored ?? chat);
}

function draft(
  agent: SpecialistId,
  action: string,
  extra: Omit<JournalDraft, "agent" | "action"> = {},
): JournalDraft {
  return {
    agent,
    action,
    symbol: extra.symbol ?? null,
    chain: extra.chain ?? null,
    size: extra.size ?? null,
    price: extra.price ?? null,
    pnl: extra.pnl ?? null,
    shieldReasons: extra.shieldReasons ?? [],
    tags: extra.tags ?? [],
    mode: extra.mode ?? "paper",
  };
}

function shieldDraft(candidate: Candidate, report: ShieldReport): JournalDraft {
  return draft("shield", "check", {
    symbol: candidate.symbol,
    chain: candidate.chain,
    shieldReasons: shieldReasonList(report),
    tags: ["check", `verdict:${report.verdict}`],
  });
}

function shieldReasonList(report: ShieldReport): string[] {
  return [
    `verdict:${report.verdict}`,
    ...report.flags.map((flag) => `${flag.status} ${flag.label}: ${flag.detail}`),
  ];
}

function strategyTag(verdict: ShieldReport["verdict"]): string {
  return verdict === "caution" ? "strategy:caution-clip" : "strategy:paper-clip";
}

function providerLine(env: Record<string, string | undefined>): string {
  const flag = (value: string | undefined) => (value ? "set" : "not set");
  return `OpenAI ${flag(env.OPENAI_API_KEY)}. Helius ${flag(env.HELIUS_API_KEY)}. Alchemy ${flag(env.ALCHEMY_API_KEY)}.`;
}

function hireLine(id: SpecialistId): string {
  switch (id) {
    case "scout":
      return "Eyes up. I will surface names. This tape is paper until a later engine exists.";
    case "sniper":
      return "I mark paper entries only after Shield speaks. I do not sign transactions.";
    case "pulse":
      return "I will call heat and quiet. Not hopium.";
    case "ledger":
      return "Book is open. Every paper fill gets a journal line. I read a DexScreener mark when the tape has one. A missing mark stays flat.";
    case "shield":
      return "Nothing gets sized until the checklist runs. A pass is still not a live buy.";
  }
}

function formatScout(discovery: Discovery): string {
  const head =
    discovery.feed === "example"
      ? "Example tape. These are drills, not live pools."
      : "Market feed (DexScreener, read-only). I am not buying.";
  const extra = discovery.notes.filter((n) => !n.startsWith("Example")).join(" · ");
  const rows = discovery.candidates.map((c) => {
    const liq = c.liqUsd == null ? "liq n/a" : `liq ${usd(c.liqUsd)}`;
    const age = c.ageMin == null ? "age n/a" : `${c.ageMin}m old`;
    return `${c.symbol} · ${c.chain} · ${liq} · ${age}`;
  });
  return [head, extra, ...rows].filter(Boolean).join("\n");
}

function pulseRead(c: Candidate): string {
  if ((c.ageMin ?? 999) <= 10 && (c.liqUsd ?? 0) >= 20_000) {
    return `${c.symbol} is young with depth on the card. Heat is real. That is not a clean bill of health.`;
  }
  if ((c.liqUsd ?? 0) > 0 && (c.liqUsd ?? 0) < 5_000) {
    return `${c.symbol} is thin. I would not chase a print that small.`;
  }
  return `${c.symbol} is on the board. I do not have a live momentum feed, so this is a card read, not a signal.`;
}

function chatLines(ids: SpecialistId[]): Line[] {
  if (ids.length === 0) {
    return [{ speaker: "boss", text: HELP }];
  }
  return [
    { speaker: "boss", text: `On it. ${personaNameList(ids)}.` },
    ...ids.map((id) => ({ speaker: id, text: PERSONAS[id].role })),
  ];
}

async function refreshOpenMarks(
  state: DeskState,
  fetchImpl?: typeof fetch,
): Promise<DeskState> {
  const open = state.positions.filter((p) => p.status === "open");
  if (open.length === 0) return state;
  const marks = await Promise.all(
    open.map(async (position) => ({
      symbol: position.symbol,
      mark: await fetchTokenMarkUsd(position.chain, position.address, fetchImpl),
    })),
  );
  let next = state;
  for (const row of marks) {
    next = applyOpenMark(next, row.symbol, row.mark);
  }
  return next;
}

async function loadDiscovery(input: DeskTurnInput, state: DeskState): Promise<Discovery> {
  const env = input.env ?? process.env;
  const discover = input.discover ?? discoverCandidates;
  try {
    return await discover({
      fetchImpl: input.fetchImpl,
      heliusApiKey: env.HELIUS_API_KEY,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      bypassCache: true,
    });
  } catch {
    return {
      candidates: state.lastCandidates.length > 0 ? state.lastCandidates : EXAMPLE_CANDIDATES,
      feed: "example",
      notes: ["Example tape."],
    };
  }
}

async function resolveCandidate(
  symbol: string | null,
  state: DeskState,
  input: DeskTurnInput,
): Promise<{ state: DeskState; candidate: Candidate | null }> {
  const known = findCandidate(symbol, [state.lastCandidates, EXAMPLE_CANDIDATES]);
  if (known) return { state, candidate: known };
  if (!symbol) {
    const discovery = await loadDiscovery(input, state);
    const next = { ...state, lastCandidates: discovery.candidates };
    return { state: next, candidate: discovery.candidates[0] ?? null };
  }
  return { state, candidate: null };
}
