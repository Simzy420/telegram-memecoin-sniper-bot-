import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { closeDurable } from "../src/db/durable.ts";
import { resetUserStoreForTests, getUser, saveGeneratedWallet, upsertUser } from "../src/db/users.ts";
import { decryptSecret } from "../src/services/crypto.ts";
import { generateUserWallet } from "../src/services/wallet.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { journalToCsv, writeJournalExport } from "../src/team/export.ts";
import { executionGate } from "../src/team/gate.ts";
import {
  appendJournalRows,
  loadJournalRows,
  readJournalFiles,
  stampDrafts,
  type JournalRow,
} from "../src/team/journal.ts";
import { formatLearnSummary, summarizeJournal } from "../src/team/learn.ts";
import { submitLiveOrder } from "../src/team/live.ts";
import { nightlyMessage, runNightlyTick } from "../src/team/nightly.ts";
import { freshDesk } from "../src/team/paper.ts";
import { loadSession, resetSessionsForTests, saveSession } from "../src/team/session.ts";

const tempDirs: string[] = [];

after(() => {
  closeDurable();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-journal-"));
  tempDirs.push(dir);
  return dir;
}

function row(partial: Partial<JournalRow> & Pick<JournalRow, "timestamp" | "agent" | "action">): JournalRow {
  return {
    session_id: "sess-1",
    user_id: "user-1",
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
    agent: "shield",
    action: "check",
    symbol: "RUGPUP",
    chain: "solana",
    shield_reasons: ["verdict:block", "bad Honeypot: sell path looks blocked"],
    tags: ["check", "verdict:block"],
  }),
  row({
    timestamp: "2026-09-22T12:05:00.000Z",
    agent: "sniper",
    action: "paper_close",
    symbol: "RUGPUP",
    chain: "solana",
    size: 50,
    pnl: -8,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
  row({
    timestamp: "2026-09-22T12:01:00.000Z",
    agent: "shield",
    action: "check",
    symbol: "WINAPE",
    chain: "base",
    tags: ["check", "verdict:block"],
    shield_reasons: ["verdict:block"],
  }),
  row({
    timestamp: "2026-09-22T12:06:00.000Z",
    agent: "sniper",
    action: "paper_close",
    symbol: "WINAPE",
    chain: "base",
    size: 50,
    pnl: 4,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
  row({
    timestamp: "2026-09-22T12:02:00.000Z",
    agent: "sniper",
    action: "paper_close",
    symbol: "SLEEPAPE",
    chain: "base",
    size: 50,
    pnl: 10,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
  row({
    timestamp: "2026-09-22T12:03:00.000Z",
    agent: "sniper",
    action: "paper_close",
    symbol: "PAPERPEPE",
    chain: "solana",
    size: 25,
    pnl: -5,
    tags: ["outcome:realised", "strategy:caution-clip"],
  }),
  row({
    timestamp: "2026-09-22T12:04:00.000Z",
    agent: "sniper",
    action: "paper_close",
    symbol: "FLATAPE",
    chain: "base",
    size: 50,
    pnl: 0,
    tags: ["outcome:realised", "strategy:paper-clip"],
  }),
];

test("journal append writes a UTC day JSONL file and sqlite, then reloads the same rows", () => {
  const dir = tempDir();
  const root = path.join(dir, "logs");
  const dbPath = path.join(dir, "durable.sqlite");
  const first = appendJournalRows(sampleRows.slice(0, 2), { root, dbPath });
  const dayFile = path.join(root, "days", "2026-09-22", "events.jsonl");
  assert.equal(first.stored, 2);
  assert.equal(first.skipped, 0);
  assert.equal(first.files[0], dayFile);
  assert.equal(fs.readFileSync(dayFile, "utf8").trim().split("\n").length, 2);

  const nextDay = row({
    timestamp: "2026-09-23T00:30:00.000Z",
    agent: "pulse",
    action: "tape",
    symbol: "SLEEPAPE",
    chain: "base",
    tags: ["tape"],
  });
  appendJournalRows([nextDay], { root, dbPath });
  assert.equal(
    fs.existsSync(path.join(root, "days", "2026-09-23", "events.jsonl")),
    true,
  );

  const loaded = loadJournalRows({ root, dbPath });
  assert.equal(loaded.length, 3);
  assert.equal(loaded[0]?.symbol, "RUGPUP");
  assert.equal(loaded[0]?.agent, "shield");
  assert.equal(loaded[1]?.pnl, -8);
  assert.equal(loaded[2]?.timestamp.slice(0, 10), "2026-09-23");
  assert.deepEqual(readJournalFiles(root).map((item) => item.action), [
    "check",
    "paper_close",
    "tape",
  ]);
});

test("journal append skips private key material", () => {
  const dir = tempDir();
  const secret = `0x${"ab".repeat(32)}`;
  const result = appendJournalRows(
    [
      row({
        timestamp: "2026-09-22T15:00:00.000Z",
        agent: "shield",
        action: "check",
        symbol: "SLEEPAPE",
        shield_reasons: [`leaked ${secret}`],
      }),
    ],
    { root: path.join(dir, "logs"), dbPath: path.join(dir, "durable.sqlite") },
  );
  assert.equal(result.stored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(fs.existsSync(path.join(dir, "logs")), false);
  const dbFile = path.join(dir, "durable.sqlite");
  if (fs.existsSync(dbFile)) {
    assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(secret)), false);
  }
});

test("learn summary uses sample rows and does not invent fills", () => {
  const summary = summarizeJournal(sampleRows);
  assert.equal(summary.inventedFills, false);
  assert.equal(summary.rows, sampleRows.length);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 2);
  assert.equal(summary.flatExcluded, 1);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.expectancy, 0.25);
  assert.equal(summary.shieldBlocks, 2);
  assert.equal(summary.shieldCorrect, 1);
  assert.equal(summary.shieldWrong, 1);
  assert.equal(summary.shieldAccuracy, 0.5);
  assert.equal(summary.topSymbols[0]?.name, "SLEEPAPE");
  assert.equal(summary.bottomSymbols[0]?.name, "RUGPUP");
  assert.equal(summary.topStrategies[0]?.name, "strategy:paper-clip");
  assert.equal(summary.bottomStrategies[0]?.name, "strategy:caution-clip");

  const text = formatLearnSummary(summary);
  assert.match(text, /Win rate: 50\.0%/);
  assert.match(text, /Expectancy:/);
  assert.match(text, /Shield block accuracy: 50\.0%/);
  assert.match(text, /Invented fills: 0/);
  assert.doesNotMatch(text, /MOONAPE/);

  const empty = formatLearnSummary(summarizeJournal([]));
  assert.match(empty, /no realised closes/i);
  assert.match(empty, /No non-zero PnL/);
  assert.match(empty, /Invented fills: 0/);
});

test("export writes csv and jsonl for the same sample rows", () => {
  const dir = tempDir();
  const csv = journalToCsv(sampleRows);
  assert.match(csv.split("\n")[0] ?? "", /timestamp,session_id,user_id,agent,action/);
  assert.match(csv, /RUGPUP/);
  assert.match(csv, /SLEEPAPE/);
  const written = writeJournalExport(sampleRows, path.join(dir, "exports"), new Date("2026-09-22T18:00:00.000Z"));
  assert.equal(written.count, sampleRows.length);
  assert.match(fs.readFileSync(written.jsonlPath, "utf8"), /"mode":"paper"/);
  assert.equal(fs.readFileSync(written.csvPath, "utf8").split("\n").filter(Boolean).length, sampleRows.length + 1);
});

test("paper snipe drafts a journal row with a null price, and a fully armed live gate still does not broadcast", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const filled = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: {},
  });
  const fill = filled.events.find((event) => event.action === "paper_fill");
  assert.ok(fill);
  assert.equal(fill?.price, null);
  assert.equal(fill?.symbol, "SLEEPAPE");
  assert.equal(fill?.mode, "paper");
  assert.equal(fill?.pnl, null);

  const dir = tempDir();
  const stamped = stampDrafts(filled.events, {
    sessionId: "chat-9",
    userId: "user-9",
    now: new Date("2026-09-22T16:00:00.000Z"),
  });
  appendJournalRows(stamped, {
    root: path.join(dir, "logs"),
    dbPath: path.join(dir, "desk.sqlite"),
  });
  const saved = loadJournalRows({
    root: path.join(dir, "logs"),
    dbPath: path.join(dir, "desk.sqlite"),
    userId: "user-9",
  });
  assert.equal(saved.some((item) => item.action === "paper_fill" && item.price === null), true);

  const key = "b".repeat(32);
  const armedEnv = {
    LIVE_TRADING: "true",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: key,
  };
  const gate = executionGate(armedEnv);
  assert.equal(gate.liveEnabled, true);
  assert.equal(gate.broadcast, false);
  assert.equal(gate.modeLabel, "LIVE_STUB");

  const half = executionGate({ LIVE_TRADING: "true" });
  assert.equal(half.requestedLive, true);
  assert.equal(half.liveEnabled, false);
  assert.equal(half.modeLabel, "PAPER");

  const typo = executionGate({
    LIVE_TRADING: "TRUE",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: key,
  });
  assert.equal(typo.liveEnabled, false);
  const placeholder = executionGate({
    LIVE_TRADING: "true",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: "change-me-to-a-long-random-secret-now",
  });
  assert.equal(placeholder.liveEnabled, false);

  const armed = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: armedEnv,
  });
  assert.equal(armed.state.cashUsd, 1000);
  assert.equal(armed.state.positions.length, 0);
  assert.equal(armed.events.some((event) => event.action === "live_refused" && event.mode === "live"), true);
  const text = armed.lines.map((line) => line.text).join("\n");
  assert.match(text, /not sent|no signer|no transaction broadcaster/i);
  assert.doesNotMatch(text, new RegExp(key));

  const order = submitLiveOrder(
    { symbol: "SLEEPAPE", chain: "base", side: "buy", sizeUsd: 50, shieldVerdict: "pass" },
    armedEnv,
  );
  assert.equal(order.accepted, false);
  assert.equal(order.signed, false);
  assert.equal(order.broadcast, false);
  assert.equal(order.txId, null);

  const blocked = await handleDeskTurn({
    text: "snipe RUGPUP",
    state: hired.state,
    env: armedEnv,
  });
  assert.equal(blocked.state.positions.length, 0);
  assert.match(blocked.lines.map((line) => line.text).join("\n"), /Shield blocked/i);
});

