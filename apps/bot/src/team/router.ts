import { SPECIALIST_IDS, type SpecialistId } from "./personas.js";

export type DeskIntent =
  | "hire"
  | "watch"
  | "status"
  | "discover"
  | "snipe"
  | "close"
  | "pulse"
  | "ledger"
  | "safety"
  | "help"
  | "chat";

export interface RouteDecision {
  intent: DeskIntent;
  specialists: SpecialistId[];
  symbol: string | null;
}

const NAME_TO_ID: Record<string, SpecialistId> = {
  scout: "scout",
  sniper: "sniper",
  pulse: "pulse",
  ledger: "ledger",
  shield: "shield",
};

const NOT_SYMBOLS = new Set([
  "THE",
  "AND",
  "FOR",
  "YOU",
  "BOT",
  "SOL",
  "ETH",
  "BNB",
  "USD",
  "PNL",
  "LIVE",
  "PAPER",
  "TEAM",
  "TAPE",
  "DESK",
  "APE",
  "NEW",
  "PAIR",
  "PAIRS",
  "CHECK",
  "SCOUT",
  "SNIPER",
  "PULSE",
  "LEDGER",
  "SHIELD",
  "HIRE",
  "WATCH",
  "STATUS",
  "START",
  "HELP",
  "BUY",
  "SELL",
  "CLOSE",
  "SNIPE",
  "SAFETY",
  "HONEYPOT",
  "WHAT",
  "WHATS",
  "HOW",
  "SHOW",
  "TELL",
  "ABOUT",
  "THIS",
  "THAT",
  "WITH",
  "FROM",
  "YOUR",
  "MODE",
]);

export function normalizeCommand(text: string): string {
  return text.trim().replace(/@\w+/g, "").replace(/\s+/g, " ");
}

export function extractSymbol(text: string): string | null {
  const dollar = text.match(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/);
  if (dollar?.[1] && !NOT_SYMBOLS.has(dollar[1].toUpperCase())) {
    return dollar[1].toUpperCase();
  }
  const verb = text.match(
    /\b(?:snipe|buy|ape|check|close|sell|shield)\s+(?:check\s+)?([A-Za-z][A-Za-z0-9]{1,14})\b/i,
  );
  if (verb?.[1] && !NOT_SYMBOLS.has(verb[1].toUpperCase())) {
    return verb[1].toUpperCase();
  }
  return null;
}

function mentioned(text: string): SpecialistId[] {
  const found: SpecialistId[] = [];
  const lower = text.toLowerCase();
  for (const id of SPECIALIST_IDS) {
    if (new RegExp(`\\b${id}\\b`).test(lower)) found.push(id);
  }
  return found;
}

export function routeUserText(raw: string): RouteDecision {
  const text = normalizeCommand(raw);
  const t = text.toLowerCase();
  const symbol = extractSymbol(text);
  const names = mentioned(t);

  if (/^\/hire\b/.test(t) || /\bhire\b/.test(t)) {
    return { intent: "hire", specialists: [...SPECIALIST_IDS], symbol: null };
  }
  if (/^\/watch\b/.test(t) || /\bwatch\b/.test(t)) {
    return {
      intent: "watch",
      specialists: ["scout", "pulse", "shield"],
      symbol,
    };
  }
  if (/^\/status\b/.test(t) || /\bstatus\b/.test(t)) {
    return { intent: "status", specialists: ["ledger"], symbol: null };
  }
  if (/^\/paper\b/.test(t) || /^\/ledger\b/.test(t) || /\b(pnl|p&l|journal|positions?)\b/.test(t)) {
    return { intent: "ledger", specialists: ["ledger"], symbol };
  }
  if (/^\/help\b/.test(t) || t === "help" || t === "commands") {
    return { intent: "help", specialists: [], symbol: null };
  }
  if (/^\/scout\b/.test(t) || /\b(new pairs?|candidates?|discover)\b/.test(t)) {
    return { intent: "discover", specialists: ["scout"], symbol };
  }
  if (/^\/shield\b/.test(t) || /\b(honeypot|safety|rug|tax|checklist)\b/.test(t)) {
    return { intent: "safety", specialists: ["shield"], symbol };
  }
  if (/^\/sniper\b/.test(t) || /\b(snipe|ape in|buy)\b/.test(t)) {
    return { intent: "snipe", specialists: ["sniper", "shield"], symbol };
  }
  if (/\b(close|sell)\b/.test(t)) {
    return { intent: "close", specialists: ["sniper", "ledger"], symbol };
  }
  if (/^\/pulse\b/.test(t) || /\b(momentum|volume|tape)\b/.test(t)) {
    return { intent: "pulse", specialists: ["pulse"], symbol };
  }
  if (names.length === 1 && names[0] === "scout") {
    return { intent: "discover", specialists: ["scout"], symbol };
  }
  if (names.length === 1 && names[0] === "ledger") {
    return { intent: "ledger", specialists: ["ledger"], symbol };
  }
  if (names.length === 1 && names[0] === "shield") {
    return { intent: "safety", specialists: ["shield"], symbol };
  }
  if (names.length === 1 && names[0] === "sniper") {
    return { intent: "snipe", specialists: ["sniper", "shield"], symbol };
  }
  if (names.length === 1 && names[0] === "pulse") {
    return { intent: "pulse", specialists: ["pulse"], symbol };
  }
  if (names.length > 1) {
    return { intent: "chat", specialists: names, symbol };
  }
  if (NAME_TO_ID[t]) {
    const id = NAME_TO_ID[t];
    return routeUserText(`/${id}`);
  }
  return { intent: "help", specialists: [], symbol: null };
}
