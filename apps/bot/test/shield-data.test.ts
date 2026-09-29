import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCandidateCache,
  discoverCandidates,
  type Candidate,
} from "../src/team/candidates.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { freshDesk } from "../src/team/paper.ts";
import { renderDesk } from "../src/team/render.ts";
import { runShield } from "../src/team/safety.ts";
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  mergeShieldFacts,
  parseMintAccount,
  parseRugcheckReport,
  sumLiquidityUsd,
} from "../src/team/shield-data.ts";

const MINT = "Mint111111111111111111111111111111111111111";

test("liquidity depth sums every reported pair and ignores missing numbers", () => {
  assert.equal(
    sumLiquidityUsd([
      { liquidity: { usd: 12000 } },
      { liquidity: { usd: 15000 } },
      { liquidity: {} },
    ]),
    27000,
  );
  assert.equal(sumLiquidityUsd([{ liquidity: {} }, {}]), null);
  assert.equal(sumLiquidityUsd([{ liquidity: { usd: 0 } }]), 0);
});

test("a classic spl mint sets tax to 0 and reads authorities", () => {
  const clean = parseMintAccount(mintAccount().toString("base64"), SPL_TOKEN_PROGRAM_ID);
  assert.equal(clean.mintAuthority, false);
  assert.equal(clean.freezeAuthority, false);
  assert.equal(clean.taxPct, 0);
  assert.equal(clean.honeypot, undefined);

  const live = parseMintAccount(
    mintAccount({ mint: Buffer.alloc(32, 7) }).toString("base64"),
    SPL_TOKEN_PROGRAM_ID,
  );
  assert.equal(live.mintAuthority, true);
  assert.equal(parseMintAccount(mintAccount({ initialized: false }).toString("base64"), SPL_TOKEN_PROGRAM_ID).taxPct, undefined);
  assert.deepEqual(parseMintAccount(mintAccount().toString("base64"), "11111111111111111111111111111111"), {});
});

test("token-2022 fee, non-transferable, and truncated fee stay fail-closed", () => {
  const taxed = parseMintAccount(
    mintAccount({ extensions: tlv(1, feeBody(100, 1500)) }).toString("base64"),
    TOKEN_2022_PROGRAM_ID,
  );
  assert.equal(taxed.taxPct, 15);

  const blocked = parseMintAccount(
    mintAccount({ extensions: tlv(9, Buffer.alloc(0)) }).toString("base64"),
    TOKEN_2022_PROGRAM_ID,
  );
  assert.equal(blocked.honeypot, true);
  assert.equal(blocked.taxPct, 0);

  const seized = parseMintAccount(
    mintAccount({ extensions: tlv(12, Buffer.alloc(32, 4)) }).toString("base64"),
    TOKEN_2022_PROGRAM_ID,
  );
  assert.equal(seized.honeypot, true);

  const truncated = parseMintAccount(
    mintAccount({ extensions: tlv(1, Buffer.alloc(10)) }).toString("base64"),
    TOKEN_2022_PROGRAM_ID,
  );
  assert.equal(truncated.taxPct, undefined);
});