describe("durable env", { concurrency: false }, () => {
test("paper wallet reloads from sqlite after the memory cache is cleared", () => {
  const dir = tempDir();
  const dbPath = path.join(dir, "durable.sqlite");
  const previousDb = process.env.DURABLE_DB_PATH;
  const previousPaper = process.env.PAPER_DESK_PATH;
  process.env.DURABLE_DB_PATH = dbPath;
  delete process.env.PAPER_DESK_PATH;
  resetSessionsForTests();
  try {
    const state = freshDesk();
    state.cashUsd = 950;
    state.positions = [
      {
        id: "SLEEPAPE-1",
        symbol: "SLEEPAPE",
        chain: "base",
        address: "EXAMPLE",
        sizeUsd: 50,
        openedAt: "12:00Z",
        status: "open",
        pnlUsd: 0,
        note: "Paper fill.",
      },
    ];
    saveSession("user-7", state);
    resetSessionsForTests();
    const loaded = loadSession("user-7");
    assert.equal(loaded.cashUsd, 950);
    assert.equal(loaded.positions[0]?.symbol, "SLEEPAPE");
  } finally {
    if (previousDb === undefined) delete process.env.DURABLE_DB_PATH;
    else process.env.DURABLE_DB_PATH = previousDb;
    if (previousPaper === undefined) delete process.env.PAPER_DESK_PATH;
    else process.env.PAPER_DESK_PATH = previousPaper;
    resetSessionsForTests();
    closeDurable(dbPath);
  }
});

test("sqlite keeps encrypted wallet ciphertext when postgres is skipped", async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, "durable.sqlite");
  const previous = {
    FORCE_DURABLE_SQLITE: process.env.FORCE_DURABLE_SQLITE,
    DURABLE_DB_PATH: process.env.DURABLE_DB_PATH,
    SKIP_DATABASE: process.env.SKIP_DATABASE,
    WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,
  };
  process.env.FORCE_DURABLE_SQLITE = "1";
  process.env.DURABLE_DB_PATH = dbPath;
  delete process.env.SKIP_DATABASE;
  process.env.WALLET_ENCRYPTION_KEY = `wallet-test-key-${"z".repeat(24)}`;
  resetUserStoreForTests();
  try {
    const wallet = generateUserWallet();
    await upsertUser("user-3", "casey");
    const saved = await saveGeneratedWallet("user-3", wallet);
    assert.notEqual(saved.evm_pk_enc, null);
    assert.equal(saved.evm_address, wallet.evmAddress);
    closeDurable(dbPath);
    resetUserStoreForTests();
    const loaded = await getUser("user-3");
    assert.equal(loaded?.sol_address, wallet.solAddress);
    const plain = decryptSecret(loaded!.evm_pk_enc!);
    assert.equal(plain.startsWith("0x"), true);
    assert.notEqual(plain, loaded!.evm_pk_enc);
  } finally {
    restoreEnv(previous);
    resetUserStoreForTests();
    closeDurable(dbPath);
  }
});

