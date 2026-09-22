import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCandidateCache,
  discoverCandidates,
  EXAMPLE_CANDIDATES,
} from "../src/team/candidates.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { executionGate } from "../src/team/gate.ts";
import { parseFlavor } from "../src/team/openai.ts";
import { freshDesk, usd } from "../src/team/paper.ts";
import { SPECIALISTS } from "../src/team/personas.ts";
import { renderDesk } from "../src/team/render.ts";
import { routeUserText } from "../src/team/router.ts";
import { runShield } from "../src/team/safety.ts";

const quiet = { env: {} as Record<string, string | undefined> };

test("troop names stay Scout Sniper Pulse Ledger Shield", () => {
  assert.equal(
    SPECIALISTS.map((s) => s.name).join(","),
    "Scout,Sniper,Pulse,Ledger,Shield",
  );
});

test("router sends discovery, safety, and entries to the right specialists", () => {
  const found = routeUserText("scout, any new pairs?");
  assert.equal(found.intent, "discover");
  assert.deepEqual(found.specialists, ["scout"]);

  const safety = routeUserText("shield check SLEEPAPE");
  assert.equal(safety.intent, "safety");
  assert.equal(safety.symbol, "SLEEPAPE");
  assert.deepEqual(safety.specialists, ["shield"]);

  const snipe = routeUserText("snipe PAPERPEPE");
  assert.equal(snipe.intent, "snipe");
  assert.equal(snipe.symbol, "PAPERPEPE");
  assert.deepEqual(snipe.specialists, ["sniper", "shield"]);

  const book = routeUserText("how's my pnl");
  assert.equal(book.intent, "ledger");
  assert.deepEqual(book.specialists, ["ledger"]);
});

test("execution gate defaults to paper and never broadcasts", () => {
  const off = executionGate({});
  assert.equal(off.requestedLive, false);
  assert.equal(off.broadcast, false);
  assert.equal(off.modeLabel, "PAPER");

  const on = executionGate({ LIVE_TRADING: "true" });
  assert.equal(on.requestedLive, true);
  assert.equal(on.broadcast, false);
  assert.match(on.detail, /no transaction broadcaster/i);
});

test("shield blocks the honeypot drill and passes the clean drill", () => {
  const rug = EXAMPLE_CANDIDATES.find((c) => c.symbol === "RUGPUP");
  const clean = EXAMPLE_CANDIDATES.find((c) => c.symbol === "SLEEPAPE");
  assert.ok(rug && clean);
  assert.equal(runShield(rug).verdict, "block");
  assert.equal(runShield(clean).verdict, "pass");
  const cautious = runShield(EXAMPLE_CANDIDATES.find((c) => c.symbol === "PAPERPEPE")!);
  assert.equal(cautious.verdict, "caution");
  assert.ok(cautious.flags.some((f) => f.label === "Freeze authority" && f.status === "warn"));
});

test("paper snipe updates the journal and refuses a blocked name", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), ...quiet });
  assert.match(renderDesk(hired.lines), /Scout/);
  assert.match(renderDesk(hired.lines), /Shield/);
  assert.doesNotMatch(renderDesk(hired.lines), /Clawd|OpenClaw/i);

  const blocked = await handleDeskTurn({
    text: "snipe RUGPUP",
    state: hired.state,
    ...quiet,
  });
  const blockedText = renderDesk(blocked.lines);
  assert.match(blockedText, /Shield/);
  assert.match(blockedText, /BLOCK/);
  assert.equal(blocked.state.cashUsd, 1000);
  assert.equal(blocked.state.positions.length, 0);
  assert.doesNotMatch(blockedText, /Paper entry/);

  const filled = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    env: { LIVE_TRADING: "true", OPENAI_API_KEY: "sk-super-secret" },
  });
  const filledText = renderDesk(filled.lines);
  assert.match(filledText, /Sniper/);
  assert.match(filledText, /Ledger/);
  assert.match(filledText, /Paper entry SLEEPAPE/);
  assert.match(filledText, /no transaction broadcaster/i);
  assert.doesNotMatch(filledText, /sk-super-secret/);
  assert.equal(filled.state.cashUsd, 950);
  assert.equal(filled.state.positions[0]?.symbol, "SLEEPAPE");
  assert.equal(filled.state.positions[0]?.pnlUsd, 0);
  assert.equal("signature" in (filled.state.positions[0] ?? {}), false);

  const closed = await handleDeskTurn({
    text: "close SLEEPAPE",
    state: filled.state,
    ...quiet,
  });
  assert.equal(closed.state.cashUsd, 1000);
  assert.equal(closed.state.positions[0]?.status, "closed");
  assert.match(renderDesk(closed.lines), /I did not send a transaction/);

  const book = await handleDeskTurn({ text: "/ledger", state: filled.state, ...quiet });
  assert.match(renderDesk(book.lines), /SLEEPAPE/);
  assert.match(renderDesk(book.lines), new RegExp(usd(950).replace("$", "\\$")));
});

