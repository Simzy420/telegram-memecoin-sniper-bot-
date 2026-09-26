import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXAMPLE_CANDIDATES,
  fetchTokenMarkUsd,
  markUsdFromPairs,
} from "../src/team/candidates.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { executionGate } from "../src/team/gate.ts";
import { submitLiveOrder } from "../src/team/live.ts";
import { formatMark, freshDesk, paperPnlUsd, usd } from "../src/team/paper.ts";
import { renderDesk } from "../src/team/render.ts";

const SLEEP = EXAMPLE_CANDIDATES.find((c) => c.symbol === "SLEEPAPE")!;

test("paper pnl is size times the relative mark move", () => {
  assert.equal(paperPnlUsd(50, 1, 1.5), 25);
  assert.equal(paperPnlUsd(25, 2, 1), -12.5);
  assert.equal(paperPnlUsd(50, 1, 1), 0);
  assert.equal(paperPnlUsd(50, null, 1), null);
  assert.equal(paperPnlUsd(50, 1, null), null);
  assert.equal(paperPnlUsd(50, 0, 1), null);
  assert.equal(paperPnlUsd(50, 1, -1), null);
});

test("dexscreener mark uses the highest-liquidity positive price", () => {
  assert.equal(
    markUsdFromPairs([
      { priceUsd: "0.1", liquidity: { usd: 10 } },
      { priceUsd: "0", liquidity: { usd: 999 } },
      { priceUsd: "nope", liquidity: { usd: 50 } },
      { priceUsd: "1.25", liquidity: { usd: 40 } },
    ]),
    1.25,
  );
  assert.equal(markUsdFromPairs({ pairs: [{ priceUsd: "2", liquidity: { usd: 1 } }] }), 2);
  assert.equal(markUsdFromPairs([]), null);
  assert.equal(markUsdFromPairs([{ priceUsd: "-3", liquidity: { usd: 10 } }]), null);
});

test("mark fetch returns null on failure and does not invent a drill price", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("offline");
  };
  assert.equal(await fetchTokenMarkUsd("base", SLEEP.address, fetchImpl), null);
  assert.equal(calls, 1);

  const missed: typeof fetch = async () => {
    calls += 1;
    return new Response("no", { status: 404 });
  };
  assert.equal(await fetchTokenMarkUsd("base", SLEEP.address, missed), null);

  const exampleCalls = calls;
  assert.equal(
    await fetchTokenMarkUsd("solana", "EXAMPLE_PAPERPEPE_NOT_A_MINT", fetchImpl),
    null,
  );
  assert.equal(calls, exampleCalls);
});

