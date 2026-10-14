import { create } from 'zustand';
import type { ResolvedCoin } from '@/adapters/market/types';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';

export interface WatchItem {
  id: string;
  ticker: string;
  coinId: string;
  name: string;
}

/** Used only when `cc.v1.watchlist` has never been saved. HYPE is CoinGecko `hyperliquid`. */
export const DEFAULT_WATCHLIST: WatchItem[] = [
  { id: 'wl_btc', ticker: 'BTC', coinId: 'bitcoin', name: 'Bitcoin' },
  { id: 'wl_eth', ticker: 'ETH', coinId: 'ethereum', name: 'Ethereum' },
  { id: 'wl_sol', ticker: 'SOL', coinId: 'solana', name: 'Solana' },
  { id: 'wl_hype', ticker: 'HYPE', coinId: 'hyperliquid', name: 'Hyperliquid' },
];

const KEY = 'watchlist';

function parseItem(row: unknown): WatchItem | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (typeof record.ticker !== 'string' || typeof record.coinId !== 'string') return null;
  const ticker = record.ticker.trim().toUpperCase();
  const coinId = record.coinId.trim();
  if (!ticker || !coinId) return null;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : ticker;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id : uid('wl');
  return { id, ticker, coinId, name };
}

function load(): WatchItem[] {
  const stored = readJson<unknown>(KEY, null);
  if (stored == null) return DEFAULT_WATCHLIST;
  if (!Array.isArray(stored)) return DEFAULT_WATCHLIST;
  const items = stored.map(parseItem).filter((item): item is WatchItem => item != null);
  if (stored.length > 0 && items.length === 0) return DEFAULT_WATCHLIST;
  return items;
}

function save(items: WatchItem[]) {
  writeJson(KEY, items);
}

interface WatchlistState {
  items: WatchItem[];
  add: (coin: ResolvedCoin) => 'added' | 'duplicate';
  remove: (id: string) => void;
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  items: load(),
  add: (coin) => {
    const ticker = coin.symbol.trim().toUpperCase();
    const coinId = coin.coinId.trim();
    const name = coin.name.trim() || ticker;
    if (!ticker || !coinId) return 'duplicate';
    if (get().items.some((item) => item.coinId === coinId)) return 'duplicate';
    const items = [...get().items, { id: uid('wl'), ticker, coinId, name }];
    save(items);
    set({ items });
    return 'added';
  },
  remove: (id) => {
    const items = get().items.filter((item) => item.id !== id);
    save(items);
    set({ items });
  },
}));