test("rugcheck fills only fields the report actually contains", () => {
  const clean = parseRugcheckReport(cleanReport());
  assert.equal(clean.honeypot, false);
  assert.equal(clean.lpLocked, true);
  assert.equal(clean.taxPct, 0);
  assert.equal(clean.mintAuthority, false);
  assert.equal(clean.freezeAuthority, false);
  assert.equal(clean.liqUsd, 42000);

  const partial = parseRugcheckReport({
    rugged: false,
    token: { isInitialized: true, mintAuthority: null },
    risks: [],
  });
  assert.equal(partial.honeypot, undefined);
  assert.equal(partial.lpLocked, undefined);
  assert.equal(partial.mintAuthority, false);

  const hooked = parseRugcheckReport({
    ...cleanReport(),
    token_extensions: { transferHook: { program: "Hook111" } },
  });
  assert.equal(hooked.honeypot, undefined);

  const danger = parseRugcheckReport({
    ...cleanReport(),
    risks: [{ name: "Weird custom", level: "danger" }],
  });
  assert.equal(danger.honeypot, undefined);

  const sellBlocked = parseRugcheckReport({
    ...cleanReport(),
    risks: [{ name: "Honeypot", level: "danger" }],
  });
  assert.equal(sellBlocked.honeypot, true);
  assert.equal(parseRugcheckReport({ rugged: true }).honeypot, true);
  assert.deepEqual(parseRugcheckReport({ error: "nope" }), {});

  const pumpLp = parseRugcheckReport({
    markets: [
      {
        lp: {
          lpMint: "11111111111111111111111111111111",
          lpLockedPct: 100,
          lpLocked: 10,
          lpUnlocked: 0,
          baseUSD: 100,
          quoteUSD: 50,
        },
      },
    ],
  });
  assert.equal(pumpLp.lpLocked, true);

  const unjudged = parseRugcheckReport({
    markets: [
      {
        lp: {
          lpMint: "11111111111111111111111111111111",
          lpLockedPct: 0,
          lpLocked: 0,
          lpUnlocked: 0,
          baseUSD: 100,
          quoteUSD: 50,
        },
      },
    ],
  });
  assert.equal(unjudged.lpLocked, undefined);

  const deepestUnlocked = parseRugcheckReport({
    markets: [
      {
        lp: {
          lpMint: "LockedMint111111111111111111111111111111",
          lpLockedPct: 100,
          lpLocked: 1,
          lpUnlocked: 0,
          baseUSD: 10,
          quoteUSD: 0,
        },
      },
      {
        lp: {
          lpMint: "OpenMint11111111111111111111111111111111",
          lpLockedPct: 10,
          lpLocked: 1,
          lpUnlocked: 50,
          baseUSD: 40000,
          quoteUSD: 10000,
        },
      },
    ],
  });
  assert.equal(deepestUnlocked.lpLocked, false);
});

test("shield passes only a fully checked card and blocks clear rug signals", () => {
  const blank = marketCard();
  assert.equal(runShield(blank).verdict, "caution");

  const depthOnly = mergeShieldFacts(blank, {
    liqUsd: 50000,
    taxPct: 0,
    mintAuthority: false,
    freezeAuthority: false,
  });
  assert.equal(depthOnly.honeypot, null);
  assert.equal(depthOnly.lpLocked, null);
  assert.equal(runShield(depthOnly).verdict, "caution");

  const passed = mergeShieldFacts(depthOnly, parseRugcheckReport(cleanReport()));
  assert.equal(runShield(passed).verdict, "pass");

  const thin = mergeShieldFacts(passed, {});
  thin.liqUsd = 800;
  assert.equal(runShield(thin).verdict, "block");

  const taxed = mergeShieldFacts(passed, { taxPct: 12 });
  assert.equal(taxed.taxPct, 12);
  assert.equal(runShield(taxed).verdict, "block");

  const chainFee = parseMintAccount(
    mintAccount({ extensions: tlv(1, feeBody(0, 1200)) }).toString("base64"),
    TOKEN_2022_PROGRAM_ID,
  );
  const disagree = mergeShieldFacts(
    mergeShieldFacts(blank, chainFee),
    parseRugcheckReport({ ...cleanReport(), transferFee: { pct: 0 } }),
  );
  assert.equal(disagree.taxPct, 12);
  assert.equal(runShield(disagree).verdict, "block");

  const unlocked = mergeShieldFacts(passed, {
    lpLocked: false,
  });
  assert.equal(runShield({ ...passed, lpLocked: false }).verdict, "caution");
  assert.equal(unlocked.lpLocked, false);
});

