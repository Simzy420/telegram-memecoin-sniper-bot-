import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { loadJournalRows, type JournalRow } from "./journal.js";
import { formatLearnSummary, summarizeJournal, type LearnSummary } from "./learn.js";
import { shouldPersistJournal } from "./paths.js";

/** Paths the public HTTP server answers for the journal poll. */
export const LEARN_POLL_PATHS = ["/api/learn", "/learn"] as const;

export function isLearnPollPath(pathname: string): boolean {
  return (LEARN_POLL_PATHS as readonly string[]).includes(pathname);
}

export interface LearnPollResponse {
  ok: true;
  empty: boolean;
  text: string;
  summary: LearnSummary;
  scope: "user" | "all";
  userId: string | null;
  generatedAt: string;
}

export interface LearnPollResultWriter {
  writeHead(statusCode: number, headers?: Record<string, string | string[]>): void;
  end(body?: string): void;
  headersSent?: boolean;
}

const NOT_CONFIGURED = "learn poll is not configured";
const UNAUTHORIZED = "unauthorized";

export function learnHttpSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.LEARN_HTTP_SECRET?.trim() ?? "";
}

export function authorizeLearnRequest(
  authorization: string | string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; status: 401 | 503; message: string } {
  const secret = learnHttpSecret(env);
  if (!secret) {
    return { ok: false, status: 503, message: NOT_CONFIGURED };
  }
  const token = bearerToken(authorization);
  if (!token || !secretsMatch(token, secret)) {
    return { ok: false, status: 401, message: UNAUTHORIZED };
  }
  return { ok: true };
}

/** Same Ledger summary as Telegram /learn. No rows are invented. */
export function buildLearnPoll(opts: {
  rows: JournalRow[];
  userId?: string | null;
  now?: Date;
}): LearnPollResponse {
  const userId = normalizeUserId(opts.userId);
  const summary = summarizeJournal(opts.rows);
  return {
    ok: true,
    empty: opts.rows.length === 0,
    text: formatLearnSummary(summary),
    summary,
    scope: userId ? "user" : "all",
    userId,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

export function journalRowsForPoll(userId: string | null): JournalRow[] {
  if (!shouldPersistJournal()) return [];
  return loadJournalRows(userId ? { userId } : {});
}

export function learnPollUserId(url: string | undefined): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url && url.length > 0 ? url : "/", "http://127.0.0.1");
  } catch {
    return null;
  }
  return normalizeUserId(parsed.searchParams.get("userId"));
}

export function writeLearnPoll(
  req: Pick<IncomingMessage, "url" | "headers">,
  res: LearnPollResultWriter,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): void {
  const env = opts.env ?? process.env;
  const auth = authorizeLearnRequest(headerAuthorization(req.headers), env);
  if (!auth.ok) {
    res.writeHead(auth.status, { "content-type": "text/plain; charset=utf-8" });
    res.end(auth.message);
    return;
  }
  try {
    const userId = learnPollUserId(req.url);
    const body = buildLearnPoll({
      rows: journalRowsForPoll(userId),
      userId,
      now: opts.now,
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  } catch (err) {
    console.error("[bba] learn poll failed", err instanceof Error ? err.message : "error");
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("error");
    }
  }
}

function headerAuthorization(headers: IncomingHttpHeaders | undefined): string | string[] | undefined {
  return headers?.authorization;
}

function normalizeUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function bearerToken(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function secretsMatch(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}