test("mocked marks produce a non-zero paper pnl on fill and close", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedFeed([1, 1.5]);
  const filled = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  const position = filled.state.positions[0];
  assert.equal(position?.symbol, "SLEEPAPE");
  assert.equal(position?.entryPriceUsd, 1);
  assert.equal(position?.pnlUsd, 0);
  assert.equal(position?.status, "open");
  const fill = filled.events.find((event) => event.action === "paper_fill");
  assert.equal(fill?.price, 1);
  assert.equal(fill?.pnl, null);
  assert.equal(fill?.mode, "paper");
  const filledText = renderDesk(filled.lines);
  assert.match(filledText, /entry mark/i);
  assert.match(filledText, new RegExp(escapeReg(formatMark(1))));
  assert.match(filledText, /MTM PnL/);
  assert.match(filledText, /No transaction broadcast|no transaction broadcaster/i);
  assert.equal(filled.state.cashUsd, 950);

  const closed = await handleDeskTurn({
    text: "close SLEEPAPE",
    state: filled.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(closed.state.positions[0]?.status, "closed");
  assert.equal(closed.state.positions[0]?.pnlUsd, 25);
  assert.equal(closed.state.cashUsd, 1025);
  const close = closed.events.find((event) => event.action === "paper_close");
  assert.equal(close?.price, 1.5);
  assert.equal(close?.pnl, 25);
  assert.equal(close?.mode, "paper");
  const text = renderDesk(closed.lines);
  assert.match(text, /PnL/);
  assert.match(text, new RegExp(escapeReg(usd(25))));
  assert.match(text, /I did not send a transaction/);
  assert.doesNotMatch(text, /Mark unavailable/i);
  assert.ok(feed.calls.every((url) => url.includes("api.dexscreener.com/tokens/v1/")));
  assert.ok(feed.calls.every((url) => url.includes(SLEEP.address)));
});

test("a failed exit read stays flat and does not reuse the entry as a price", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedFeed([1, "fail"]);
  const filled = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(filled.state.positions[0]?.entryPriceUsd, 1);

  const closed = await handleDeskTurn({
    text: "close SLEEPAPE",
    state: filled.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(closed.state.positions[0]?.pnlUsd, 0);
  assert.equal(closed.state.cashUsd, 1000);
  assert.match(closed.state.positions[0]?.note ?? "", /Mark unavailable/);
  const close = closed.events.find((event) => event.action === "paper_close");
  assert.equal(close?.price, null);
  assert.equal(close?.pnl, null);
  assert.match(renderDesk(closed.lines), /Mark unavailable, so PnL stays flat/);
  assert.match(renderDesk(closed.lines), /I did not send a transaction/);
});

test("ledger shows entry and open MTM, and a later failed close can use that mark", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const feed = scriptedFeed([1, 1.2, "fail"]);
  const filled = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  const book = await handleDeskTurn({
    text: "/ledger",
    state: filled.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(book.state.positions[0]?.entryPriceUsd, 1);
  assert.equal(book.state.positions[0]?.lastMarkUsd, 1.2);
  assert.equal(book.state.positions[0]?.pnlUsd, 10);
  assert.equal(book.state.cashUsd, 950);
  const bookText = renderDesk(book.lines);
  assert.match(bookText, /entry /);
  assert.match(bookText, new RegExp(escapeReg(formatMark(1))));
  assert.match(bookText, new RegExp(`mark ${escapeReg(formatMark(1.2))}`));
  assert.match(bookText, /MTM PnL/);
  assert.match(bookText, new RegExp(escapeReg(usd(10))));

  const closed = await handleDeskTurn({
    text: "close SLEEPAPE",
    state: book.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(closed.state.positions[0]?.pnlUsd, 10);
  assert.equal(closed.state.cashUsd, 1010);
  const close = closed.events.find((event) => event.action === "paper_close");
  assert.equal(close?.price, 1.2);
  assert.equal(close?.pnl, 10);
  assert.match(closed.state.positions[0]?.note ?? "", /last known mark/i);
});

test("a caution clip uses the smaller size in the same pnl formula", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const drill = EXAMPLE_CANDIDATES.find((c) => c.symbol === "PAPERPEPE")!;
  const cautious = {
    ...drill,
    address: "MintCaution11111111111111111111111111111111",
  };
  const feed = scriptedFeed([2, 1]);
  const filled = await handleDeskTurn({
    text: "snipe PAPERPEPE",
    state: { ...hired.state, lastCandidates: [cautious] },
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(filled.state.positions[0]?.sizeUsd, 25);
  assert.equal(filled.state.positions[0]?.entryPriceUsd, 2);
  const closed = await handleDeskTurn({
    text: "close PAPERPEPE",
    state: filled.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(closed.state.positions[0]?.pnlUsd, -12.5);
  assert.equal(closed.state.cashUsd, 987.5);
  const close = closed.events.find((event) => event.action === "paper_close");
  assert.equal(close?.pnl, -12.5);
  assert.equal(close?.price, 1);
  assert.ok(close?.tags?.includes("strategy:caution-clip"));
});

test("an armed live gate still never broadcasts and does not paper-fill", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("mark feed must not run on the live path");
  };
  const key = "c".repeat(32);
  const env = {
    LIVE_TRADING: "true",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: key,
  };
  const gate = executionGate(env);
  assert.equal(gate.liveEnabled, true);
  assert.equal(gate.broadcast, false);

  const armed = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env,
    fetchImpl,
  });
  assert.equal(calls, 0);
  assert.equal(armed.state.positions.length, 0);
  assert.equal(armed.state.cashUsd, 1000);
  assert.equal(
    armed.events.some((event) => event.action === "live_refused" && event.mode === "live"),
    true,
  );
  assert.equal(armed.events.some((event) => event.action === "paper_fill"), false);
  const text = renderDesk(armed.lines);
  assert.match(text, /not sent|no signer|no transaction broadcaster/i);
  assert.doesNotMatch(text, new RegExp(key));

  const order = submitLiveOrder(
    { symbol: "SLEEPAPE", chain: "base", side: "buy", sizeUsd: 50, shieldVerdict: "pass" },
    env,
  );
  assert.equal(order.accepted, false);
  assert.equal(order.signed, false);
  assert.equal(order.broadcast, false);
  assert.equal(order.txId, null);
});

function scriptedFeed(script: Array<number | "fail">): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    const step = script[Math.min(i, script.length - 1)] ?? "fail";
    i += 1;
    if (step === "fail") return new Response("unavailable", { status: 502 });
    return new Response(
      JSON.stringify([
        { priceUsd: "0", liquidity: { usd: 999999 } },
        { priceUsd: String(step), liquidity: { usd: 1000 } },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetchImpl, calls };
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