test("market discovery uses dex depth, mint bytes, and rugcheck without inventing a pass", async () => {
  clearCandidateCache();
  const passed = await discoverCandidates({
    fetchImpl: scriptFetch({
      pairs: [
        { baseToken: { symbol: "CLEANAPE", name: "Clean Ape" }, liquidity: { usd: 12000 } },
        { baseToken: { symbol: "CLEANAPE", name: "Clean Ape" }, liquidity: { usd: 15000 } },
      ],
      heliusAsset: { mint_authority: null, freeze_authority: null },
      mint: { data: mintAccount().toString("base64"), owner: SPL_TOKEN_PROGRAM_ID },
      rugcheck: cleanReport(),
    }),
    heliusApiKey: "helius-secret",
    bypassCache: true,
  });
  assert.equal(passed.feed, "market");
  assert.equal(passed.candidates[0]?.symbol, "CLEANAPE");
  assert.equal(passed.candidates[0]?.liqUsd, 27000);
  assert.equal(passed.candidates[0]?.taxPct, 0);
  assert.equal(passed.candidates[0]?.honeypot, false);
  assert.equal(passed.candidates[0]?.lpLocked, true);
  assert.equal(runShield(passed.candidates[0]!).verdict, "pass");
  assert.ok(passed.notes.includes("Helius mint/freeze check"));
  assert.ok(passed.notes.includes("Solana mint account check"));
  assert.ok(passed.notes.includes("RugCheck read"));

  clearCandidateCache();
  const cautious = await discoverCandidates({
    fetchImpl: scriptFetch({
      pairs: [{ baseToken: { symbol: "THINDATA", name: "Thin Data" }, liquidity: { usd: 40000 } }],
      heliusAsset: { mint_authority: null, freeze_authority: null },
      mint: { data: mintAccount().toString("base64"), owner: SPL_TOKEN_PROGRAM_ID },
      rugcheck: "down",
    }),
    heliusApiKey: "helius-secret",
    bypassCache: true,
  });
  assert.equal(cautious.candidates[0]?.liqUsd, 40000);
  assert.equal(cautious.candidates[0]?.taxPct, 0);
  assert.equal(cautious.candidates[0]?.honeypot, null);
  assert.equal(cautious.candidates[0]?.lpLocked, null);
  assert.equal(runShield(cautious.candidates[0]!).verdict, "caution");
  assert.equal(cautious.notes.includes("RugCheck read"), false);

  clearCandidateCache();
  const fromRugDepth = await discoverCandidates({
    fetchImpl: scriptFetch({
      pairs: [{ baseToken: { symbol: "PUMPAPE", name: "Pump Ape" }, priceUsd: "0.01" }],
      heliusAsset: { mint_authority: null, freeze_authority: null },
      mint: { data: mintAccount().toString("base64"), owner: SPL_TOKEN_PROGRAM_ID },
      rugcheck: cleanReport({ totalMarketLiquidity: 25000 }),
    }),
    heliusApiKey: "helius-secret",
    bypassCache: true,
  });
  assert.equal(fromRugDepth.candidates[0]?.liqUsd, 25000);
  assert.equal(runShield(fromRugDepth.candidates[0]!).verdict, "pass");

  clearCandidateCache();
  const alchemyOnly = await discoverCandidates({
    fetchImpl: scriptFetch({
      pairs: [{ baseToken: { symbol: "ALCHAPE", name: "Alch Ape" }, liquidity: { usd: 30000 } }],
      rpcHost: "solana-mainnet.g.alchemy.com",
      mint: { data: mintAccount().toString("base64"), owner: SPL_TOKEN_PROGRAM_ID },
      rugcheck: "down",
    }),
    alchemyApiKey: "alchemy-secret",
    bypassCache: true,
  });
  assert.equal(alchemyOnly.candidates[0]?.mintAuthority, false);
  assert.equal(alchemyOnly.candidates[0]?.taxPct, 0);
  assert.equal(runShield(alchemyOnly.candidates[0]!).verdict, "caution");
  assert.ok(alchemyOnly.notes.includes("Solana mint account check"));
});