test("status hides provider secrets and lists the hired troop", async () => {
  const hired = await handleDeskTurn({ text: "hire team", state: freshDesk(), ...quiet });
  const status = await handleDeskTurn({
    text: "/status",
    state: hired.state,
    env: { OPENAI_API_KEY: "sk-super-secret", HELIUS_API_KEY: "helius-secret" },
  });
  const text = renderDesk(status.lines);
  assert.match(text, /Scout, Sniper, Pulse, Ledger, Shield/);
  assert.match(text, /OpenAI set/);
  assert.match(text, /Helius set/);
  assert.match(text, /Alchemy not set/);
  assert.doesNotMatch(text, /sk-super-secret|helius-secret/);
  assert.match(text, /Paper mode/);
});

test("a pasted key is not echoed", async () => {
  const secret = `0x${"ab".repeat(32)}`;
  const turn = await handleDeskTurn({ text: `key ${secret}`, state: freshDesk(), ...quiet });
  const text = renderDesk(turn.lines);
  assert.match(text, /will not repeat it/i);
  assert.doesNotMatch(text, new RegExp(secret));
  assert.equal(turn.state.journal.length, 0);
});

test("watch attributes scout, shield, and pulse", async () => {
  const turn = await handleDeskTurn({
    text: "/watch",
    state: freshDesk(),
    ...quiet,
    discover: async () => ({
      candidates: EXAMPLE_CANDIDATES,
      feed: "example",
      notes: ["Example tape."],
    }),
  });
  const text = renderDesk(turn.lines);
  assert.match(text, /🔭 <b>Scout<\/b>/);
  assert.match(text, /🛡️ <b>Shield<\/b>/);
  assert.match(text, /📡 <b>Pulse<\/b>/);
  assert.match(text, /🦍 <b>Big Brain Ape<\/b>/);
  assert.equal(turn.state.watching, true);
});

test("market discovery uses helius when a key is present and falls back to drills", async () => {
  clearCandidateCache();
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("token-profiles")) {
      return json([
        {
          chainId: "solana",
          tokenAddress: "Mint111111111111111111111111111111111111111",
        },
      ]);
    }
    if (href.includes("dexscreener.com/tokens")) {
      return json([
        {
          baseToken: { symbol: "LIVEAPE", name: "Live Ape" },
          liquidity: { usd: 15000 },
          pairCreatedAt: Date.now() - 3 * 60_000,
        },
      ]);
    }
    if (href.includes("helius-rpc.com")) {
      assert.equal(JSON.parse(String(init?.body)).method, "getAsset");
      return json({
        result: { token_info: { mint_authority: null, freeze_authority: "Freeze111" } },
      });
    }
    throw new Error(`unexpected ${href}`);
  };

  const found = await discoverCandidates({
    fetchImpl,
    heliusApiKey: "helius-secret",
    bypassCache: true,
  });
  assert.equal(found.feed, "market");
  assert.equal(found.candidates[0]?.symbol, "LIVEAPE");
  assert.equal(found.candidates[0]?.mintAuthority, false);
  assert.equal(found.candidates[0]?.freezeAuthority, true);
  assert.ok(found.notes.includes("Helius mint/freeze check"));
  assert.ok(calls.some((url) => url.includes("api-key=helius-secret")));

  const fallback = await discoverCandidates({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    bypassCache: true,
  });
  assert.equal(fallback.feed, "example");
  assert.equal(fallback.candidates[0]?.symbol, "PAPERPEPE");
});

test("openai flavor is dropped when it claims a broadcast", () => {
  const original = [{ speaker: "boss" as const, text: "Paper only." }];
  assert.equal(
    parseFlavor(
      JSON.stringify({
        lines: [{ speaker: "boss", text: "Transaction sent on-chain." }],
      }),
      original,
    ),
    null,
  );
  const kept = parseFlavor(
    JSON.stringify({
      lines: [{ speaker: "boss", text: "Still paper. Nobody spends." }],
    }),
    original,
  );
  assert.equal(kept?.[0]?.text, "Still paper. Nobody spends.");
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
