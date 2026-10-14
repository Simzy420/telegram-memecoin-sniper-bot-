import type { MarketAdapter, MarketQuote, ResolvedCoin } from './types';

/** Public API. Sends Access-Control-Allow-Origin: * so GitHub Pages can call it. */
const PUBLIC_ROOT = 'https://api.coingecko.com/api/v3';

const ALIASES: Record<string, ResolvedCoin> = {
  btc: { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  xbt: { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  bitcoin: { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  eth: { coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  ethereum: { coinId: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  sol: { coinId: 'solana', symbol: 'SOL', name: 'Solana' },
  solana: { coinId: 'solana', symbol: 'SOL', name: 'Solana' },
  hype: { coinId: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid' },
  hyperliquid: { coinId: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid' },
};

interface SearchCoin {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  market_cap_rank?: unknown;
}

export function marketApiRoot(): string {
  const override = import.meta.env.VITE_MARKET_API_BASE?.trim();
  if (override) return override.replace(/\/$/, '');
  return PUBLIC_ROOT;
}

function normalizeInput(raw: string): string {
  return raw.trim().replace(/^\$/, '').toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `CoinGecko HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as {
      error?: unknown;
      status?: { error_message?: unknown };
    };
    const fromStatus = json.status?.error_message;
    const fromError = json.error;
    const detail = typeof fromStatus === 'string' ? fromStatus : typeof fromError === 'string' ? fromError : '';
    if (detail) return `CoinGecko HTTP ${res.status}: ${detail}`;
  } catch {
    /* body was not JSON */
  }
  return `CoinGecko HTTP ${res.status}: ${text.slice(0, 180)}`;
}

async function cgGet(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${marketApiRoot()}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('CoinGecko timed out.');
    }
    if (err instanceof TypeError) {
      throw new Error(`CoinGecko unreachable (${err.message}).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function pickSearchCoin(payload: unknown, query: string): ResolvedCoin | null {
  const root = asRecord(payload);
  const coins = root?.coins;
  if (!Array.isArray(coins)) return null;
  const rows = coins.filter((row): row is SearchCoin => !!row && typeof row === 'object');
  const symbolHits = rows.filter((row) => typeof row.symbol === 'string' && row.symbol.toLowerCase() === query);
  const idHits = rows.filter((row) => typeof row.id === 'string' && row.id.toLowerCase() === query);
  const pool = symbolHits.length > 0 ? symbolHits : idHits;
  const ranked = [...pool].sort((a, b) => {
    const ar = typeof a.market_cap_rank === 'number' ? a.market_cap_rank : Number.POSITIVE_INFINITY;
    const br = typeof b.market_cap_rank === 'number' ? b.market_cap_rank : Number.POSITIVE_INFINITY;
    return ar - br;
  });
  const best = ranked[0];
  if (!best || typeof best.id !== 'string' || typeof best.symbol !== 'string') return null;
  const name = typeof best.name === 'string' && best.name.trim() ? best.name.trim() : best.symbol.toUpperCase();
  return { coinId: best.id, symbol: best.symbol.toUpperCase(), name };
}

function parseQuotes(payload: unknown, coins: ResolvedCoin[]): MarketQuote[] {
  const root = asRecord(payload);
  if (!root) throw new Error('CoinGecko returned an unexpected price payload.');
  const byId = new Map(coins.map((coin) => [coin.coinId, coin]));
  const quotes: MarketQuote[] = [];
  for (const [coinId, coin] of byId) {
    const row = asRecord(root[coinId]);
    if (!row) continue;
    const usd = row.usd;
    if (typeof usd !== 'number' || !Number.isFinite(usd)) continue;
    const change = row.usd_24h_change;
    const updated = row.last_updated_at;
    quotes.push({
      coinId,
      symbol: coin.symbol,
      name: coin.name,
      usd,
      change24hPct: typeof change === 'number' && Number.isFinite(change) ? change : null,
      updatedAt: typeof updated === 'number' && Number.isFinite(updated) ? updated : null,
    });
  }
  return quotes;
}

export const coingeckoMarketAdapter: MarketAdapter = {
  id: 'coingecko',
  label: 'CoinGecko',
  async resolveSymbol(input: string): Promise<ResolvedCoin> {
    const key = normalizeInput(input);
    if (!key || !/^[a-z0-9-]{1,40}$/.test(key)) {
      throw new Error('Enter a ticker like BTC, ETH, SOL, or HYPE.');
    }
    const alias = ALIASES[key];
    if (alias) return alias;
    const payload = await cgGet(`/search?query=${encodeURIComponent(key)}`);
    const picked = pickSearchCoin(payload, key);
    if (!picked) throw new Error(`CoinGecko has no coin for ${key.toUpperCase()}.`);
    return picked;
  },
  async fetchQuotes(coins: ResolvedCoin[]): Promise<MarketQuote[]> {
    const unique: ResolvedCoin[] = [];
    const seen = new Set<string>();
    for (const coin of coins) {
      const coinId = coin.coinId.trim();
      if (!coinId || seen.has(coinId)) continue;
      seen.add(coinId);
      unique.push({ ...coin, coinId });
    }
    if (unique.length === 0) return [];
    const ids = unique.map((coin) => encodeURIComponent(coin.coinId)).join(',');
    const payload = await cgGet(
      `/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
    );
    return parseQuotes(payload, unique);
  },
};