test("a checked pass clip is $50 and an incomplete solana card is a $25 caution clip", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), env: {} });
  const passCard = mergeShieldFacts(marketCard({ symbol: "CLEANAPE" }), {
    liqUsd: 50000,
    taxPct: 0,
    honeypot: false,
    mintAuthority: false,
    freezeAuthority: false,
    lpLocked: true,
  });
  const cautionCard = mergeShieldFacts(marketCard({ symbol: "LEARNAPE", address: MINT }), {
    liqUsd: 50000,
    taxPct: 0,
    mintAuthority: false,
    freezeAuthority: false,
  });
  const blockCard = { ...passCard, symbol: "RUGAPE", honeypot: true };
  assert.equal(runShield(passCard).verdict, "pass");
  assert.equal(runShield(cautionCard).verdict, "caution");
  assert.equal(runShield(blockCard).verdict, "block");

  const feed = scriptedMarks([1.25, 2]);
  const filled = await handleDeskTurn({
    text: "snipe CLEANAPE",
    state: { ...hired.state, lastCandidates: [passCard, cautionCard, blockCard] },
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(filled.state.positions[0]?.sizeUsd, 50);
  assert.equal(filled.state.positions[0]?.entryPriceUsd, 1.25);

  const learned = await handleDeskTurn({
    text: "snipe LEARNAPE",
    state: filled.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  const clip = learned.state.positions.find((position) => position.symbol === "LEARNAPE");
  assert.equal(clip?.sizeUsd, 25);
  assert.equal(clip?.entryPriceUsd, 2);
  assert.match(renderDesk(learned.lines), /Caution clip is \$25 paper/);

  const blocked = await handleDeskTurn({
    text: "snipe RUGAPE",
    state: learned.state,
    env: {},
    fetchImpl: feed.fetchImpl,
  });
  assert.equal(blocked.state.positions.some((position) => position.symbol === "RUGAPE"), false);
  assert.match(renderDesk(blocked.lines), /No paper fill/);
});

function marketCard(over: Partial<Candidate> = {}): Candidate {
  return {
    id: "solana:mint",
    symbol: "CLEANAPE",
    name: "Clean Ape",
    chain: "solana",
    address: MINT,
    liqUsd: null,
    ageMin: 12,
    taxPct: null,
    honeypot: null,
    mintAuthority: null,
    freezeAuthority: null,
    lpLocked: null,
    source: "market",
    ...over,
  };
}

function cleanReport(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rugged: false,
    token: {
      mintAuthority: null,
      freezeAuthority: null,
      isInitialized: true,
    },
    transferFee: { pct: 0, maxAmount: 0, authority: "11111111111111111111111111111111" },
    totalMarketLiquidity: 42000,
    token_extensions: null,
    risks: [],
    markets: [
      {
        marketType: "raydium",
        lp: {
          lpMint: "RealLpMint11111111111111111111111111111111",
          lpLockedPct: 100,
          lpLocked: 1000,
          lpUnlocked: 0,
          baseUSD: 30000,
          quoteUSD: 12000,
        },
      },
    ],
    ...over,
  };
}

function scriptFetch(opts: {
  pairs: unknown[];
  heliusAsset?: Record<string, unknown>;
  mint?: { data: string; owner: string };
  rugcheck?: Record<string, unknown> | "down";
  rpcHost?: string;
}): typeof fetch {
  return async (url, init) => {
    const href = String(url);
    if (href.includes("token-profiles")) {
      return json([{ chainId: "solana", tokenAddress: MINT }]);
    }
    if (href.includes("dexscreener.com/tokens")) return json(opts.pairs);
    if (href.includes("helius-rpc.com")) {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "getAsset") {
        return json({ result: { token_info: opts.heliusAsset ?? {} } });
      }
      if (method === "getAccountInfo") {
        return json({
          result: {
            value: opts.mint ? { data: [opts.mint.data, "base64"], owner: opts.mint.owner } : null,
          },
        });
      }
      throw new Error(method);
    }
    if (opts.rpcHost && href.includes(opts.rpcHost)) {
      const method = JSON.parse(String(init?.body)).method;
      assert.equal(method, "getAccountInfo");
      return json({
        result: {
          value: opts.mint ? { data: [opts.mint.data, "base64"], owner: opts.mint.owner } : null,
        },
      });
    }
    if (href.includes("rugcheck.xyz")) {
      if (opts.rugcheck === "down") return new Response("no", { status: 503 });
      return json(opts.rugcheck ?? {});
    }
    throw new Error(`unexpected ${href}`);
  };
}

function scriptedMarks(script: number[]): { fetchImpl: typeof fetch } {
  let i = 0;
  const fetchImpl: typeof fetch = async () => {
    const step = script[Math.min(i, script.length - 1)] ?? 1;
    i += 1;
    return json([
      { priceUsd: "0", liquidity: { usd: 1 } },
      { priceUsd: String(step), liquidity: { usd: 1000 } },
    ]);
  };
  return { fetchImpl };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function coption(pubkey: Buffer | null): Buffer {
  const buf = Buffer.alloc(36);
  if (pubkey) {
    buf.writeUInt32LE(1, 0);
    pubkey.copy(buf, 4);
  }
  return buf;
}

function mintAccount(opts: {
  mint?: Buffer | null;
  freeze?: Buffer | null;
  initialized?: boolean;
  extensions?: Buffer;
} = {}): Buffer {
  const base = Buffer.alloc(82);
  coption(opts.mint ?? null).copy(base, 0);
  base.writeBigUInt64LE(1n, 36);
  base[44] = 6;
  base[45] = opts.initialized === false ? 0 : 1;
  coption(opts.freeze ?? null).copy(base, 46);
  if (!opts.extensions) return base;
  const head = Buffer.alloc(166);
  base.copy(head, 0);
  head[165] = 1;
  return Buffer.concat([head, opts.extensions]);
}

function tlv(type: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(body.length, 2);
  return Buffer.concat([head, body]);
}

function feeBody(olderBps: number, newerBps: number): Buffer {
  const body = Buffer.alloc(108);
  body.writeUInt16LE(olderBps, 88);
  body.writeUInt16LE(newerBps, 106);
  return body;
}
