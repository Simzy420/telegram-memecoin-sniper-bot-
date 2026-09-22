import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { closeDurable } from "../src/db/durable.ts";
import { appendJournalRows, type JournalRow } from "../src/team/journal.ts";
import { formatLearnSummary, summarizeJournal } from "../src/team/learn.ts";
import {
  LEARN_POLL_PATHS,
  buildLearnPoll,
  isLearnPollPath,
  writeLearnPoll,
  type LearnPollResultWriter,
} from "../src/team/learn-http.ts";
import { shouldPersistJournal } from "../src/team/paths.ts";

const SECRET = "test-learn-secret-do-not-echo";
const WRONG = "wrong-bearer-do-not-echo";
const FIXED = new Date("2026-09-22T18:00:00.000Z");
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-learn-http-"));
  tempDirs.push(dir);
  return dir;
}

function row(partial: Partial<JournalRow> & Pick<JournalRow, "timestamp" | "agent" | "action" | "user_id">): JournalRow {
  return {
    session_id: "sess-1",
    symbol: null,
    chain: null,
    size: null,
    price: null,
    pnl: null,
    shield_reasons: [],
    tags: [],
    mode: "paper",
    ...partial,
  };
}

const sampleRows: JournalRow[] = [
  row({
    timestamp: "2026-09-22T12:00:00.000Z",
    user_id: "user-1",
    agent: "sniper",
    action: "paper_close",
    symbol: "SLEEPAPE",
    chain: "base",
    size: 50,
    pnl: 10,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
  row({
    timestamp: "2026-09-22T12:05:00.000Z",
    user_id: "user-2",
    agent: "sniper",
    action: "paper_close",
    symbol: "RUGPUP",
    chain: "solana",
    size: 50,
    pnl: -4,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
];

function capture(
  url: string,
  authorization: string | undefined,
  env: NodeJS.ProcessEnv,
): { status: number; contentType: string; body: string; logs: string[] } {
  let status = 0;
  let contentType = "";
  let body = "";
  const logs: string[] = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  const spy = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  console.log = spy;
  console.warn = spy;
  console.error = spy;
  console.info = spy;
  const res: LearnPollResultWriter = {
    headersSent: false,
    writeHead(code, headers) {
      status = code;
      this.headersSent = true;
      const value = headers?.["content-type"];
      contentType = Array.isArray(value) ? value.join(",") : String(value ?? "");
    },
    end(chunk) {
      body = chunk ?? "";
    },
  };
  try {
    writeLearnPoll(
      { url, headers: authorization === undefined ? {} : { authorization } },
      res,
      { now: FIXED, env },
    );
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.info = originals.info;
  }
  return { status, contentType, body, logs };
}

function assertSecretHidden(text: string, logs: string[]): void {
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(WRONG), false);
  assert.equal(logs.some((line) => line.includes(SECRET) || line.includes(WRONG)), false);
}

describe("learn http poll", { concurrency: false }, () => {
after(() => {
  closeDurable();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("learn poll paths are /api/learn and /learn, and index.ts serves them", () => {
  assert.deepEqual([...LEARN_POLL_PATHS], ["/api/learn", "/learn"]);
  assert.equal(isLearnPollPath("/api/learn"), true);
  assert.equal(isLearnPollPath("/learn"), true);
  assert.equal(isLearnPollPath("/health"), false);
  const index = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /isLearnPollPath\(pathname\)/);
  assert.match(index, /writeLearnPoll\(req,\s*res\)/);
  assert.match(index, /pathname === "\/" \|\| pathname === "\/health"/);
});

test("buildLearnPoll matches formatLearnSummary for empty and sample rows", () => {
  const empty = buildLearnPoll({ rows: [], now: FIXED });
  assert.equal(empty.ok, true);
  assert.equal(empty.empty, true);
  assert.equal(empty.scope, "all");
  assert.equal(empty.userId, null);
  assert.equal(empty.generatedAt, FIXED.toISOString());
  assert.equal(empty.text, formatLearnSummary(summarizeJournal([])));
  assert.equal(empty.summary.inventedFills, false);
  assert.equal(empty.summary.rows, 0);
  assert.equal(empty.summary.wins, 0);
  assert.equal(empty.summary.losses, 0);
  assert.match(empty.text, /Invented fills: 0/);
  assert.match(empty.text, /no realised closes/i);

  const scoped = buildLearnPoll({ rows: sampleRows.slice(0, 1), userId: "user-1", now: FIXED });
  const summary = summarizeJournal(sampleRows.slice(0, 1));
  assert.equal(scoped.empty, false);
  assert.equal(scoped.scope, "user");
  assert.equal(scoped.userId, "user-1");
  assert.equal(scoped.text, formatLearnSummary(summary));
  assert.deepEqual(scoped.summary, summary);
  assert.equal(scoped.summary.inventedFills, false);
  assert.equal(scoped.summary.wins, 1);
  assert.equal(scoped.summary.losses, 0);
  assert.equal(scoped.summary.expectancy, 10);
});

test("missing LEARN_HTTP_SECRET is 503 and a bad bearer is 401", () => {
  const unset = capture("/api/learn", `Bearer ${SECRET}`, {});
  assert.equal(unset.status, 503);
  assert.match(unset.contentType, /^text\/plain/);
  assert.match(unset.body, /learn poll is not configured/);
  assertSecretHidden(unset.body, unset.logs);

  const blank = capture("/api/learn", `Bearer ${SECRET}`, { LEARN_HTTP_SECRET: "   " });
  assert.equal(blank.status, 503);

  const env = { LEARN_HTTP_SECRET: `  ${SECRET}  ` };
  const missing = capture("/api/learn", undefined, env);
  assert.equal(missing.status, 401);
  assert.match(missing.contentType, /^text\/plain/);
  assert.equal(missing.body, "unauthorized");
  assertSecretHidden(missing.body, missing.logs);

  const wrong = capture("/api/learn", `Bearer ${WRONG}`, env);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body, "unauthorized");
  assertSecretHidden(wrong.body, wrong.logs);

  const basic = capture("/api/learn", `Basic ${SECRET}`, env);
  assert.equal(basic.status, 401);
  assertSecretHidden(basic.body, basic.logs);
});

test("authorized poll returns an empty summary when the journal is not persisted", () => {
  const previous = process.env.JOURNAL_DISABLED;
  process.env.JOURNAL_DISABLED = "1";
  try {
    assert.equal(shouldPersistJournal(), false);
    const result = capture("/api/learn?userId=user-1", `Bearer ${SECRET}`, {
      LEARN_HTTP_SECRET: SECRET,
    });
    assert.equal(result.status, 200);
    assert.match(result.contentType, /^application\/json/);
    const body = JSON.parse(result.body) as ReturnType<typeof buildLearnPoll>;
    assert.equal(body.ok, true);
    assert.equal(body.empty, true);
    assert.equal(body.scope, "user");
    assert.equal(body.userId, "user-1");
    assert.equal(body.generatedAt, FIXED.toISOString());
    assert.equal(body.text, formatLearnSummary(summarizeJournal([])));
    assert.equal(body.summary.inventedFills, false);
    assert.equal(body.summary.rows, 0);
    assertSecretHidden(result.body, result.logs);
  } finally {
    if (previous === undefined) delete process.env.JOURNAL_DISABLED;
    else process.env.JOURNAL_DISABLED = previous;
  }
});

test("authorized poll reads all rows or one user and does not invent fills", () => {
  const dir = tempDir();
  const root = path.join(dir, "logs");
  const dbPath = path.join(dir, "durable.sqlite");
  const previous = {
    JOURNAL_ROOT: process.env.JOURNAL_ROOT,
    DURABLE_DB_PATH: process.env.DURABLE_DB_PATH,
    JOURNAL_DISABLED: process.env.JOURNAL_DISABLED,
  };
  process.env.JOURNAL_ROOT = root;
  process.env.DURABLE_DB_PATH = dbPath;
  delete process.env.JOURNAL_DISABLED;
  try {
    assert.equal(shouldPersistJournal(), true);
    appendJournalRows(sampleRows, { root, dbPath });

    const env = { LEARN_HTTP_SECRET: SECRET };
    const all = capture("/api/learn", `bearer ${SECRET}`, env);
    assert.equal(all.status, 200);
    const allBody = JSON.parse(all.body) as ReturnType<typeof buildLearnPoll>;
    const allSummary = summarizeJournal(sampleRows);
    assert.equal(allBody.ok, true);
    assert.equal(allBody.empty, false);
    assert.equal(allBody.scope, "all");
    assert.equal(allBody.userId, null);
    assert.equal(allBody.text, formatLearnSummary(allSummary));
    assert.deepEqual(allBody.summary, allSummary);
    assert.equal(allBody.summary.wins, 1);
    assert.equal(allBody.summary.losses, 1);
    assert.equal(allBody.summary.inventedFills, false);
    assertSecretHidden(all.body, all.logs);

    const one = capture("/learn?userId=user-1", `Bearer ${SECRET}`, env);
    const oneBody = JSON.parse(one.body) as ReturnType<typeof buildLearnPoll>;
    const oneSummary = summarizeJournal(sampleRows.filter((item) => item.user_id === "user-1"));
    assert.equal(one.status, 200);
    assert.equal(oneBody.empty, false);
    assert.equal(oneBody.scope, "user");
    assert.equal(oneBody.userId, "user-1");
    assert.equal(oneBody.text, formatLearnSummary(oneSummary));
    assert.deepEqual(oneBody.summary, oneSummary);
    assert.equal(oneBody.summary.wins, 1);
    assert.equal(oneBody.summary.losses, 0);

    const none = capture("/api/learn?userId=missing", `Bearer ${SECRET}`, env);
    const noneBody = JSON.parse(none.body) as ReturnType<typeof buildLearnPoll>;
    assert.equal(noneBody.empty, true);
    assert.equal(noneBody.scope, "user");
    assert.equal(noneBody.userId, "missing");
    assert.equal(noneBody.summary.rows, 0);
    assert.equal(noneBody.text, formatLearnSummary(summarizeJournal([])));

    const blankUser = capture("/api/learn?userId=%20", `Bearer ${SECRET}`, env);
    const blankBody = JSON.parse(blankUser.body) as ReturnType<typeof buildLearnPoll>;
    assert.equal(blankBody.scope, "all");
    assert.equal(blankBody.userId, null);
    assert.equal(blankBody.empty, false);

    process.env.JOURNAL_DISABLED = "1";
    const disabled = capture("/api/learn", `Bearer ${SECRET}`, env);
    const disabledBody = JSON.parse(disabled.body) as ReturnType<typeof buildLearnPoll>;
    assert.equal(disabled.status, 200);
    assert.equal(disabledBody.ok, true);
    assert.equal(disabledBody.empty, true);
    assert.equal(disabledBody.summary.rows, 0);
    assert.equal(disabledBody.summary.wins, 0);
    assert.equal(disabledBody.text, formatLearnSummary(summarizeJournal([])));
    assert.equal(disabledBody.summary.inventedFills, false);
  } finally {
    closeDurable(dbPath);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("GET /api/learn and /learn answer over HTTP; other routes stay unchanged", async () => {
  const previous = {
    LEARN_HTTP_SECRET: process.env.LEARN_HTTP_SECRET,
    JOURNAL_DISABLED: process.env.JOURNAL_DISABLED,
  };
  process.env.LEARN_HTTP_SECRET = SECRET;
  process.env.JOURNAL_DISABLED = "1";
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    if (req.method === "GET" && isLearnPollPath(pathname)) {
      writeLearnPoll(req, res, { now: FIXED });
      return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(pathname === "/health" ? "ok" : "Big Brain Ape The MemeCoin Sniper");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const home = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await home.text(), "Big Brain Ape The MemeCoin Sniper");

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);

    const denied = await fetch(`http://127.0.0.1:${port}/api/learn`);
    assert.equal(denied.status, 401);
    assert.equal(await denied.text(), "unauthorized");

    const alias = await fetch(`http://127.0.0.1:${port}/learn`, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    assert.equal(alias.status, 200);
    assert.match(alias.headers.get("content-type") ?? "", /^application\/json/);
    const body = (await alias.json()) as ReturnType<typeof buildLearnPoll>;
    assert.equal(body.ok, true);
    assert.equal(body.empty, true);
    assert.equal(body.text, formatLearnSummary(summarizeJournal([])));
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
});
