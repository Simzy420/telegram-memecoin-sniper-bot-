import {
  discoverCandidates,
  EXAMPLE_CANDIDATES,
  findCandidate,
  type Candidate,
  type Discovery,
} from "./candidates.js";
import { executionGate } from "./gate.js";
import { flavorChat } from "./openai.js";
import {
  closePaperPosition,
  formatLedger,
  freshDesk,
  hireTroop,
  openPaperPosition,
  usd,
  type DeskState,
} from "./paper.js";
import { personaNameList, PERSONAS, SPECIALIST_IDS, type SpecialistId } from "./personas.js";
import type { Line } from "./render.js";
import { routeUserText } from "./router.js";
import { formatShield, runShield } from "./safety.js";

const HELP =
  "Talk to me in this chat. The troop answers under their own names.\n" +
  "Hire Team — seat Scout, Sniper, Pulse, Ledger, and Shield.\n" +
  "Watch Tape — Scout lists names, Shield checks the first one, Pulse reads it.\n" +
  "Desk Status — who is hired, and that the book is paper.\n" +
  "Try: scout, shield check SLEEPAPE, snipe SLEEPAPE, ledger, close SLEEPAPE.\n" +
  "Commands: /hire /watch /status /paper /scout /sniper /pulse /ledger /shield";

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

  if (looksLikeSecret(input.text)) {
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text:
            "That looks like a key. I will not repeat it or store it in the desk journal. Export keys only from the wallet menu, in a private chat.",
        },
      ],
    };
  }

  const route = routeUserText(input.text);

  if (route.intent === "hire") {
    state = hireTroop(state, at);
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text: `Troop is hired. ${gate.detail}`,
        },
        ...SPECIALIST_IDS.map((id) => ({
          speaker: id,
          text: hireLine(id),
        })),
      ],
    };
  }

  if (route.intent === "help") {
    return {
      state,
      lines: [{ speaker: "boss", text: HELP }],
    };
  }

  if (route.intent === "status") {
    const hired =
      state.hired.length === 0
        ? "Nobody is hired yet. Tap Hire Team."
        : `Hired: ${personaNameList(state.hired)}.`;
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text: `${hired} Watching: ${state.watching ? "yes" : "no"}. ${gate.detail} ${providerLine(env)}`,
        },
        { speaker: "ledger", text: formatLedger(state) },
      ],
    };
  }

  if (route.intent === "ledger") {
    return {
      state,
      lines: [
        { speaker: "boss", text: "Ledger has the paper book." },
        { speaker: "ledger", text: formatLedger(state) },
      ],
    };
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
    }
    if (route.intent === "watch" && top) {
      lines.push({ speaker: "shield", text: formatShield(runShield(top)) });
    }
    if (route.intent === "watch" || route.intent === "pulse") {
      lines.push({
        speaker: "pulse",
        text: top ? pulseRead(top) : "No names on the board. Ask Scout to look again.",
      });
    }
    return { state, lines };
  }

  if (route.intent === "safety") {
    const found = await resolveCandidate(route.symbol, state, input);
    state = found.state;
    if (!found.candidate) {
      return {
        state,
        lines: [
          {
            speaker: "boss",
            text: "Shield needs a name from the tape. Watch first, or say shield check SLEEPAPE.",
          },
          {
            speaker: "shield",
            text: "I do not invent a checklist for a symbol I have not seen.",
          },
        ],
      };
    }
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text: `Shield is on ${found.candidate.symbol}. This is a checklist, not a buy.`,
        },
        { speaker: "shield", text: formatShield(runShield(found.candidate)) },
      ],
    };
  }

  if (route.intent === "snipe") {
    if (state.hired.length === 0) {
      return {
        state,
        lines: [
          {
            speaker: "boss",
            text: "Hire the troop before anyone marks a paper fill.",
          },
        ],
      };
    }
    if (!route.symbol) {
      return {
        state,
        lines: [
          {
            speaker: "boss",
            text: "Sniper needs a symbol from the tape. Try snipe SLEEPAPE.",
          },
          {
            speaker: "sniper",
            text: "No target. I do not fire blind, even on paper.",
          },
        ],
      };
    }
    const found = await resolveCandidate(route.symbol, state, input);
    state = found.state;
    if (!found.candidate) {
      return {
        state,
        lines: [
          {
            speaker: "boss",
            text: `${route.symbol} is not on the example tape or the last watch. Ask Scout, or use PAPERPEPE, RUGPUP, or SLEEPAPE.`,
          },
          {
            speaker: "sniper",
            text: "I will not invent a mint. No paper fill.",
          },
        ],
      };
    }
    const report = runShield(found.candidate);
    const opened = openPaperPosition(state, found.candidate, report.verdict, at);
    state = opened.state;
    const isNewFill =
      opened.position != null && opened.reason === opened.position.note;
    const sniperText = isNewFill
      ? `Paper entry ${found.candidate.symbol} ${usd(opened.position!.sizeUsd)} on ${found.candidate.chain}. ${opened.position!.note} ${gate.detail}`
      : `${opened.reason} ${gate.detail}`;
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text: `Sniper asked for ${found.candidate.symbol}. Shield speaks before any paper clip. ${gate.detail}`,
        },
        { speaker: "shield", text: formatShield(report) },
        { speaker: "sniper", text: sniperText },
        { speaker: "ledger", text: formatLedger(state) },
      ],
    };
  }

  if (route.intent === "close") {
    if (!route.symbol) {
      return {
        state,
        lines: [
          { speaker: "boss", text: "Name the paper position to close. Example: close SLEEPAPE." },
        ],
      };
    }
    const closed = closePaperPosition(state, route.symbol, at);
    state = closed.state;
    if (!closed.closed) {
      return {
        state,
        lines: [
          { speaker: "boss", text: `No open paper position named ${route.symbol}.` },
          { speaker: "ledger", text: formatLedger(state) },
        ],
      };
    }
    return {
      state,
      lines: [
        {
          speaker: "boss",
          text: `Closing ${closed.closed.symbol} on paper. ${gate.detail}`,
        },
        {
          speaker: "sniper",
          text: `Paper exit ${closed.closed.symbol}. I did not send a transaction.`,
        },
        { speaker: "ledger", text: formatLedger(state) },
      ],
    };
  }

  const chat = chatLines(route.specialists);
  const flavored = await flavorChat(chat, env.OPENAI_API_KEY, input.fetchImpl);
  return { state, lines: flavored ?? chat };
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
      return "Book is open. Every paper fill gets a journal line. PnL stays flat until a mark feed exists.";
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
