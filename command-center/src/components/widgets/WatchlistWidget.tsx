import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { getMarketAdapter } from '@/adapters/market';
import type { MarketQuote } from '@/adapters/market';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import type { WidgetRenderProps } from '@/registry/types';
import { useWatchlistStore, type WatchItem } from '@/store/watchlistStore';

const REFRESH_MS = 60_000;

/** Session-only. Never written to localStorage, so a reload cannot show stale numbers as live. */
const quoteCache = new Map<string, MarketQuote>();
/** Shared across mounts so a slow response cannot overwrite a newer quote. */
let quoteEpoch = 0;

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) {
    const digits = abs < 1e-6 ? 2 : 4;
    return `$${value.toLocaleString('en-US', { maximumSignificantDigits: digits, useGrouping: false })}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 1 ? 2 : 4,
  }).format(value);
}

function formatChange(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  if (Math.abs(pct) < 0.005) return '0.00%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatAsOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function cachedQuotes(items: WatchItem[]): Record<string, MarketQuote> {
  const next: Record<string, MarketQuote> = {};
  for (const item of items) {
    const hit = quoteCache.get(item.coinId);
    if (hit) next[item.coinId] = hit;
  }
  return next;
}

function oldestStamp(quotes: Record<string, MarketQuote>): number | null {
  let oldest: number | null = null;
  for (const quote of Object.values(quotes)) {
    if (quote.updatedAt == null) continue;
    if (oldest == null || quote.updatedAt < oldest) oldest = quote.updatedAt;
  }
  return oldest;
}

type Phase = 'loading' | 'live' | 'err';

export function WatchlistWidget({ widget }: WidgetRenderProps) {
  const items = useWatchlistStore((s) => s.items);
  const add = useWatchlistStore((s) => s.add);
  const remove = useWatchlistStore((s) => s.remove);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>(() => cachedQuotes(items));
  const [phase, setPhase] = useState<Phase>(Object.keys(cachedQuotes(items)).length > 0 ? 'live' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [gap, setGap] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const applyQuotes = useCallback((symbols: WatchItem[], list: MarketQuote[]) => {
    const returned = new Set(list.map((quote) => quote.coinId));
    for (const item of symbols) {
      if (!returned.has(item.coinId)) quoteCache.delete(item.coinId);
    }
    for (const quote of list) quoteCache.set(quote.coinId, quote);
    const next = cachedQuotes(symbols);
    setQuotes(next);
    const missing = symbols.filter((item) => !list.some((quote) => quote.coinId === item.coinId));
    if (list.length === 0) {
      setGap(null);
      setError('CoinGecko returned no USD prices for this watchlist.');
      setPhase('err');
      return;
    }
    setError(null);
    setGap(missing.length > 0 ? `No USD price from CoinGecko for ${missing.map((item) => item.ticker).join(', ')}.` : null);
    setPhase('live');
  }, []);

  const refresh = useCallback(async () => {
    const symbols = useWatchlistStore.getState().items;
    const epoch = ++quoteEpoch;
    if (symbols.length === 0) {
      setQuotes({});
      setError(null);
      setGap(null);
      setRefreshing(false);
      setPhase('live');
      return;
    }
    setRefreshing(true);
    try {
      const list = await getMarketAdapter().fetchQuotes(
        symbols.map((item) => ({ coinId: item.coinId, symbol: item.ticker, name: item.name })),
      );
      if (epoch !== quoteEpoch) return;
      applyQuotes(symbols, list);
    } catch (err) {
      if (epoch !== quoteEpoch) return;
      setQuotes(cachedQuotes(symbols));
      setGap(null);
      setError(err instanceof Error ? err.message : 'CoinGecko quote fetch failed.');
      setPhase('err');
    } finally {
      if (epoch === quoteEpoch) setRefreshing(false);
    }
  }, [applyQuotes]);

  const coinKey = items.map((item) => item.coinId).join(',');

  useEffect(() => {
    const symbols = useWatchlistStore.getState().items;
    if (symbols.length === 0) {
      void refresh();
      return;
    }
    const needsFetch = symbols.some((item) => !quoteCache.has(item.coinId));
    if (needsFetch) {
      void refresh();
    } else {
      setQuotes(cachedQuotes(symbols));
      setGap(null);
    }
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [coinKey, refresh]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const ticker = draft.trim();
    if (!ticker || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const coin = await getMarketAdapter().resolveSymbol(ticker);
      const result = add(coin);
      if (result === 'duplicate') {
        setAddError(`${coin.symbol} is already on the watchlist.`);
      } else {
        setDraft('');
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not resolve that ticker.');
    } finally {
      setAdding(false);
    }
  }

  const badge = items.length === 0 ? 'EMPTY' : phase === 'err' ? 'ERR' : phase === 'live' ? 'LIVE' : 'SYNC';
  const asOf = oldestStamp(quotes);
  const keptLast = phase === 'err' && Object.keys(quotes).length > 0;

  return (
    <WidgetFrame
      widget={widget}
      title="Watchlist"
      badge={badge}
      footer={
        items.length > 0 ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            CoinGecko
            {asOf != null ? ` · as of ${formatAsOf(asOf)}` : ''}
            {keptLast ? ' · last good quotes kept' : ''}
          </p>
        ) : null
      }
    >
      <div className="mb-3 flex items-start gap-2">
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={onAdd}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add ticker"
            aria-label="Add ticker"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            className="hud-input min-w-0 flex-1 uppercase"
          />
          <button type="submit" className="hud-btn-primary px-3 disabled:opacity-50" disabled={adding || !draft.trim()}>
            {adding ? '…' : 'Add'}
          </button>
        </form>
        <button
          type="button"
          className="hud-btn-ghost widget-no-drag px-3 disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={refreshing || items.length === 0}
          aria-label="Refresh quotes"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </button>
      </div>

      {addError ? (
        <p className="mb-2 text-xs leading-relaxed text-rose-300" role="alert">
          {addError}
        </p>
      ) : null}
      {items.length > 0 && error ? (
        <p className="mb-2 text-xs leading-relaxed text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {items.length > 0 && gap ? <p className="mb-2 text-xs leading-relaxed text-amber-200/80">{gap}</p> : null}

      {items.length === 0 ? (
        <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-white/70">No symbols</p>
          <p className="text-sm leading-relaxed text-white/50">
            Add a ticker. USD price and 24h change load from CoinGecko. Nothing here is simulated.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const quote = quotes[item.coinId];
            const change = quote?.change24hPct ?? null;
            const changeClass =
              change == null
                ? 'text-white/35'
                : Math.abs(change) < 0.005
                  ? 'text-white/55'
                  : change > 0
                    ? 'text-emerald-300'
                    : 'text-rose-300';
            return (
              <li key={item.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-sm tracking-[0.14em] text-white">{item.ticker}</span>
                    <span className="font-mono text-sm tabular-nums text-white">{quote ? formatUsd(quote.usd) : '—'}</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs text-white/45">{item.name !== item.ticker ? item.name : ''}</span>
                    <span className={cn('font-mono text-xs tabular-nums', changeClass)}>
                      {quote ? formatChange(change) : '—'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="widget-no-drag grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/40 hover:bg-white/10 hover:text-white"
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.ticker}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}
