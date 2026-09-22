export type CandidateChain = "solana" | "base" | "ethereum";
export type CandidateSource = "example" | "market";

export interface Candidate {
  id: string;
  symbol: string;
  name: string;
  chain: CandidateChain;
  address: string;
  liqUsd: number | null;
  ageMin: number | null;
  taxPct: number | null;
  honeypot: boolean | null;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  lpLocked: boolean | null;
  source: CandidateSource;
}

export interface Discovery {
  candidates: Candidate[];
  feed: CandidateSource;
  notes: string[];
}

/**
 * Drill candidates. Addresses are labels, not mints. Do not send funds to them.
 */
export const EXAMPLE_CANDIDATES: Candidate[] = [
  {
    id: "paperpepe",
    symbol: "PAPERPEPE",
    name: "Paper Pepe",
    chain: "solana",
    address: "EXAMPLE_PAPERPEPE_NOT_A_MINT",
    liqUsd: 42000,
    ageMin: 6,
    taxPct: 0,
    honeypot: false,
    mintAuthority: false,
    freezeAuthority: true,
    lpLocked: true,
    source: "example",
  },
  {
    id: "rugpup",
    symbol: "RUGPUP",
    name: "Rug Pup",
    chain: "solana",
    address: "EXAMPLE_RUGPUP_NOT_A_MINT",
    liqUsd: 800,
    ageMin: 2,
    taxPct: 25,
    honeypot: true,
    mintAuthority: true,
    freezeAuthority: true,
    lpLocked: false,
    source: "example",
  },
  {
    id: "sleepape",
    symbol: "SLEEPAPE",
    name: "Sleep Ape",
    chain: "base",
    address: "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE1",
    liqUsd: 88000,
    ageMin: 40,
    taxPct: 1,
    honeypot: false,
    mintAuthority: false,
    freezeAuthority: false,
    lpLocked: true,
    source: "example",
  },
];

interface DiscoverOpts {
  fetchImpl?: typeof fetch;
  heliusApiKey?: string;
  alchemyApiKey?: string;
  now?: number;
  bypassCache?: boolean;
}

let cache: { at: number; value: Discovery } | null = null;
const CACHE_MS = 45_000;

export function clearCandidateCache(): void {
  cache = null;
}

