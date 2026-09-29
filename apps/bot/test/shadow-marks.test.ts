import assert from "node:assert/strict";
import { test } from "node:test";
import { type Candidate } from "../src/team/candidates.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { executionGate } from "../src/team/gate.ts";
import { stampDrafts, type JournalRow } from "../src/team/journal.ts";
import { summarizeJournal } from "../src/team/learn.ts";
import { freshDesk } from "../src/team/paper.ts";
import { renderDesk } from "../src/team/render.ts";
import {
  MARK_HORIZON_MS,
  resolveDueMarks,
  settleJournalMarks,
} from "../src/team/shadow.ts";

const MINT = "MintBlock111111111111111111111111111111111";
const WHEN = new Date("2026-09-22T12:00:00.000Z");

test("a paper block stores the mint and decision mark and does not fill", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedMarks([2]);
  const blocked = await handleDeskTurn({
    text: "snipe RUGAPE",
    state: { ...hired.state, lastCandidates: [blockCard()] },
    env: {},
    now: WHEN,
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(blocked.state.cashUsd, 1000);
  assert.equal(blocked.state.positions.length, 0);
  assert.equal(blocked.events.some((event) => event.action === "paper_fill"), false);
  const check = blocked.events.find((event) => event.action === "check");
  assert.equal(check?.address, MINT);
  assert.equal(check?.price, 2);
  assert.ok(check?.tags?.includes("verdict:block"));
  assert.ok(check?.tags?.includes("flag:honeypot=bad"));
  assert.ok(check?.tags?.includes("flag:lp-lock=ok"));
  const text = renderDesk(blocked.lines);
  assert.match(text, /No paper fill/);
  assert.match(text, /15m shadow mark labels the block and is not a fill/);
  assert.equal(feed.calls, 1);
});

test("a 15m shadow labels the block and stays out of win rate", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedMarks([2, 1, 1]);
  const blocked = await handleDeskTurn({
    text: "snipe RUGAPE",
    state: { ...hired.state, lastCandidates: [blockCard()] },
    env: {},
    now: WHEN,
    fetchImpl: feed.fetchImpl,
  });
  const stamped = stampDrafts(blocked.events, {
    sessionId: "sess-shadow",
    userId: "user-shadow",
    now: WHEN,
  });
  const later = new Date(WHEN.getTime() + MARK_HORIZON_MS);
  const marks = await resolveDueMarks({
    rows: stamped,
    now: later,
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(marks.length, 1);
  const shadow = marks[0]!;
  assert.equal(shadow.action, "shadow_mark");
  assert.equal(shadow.address, MINT);
  assert.equal(shadow.size, 50);
  assert.equal(shadow.price, 1);
  assert.equal(shadow.pnl, -25);
  assert.ok(shadow.tags.includes(`anchor:check:${WHEN.toISOString()}:RUGAPE`));
  assert.ok(shadow.tags.includes("outcome:shadow"));
  assert.ok(shadow.tags.includes("shadow:no-fill"));
  assert.equal(shadow.mode, "paper");

  const again = await resolveDueMarks({
    rows: [...stamped, ...marks],
    now: later,
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(again.length, 0);
  assert.equal(feed.calls, 2);

  const summary = summarizeJournal([...stamped, ...marks]);
  assert.equal(summary.shieldBlocks, 1);
  assert.equal(summary.shieldCorrect, 1);
  assert.equal(summary.shieldWrong, 0);
  assert.equal(summary.wins, 0);
  assert.equal(summary.losses, 0);
  assert.equal(summary.horizonMarks, 0);
});

test("a flat shadow does not fall through to a later close", () => {
  const block = journalRow({
    timestamp: WHEN.toISOString(),
    agent: "shield",
    action: "check",
    symbol: "RUGAPE",
    tags: ["check", "verdict:block"],
  });
  const shadow = journalRow({
    timestamp: new Date(WHEN.getTime() + MARK_HORIZON_MS).toISOString(),
    agent: "shield",
    action: "shadow_mark",
    symbol: "RUGAPE",
    pnl: 0,
    tags: [`anchor:check:${WHEN.toISOString()}:RUGAPE`, "outcome:shadow"],
  });
  const close = journalRow({
    timestamp: new Date(WHEN.getTime() + MARK_HORIZON_MS + 1000).toISOString(),
    agent: "sniper",
    action: "paper_close",
    symbol: "RUGAPE",
    pnl: 40,
    tags: ["outcome:realised", "strategy:paper-clip"],
  });
  const summary = summarizeJournal([block, shadow, close]);
  assert.equal(summary.shieldUnlabelled, 1);
  assert.equal(summary.shieldCorrect, 0);
  assert.equal(summary.shieldWrong, 0);
  assert.equal(summary.wins, 1);
});

test("a 15m horizon mark uses the fill size and is not a close", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedMarks([2, 4]);
  const filled = await handleDeskTurn({
    text: "snipe LEARNAPE",
    state: { ...hired.state, lastCandidates: [cautionCard()] },
    env: {},
    now: WHEN,
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(filled.state.cashUsd, 975);
  assert.equal(filled.state.positions[0]?.sizeUsd, 25);
  const fill = filled.events.find((event) => event.action === "paper_fill");
  assert.equal(fill?.address, MINT);
  assert.equal(fill?.price, 2);
  assert.equal(fill?.size, 25);
  assert.ok(fill?.tags?.includes("strategy:caution-clip"));
  assert.ok(fill?.tags?.includes("flag:honeypot=unknown"));

  const stamped = stampDrafts(filled.events, {
    sessionId: "sess-horizon",
    userId: "user-horizon",
    now: WHEN,
  });
  const later = new Date(WHEN.getTime() + MARK_HORIZON_MS);
  const marks = await resolveDueMarks({
    rows: stamped,
    now: later,
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(marks.length, 1);
  const horizon = marks[0]!;
  assert.equal(horizon.action, "horizon_mark");
  assert.equal(horizon.size, 25);
  assert.equal(horizon.price, 4);
  assert.equal(horizon.pnl, 25);
  assert.ok(horizon.tags.includes("outcome:horizon"));
  assert.ok(horizon.tags.includes("horizon:open-clip"));
  assert.ok(horizon.tags.includes("strategy:caution-clip"));
  assert.equal(filled.state.cashUsd, 975);
  assert.equal(filled.state.positions[0]?.status, "open");

  const summary = summarizeJournal([...stamped, ...marks]);
  assert.equal(summary.wins, 0);
  assert.equal(summary.losses, 0);
  assert.equal(summary.horizonMarks, 1);
  assert.equal(summary.horizonExpectancy, 25);
});

test("drill addresses and a missing exit do not invent a shadow", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("example tape must not be marked");
  };
  const drill = journalRow({
    timestamp: WHEN.toISOString(),
    agent: "shield",
    action: "check",
    symbol: "RUGPUP",
    chain: "solana",
    address: "EXAMPLE_RUGPUP_NOT_A_MINT",
    price: 2,
    tags: ["check", "verdict:block"],
  });
  const due = new Date(WHEN.getTime() + MARK_HORIZON_MS);
  assert.equal((await resolveDueMarks({ rows: [drill], now: due, fetchImpl })).length, 0);
  assert.equal(calls, 0);

  const young = journalRow({
    ...drill,
    address: MINT,
    timestamp: new Date(due.getTime() - MARK_HORIZON_MS + 1000).toISOString(),
  });
  assert.equal((await resolveDueMarks({ rows: [young], now: due, fetchImpl })).length, 0);
  assert.equal(calls, 0);

  const missing = journalRow({
    timestamp: WHEN.toISOString(),
    agent: "shield",
    action: "check",
    symbol: "RUGAPE",
    chain: "solana",
    address: MINT,
    price: 2,
    tags: ["check", "verdict:block"],
  });
  const blank: typeof fetch = async () =>
    new Response(JSON.stringify([{ priceUsd: "0", liquidity: { usd: 1 } }]), { status: 200 });
  assert.equal(
    (await resolveDueMarks({ rows: [missing], now: due, fetchImpl: blank })).length,
    0,
  );
});

test("an armed live snipe of a blocked mint does not read a mark", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("live path must not read a mark");
  };
  const env = {
    LIVE_TRADING: "true",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: "d".repeat(32),
  };
  assert.equal(executionGate(env).broadcast, false);
  const armed = await handleDeskTurn({
    text: "snipe RUGAPE",
    state: { ...hired.state, lastCandidates: [blockCard()] },
    env,
    fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(armed.state.cashUsd, 1000);
  assert.equal(armed.events.some((event) => event.action === "paper_fill"), false);
  const check = armed.events.find((event) => event.action === "check");
  assert.equal(check?.price, null);
  assert.equal(check?.address, MINT);
});

test("settle is a no-op while the journal is not being stored", async () => {
  assert.equal(await settleJournalMarks(), 0);
});

function blockCard(): Candidate {
  return {
    id: "solana:rug",
    symbol: "RUGAPE",
    name: "Rug Ape",
    chain: "solana",
    address: MINT,
    liqUsd: 50000,
    ageMin: 12,
    taxPct: 0,
    honeypot: true,
    mintAuthority: false,
    freezeAuthority: false,
    lpLocked: true,
    source: "market",
  };
}

function cautionCard(): Candidate {
  return {
    ...blockCard(),
    id: "solana:learn",
    symbol: "LEARNAPE",
    name: "Learn Ape",
    honeypot: null,
  };
}

function journalRow(
  partial: Partial<JournalRow> & Pick<JournalRow, "timestamp" | "agent" | "action">,
): JournalRow {
  return {
    session_id: "sess-1",
    user_id: "user-1",
    symbol: null,
    chain: null,
    address: null,
    size: null,
    price: null,
    pnl: null,
    shield_reasons: [],
    tags: [],
    mode: "paper",
    ...partial,
  };
}

function scriptedMarks(script: number[]): { fetchImpl: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const fetchImpl: typeof fetch = async () => {
    const step = script[Math.min(state.calls, script.length - 1)] ?? 1;
    state.calls += 1;
    return new Response(
      JSON.stringify([
        { priceUsd: "0", liquidity: { usd: 1 } },
        { priceUsd: String(step), liquidity: { usd: 1000 } },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return {
    get calls() {
      return state.calls;
    },
    fetchImpl,
  };
}