test("encryption refuses a placeholder key", () => {
  const previous = process.env.WALLET_ENCRYPTION_KEY;
  process.env.WALLET_ENCRYPTION_KEY = "change-me-to-a-long-random-secret-now";
  try {
    assert.throws(() => generateUserWallet(), /backed up offline/i);
  } finally {
    if (previous === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
    else process.env.WALLET_ENCRYPTION_KEY = previous;
  }
});

test("nightly summary reads yesterday and skips an empty day", async () => {
  const sent: string[] = [];
  const status = await runNightlyTick({
    now: new Date("2026-09-23T00:10:00.000Z"),
    rows: sampleRows,
    send: async (text) => {
      sent.push(text);
    },
  });
  assert.equal(status, "sent");
  assert.match(sent[0] ?? "", /Nightly journal 2026-09-22 UTC/);
  assert.match(sent[0] ?? "", /Invented fills: 0/);
  assert.doesNotMatch(sent[0] ?? "", /2026-09-23/);

  const empty = await runNightlyTick({
    now: new Date("2026-09-23T00:10:00.000Z"),
    rows: [],
    send: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(empty, "empty");
  assert.equal(nightlyMessage([], "2026-09-22"), null);

  const later = await runNightlyTick({
    now: new Date("2026-09-23T06:00:00.000Z"),
    rows: sampleRows,
    send: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(later, "skipped-hour");
});
});

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