export async function discoverCandidates(opts: DiscoverOpts = {}): Promise<Discovery> {
  const now = opts.now ?? Date.now();
  if (process.env.NODE_TEST_CONTEXT && !opts.fetchImpl) {
    return {
      candidates: EXAMPLE_CANDIDATES,
      feed: "example",
      notes: ["Example tape."],
    };
  }
  if (!opts.bypassCache && cache && now - cache.at < CACHE_MS) {
    return cache.value;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const notes: string[] = [];
  try {
    const profiles = await fetchJson(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      fetchImpl,
    );
    const picked = pickProfiles(profiles).slice(0, 3);
    if (picked.length === 0) throw new Error("empty profile feed");

    const candidates: Candidate[] = [];
    for (const profile of picked) {
      const pair = await loadBestPair(profile, fetchImpl);
      let candidate = profileToCandidate(profile, pair);
      if (opts.heliusApiKey && candidate.chain === "solana") {
        const enriched = await enrichHelius(candidate, opts.heliusApiKey, fetchImpl);
        if (enriched) {
          candidate = enriched;
          notes.push("Helius mint/freeze check");
        }
      }
      if (
        opts.alchemyApiKey &&
        (candidate.chain === "base" || candidate.chain === "ethereum")
      ) {
        const enriched = await enrichAlchemy(candidate, opts.alchemyApiKey, fetchImpl);
        if (enriched) {
          candidate = enriched;
          notes.push("Alchemy bytecode check");
        }
      }
      candidates.push(candidate);
    }

    const value: Discovery = {
      candidates,
      feed: "market",
      notes: unique(notes),
    };
    cache = { at: now, value };
    return value;
  } catch {
    const value: Discovery = {
      candidates: EXAMPLE_CANDIDATES,
      feed: "example",
      notes: ["Example tape — drills, not live pools. Market feed was unavailable."],
    };
    if (!opts.bypassCache) cache = { at: now, value };
    return value;
  }
}

export function findCandidate(
  symbol: string | null,
  lists: Candidate[][],
): Candidate | null {
  if (!symbol) return null;
  const want = symbol.toUpperCase();
  for (const list of lists) {
    const hit = list.find((c) => c.symbol.toUpperCase() === want);
    if (hit) return hit;
  }
  return null;
}

interface ProfileRow {
  chainId?: string;
  tokenAddress?: string;
  description?: string;
}

interface PairRow {
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
}

function pickProfiles(payload: unknown): ProfileRow[] {
  if (!Array.isArray(payload)) return [];
  const out: ProfileRow[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const rec = row as ProfileRow;
    const chain = rec.chainId?.toLowerCase();
    if (chain !== "solana" && chain !== "base" && chain !== "ethereum") continue;
    if (!rec.tokenAddress) continue;
    out.push(rec);
  }
  return out;
}

async function loadBestPair(
  profile: ProfileRow,
  fetchImpl: typeof fetch,
): Promise<PairRow | null> {
  const chain = profile.chainId ?? "solana";
  const url = `https://api.dexscreener.com/tokens/v1/${chain}/${profile.tokenAddress}`;
  try {
    const payload = await fetchJson(url, fetchImpl);
    const rows = Array.isArray(payload) ? (payload as PairRow[]) : [];
    let best: PairRow | null = null;
    let bestLiq = -1;
    for (const row of rows) {
      const liq = row.liquidity?.usd ?? 0;
      if (liq >= bestLiq) {
        best = row;
        bestLiq = liq;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function profileToCandidate(profile: ProfileRow, pair: PairRow | null): Candidate {
  const chain = (profile.chainId?.toLowerCase() ?? "solana") as CandidateChain;
  const address = profile.tokenAddress ?? "";
  const symbol = (pair?.baseToken?.symbol || shortSymbol(address)).toUpperCase();
  const name = pair?.baseToken?.name || symbol;
  const ageMin =
    pair?.pairCreatedAt != null
      ? Math.max(0, Math.round((Date.now() - pair.pairCreatedAt) / 60000))
      : null;
  return {
    id: `${chain}:${address}`.slice(0, 80),
    symbol: symbol.replace(/[^A-Z0-9]/g, "").slice(0, 15) || "TOKEN",
    name,
    chain,
    address,
    liqUsd: pair?.liquidity?.usd ?? null,
    ageMin,
    taxPct: null,
    honeypot: null,
    mintAuthority: null,
    freezeAuthority: null,
    lpLocked: null,
    source: "market",
  };
}

async function enrichHelius(
  candidate: Candidate,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<Candidate | null> {
  try {
    const payload = await fetchJson(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
      fetchImpl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "shield",
          method: "getAsset",
          params: { id: candidate.address },
        }),
      },
    );
    const result = (payload as { result?: { token_info?: Record<string, unknown> } })
      .result;
    const info = result?.token_info;
    if (!info) return null;
    return {
      ...candidate,
      mintAuthority: authorityPresent(info.mint_authority),
      freezeAuthority: authorityPresent(info.freeze_authority),
    };
  } catch {
    return null;
  }
}

async function enrichAlchemy(
  candidate: Candidate,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<Candidate | null> {
  const host =
    candidate.chain === "base"
      ? "base-mainnet.g.alchemy.com"
      : "eth-mainnet.g.alchemy.com";
  try {
    const payload = await fetchJson(
      `https://${host}/v2/${encodeURIComponent(apiKey)}`,
      fetchImpl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "shield",
          method: "eth_getCode",
          params: [candidate.address, "latest"],
        }),
      },
    );
    const code = (payload as { result?: string }).result;
    if (typeof code !== "string") return null;
    const hasCode = code !== "0x" && code !== "0x0";
    return {
      ...candidate,
      honeypot: hasCode ? candidate.honeypot : true,
    };
  } catch {
    return null;
  }
}

function authorityPresent(value: unknown): boolean | null {
  if (value == null || value === "") return false;
  return true;
}

function shortSymbol(address: string): string {
  const tail = address.replace(/[^A-Za-z0-9]/g, "").slice(-4);
  return `MKT${tail}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "BigBrainApeBot/0.1",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
