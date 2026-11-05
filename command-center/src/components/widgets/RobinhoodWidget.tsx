import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchRobinhoodSnapshot, requestRobinhoodRefresh } from '@/adapters/robinhood/bridge';
import {
  ROBINHOOD_POLL_MS,
  ROBINHOOD_REFRESH_POLL_MS,
  ROBINHOOD_REFRESH_TIMEOUT_MS,
  ROBINHOOD_REFRESH_WAIT_MESSAGE,
  formatChangePct,
  formatMoney,
  formatQty,
  formatSnapshotAge,
  liveMarketValue,
  livePrice,
  snapshotIsFresher,
  type RobinhoodPosition,
  type RobinhoodSnapshot,
} from '@/adapters/robinhood/snapshot';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import type { WidgetRenderProps } from '@/registry/types';

type Load =
  | { kind: 'wait' }
  | { kind: 'ready'; snapshot: RobinhoodSnapshot | null; error: string | null };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <button
      type="button"
      className="hud-btn-ghost widget-no-drag h-11 w-11 shrink-0 px-0 disabled:opacity-50"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="Refresh brokerage snapshot"
    >
      <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
    </button>
  );
}

function changeClass(pct: number | null): string {
  if (pct == null) return 'text-white/35';
  if (Math.abs(pct) < 0.005) return 'text-white/55';
  return pct > 0 ? 'text-emerald-300' : 'text-rose-300';
}

function Stat({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className={cn('mt-0.5 font-mono text-sm tabular-nums', negative ? 'text-rose-300' : 'text-white')}>{value}</p>
    </div>
  );
}

function PositionRow({ position, currency }: { position: RobinhoodPosition; currency: string }) {
  const price = livePrice(position);
  const value = liveMarketValue(position);
  const change = formatChangePct(position.dayChangePct);
  const avg = position.avgCost != null ? `avg ${formatMoney(position.avgCost, currency)}` : null;
  const meta = [`${formatQty(position.quantity)} sh`, avg].filter((part) => part != null).join(' · ');
  return (
    <li className="rounded-xl bg-white/5 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-sm tracking-[0.14em] text-white">{position.symbol}</span>
        <span className="font-mono text-sm tabular-nums text-white">
          {value != null ? formatMoney(value, currency) : '—'}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-white/45">{meta}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-white/70">
          {price != null ? formatMoney(price, currency) : '—'}
          {change != null ? <span className={cn('ml-2', changeClass(position.dayChangePct))}>{change}</span> : null}
        </span>
      </div>
    </li>
  );
}

function Portfolio({
  snapshot,
  refreshing,
  onRefresh,
}: {
  snapshot: RobinhoodSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { currency } = snapshot;
  const last4 = snapshot.account.last4;
  const stats = [
    snapshot.equityValue != null
      ? { key: 'equity', label: 'Equity', value: snapshot.equityValue }
      : null,
    snapshot.cash != null ? { key: 'cash', label: 'Cash', value: snapshot.cash } : null,
  ].filter((stat) => stat != null);

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200/70">Account value</p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
            {formatMoney(snapshot.totalValue, currency)}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {snapshot.account.label}
            {last4 ? <span className="font-mono text-white/50"> · ••••{last4}</span> : null}
          </p>
        </div>
        <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      {stats.length > 0 ? (
        <div className={cn('mt-3 grid gap-2', stats.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {stats.map((stat) => (
            <Stat key={stat.key} label={stat.label} value={formatMoney(stat.value, currency)} negative={stat.value < 0} />
          ))}
        </div>
      ) : null}
      {snapshot.cryptoValue != null ? (
        <p className="mt-2 font-mono text-xs tabular-nums text-white/55">
          Crypto {formatMoney(snapshot.cryptoValue, currency)}
        </p>
      ) : null}
      <h4 className="mb-2 mt-4 font-display text-[11px] uppercase tracking-[0.18em] text-amber-200/80">
        Stocks{snapshot.positions.length > 0 ? ` · ${snapshot.positions.length}` : ''}
      </h4>
      {snapshot.positions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-3 py-6 text-center text-sm text-white/50">
          No equity positions in this snapshot.
        </p>
      ) : (
        <ul className="space-y-2">
          {snapshot.positions.map((position, index) => (
            <PositionRow key={`${position.symbol}-${index}`} position={position} currency={currency} />
          ))}
        </ul>
      )}
    </>
  );
}

// Refresh stores a pending request on the chat Space, then polls until Chief of Staff
// pushes a newer snapshot. CoS must watch `refreshPending` on GET /api/robinhood and POST
// the snapshot. This phone never talks to Robinhood. The 30s timer only re-reads the Space.
export function RobinhoodWidget({ widget }: WidgetRenderProps) {
  const [load, setLoad] = useState<Load>({ kind: 'wait' });
  const [refreshing, setRefreshing] = useState(false);
  const [awaitingSync, setAwaitingSync] = useState(false);
  const epoch = useRef(0);
  const awaiting = useRef(false);
  const shownUpdatedAt = useRef<string | null>(null);
  const snapshot = load.kind === 'ready' ? load.snapshot : null;
  const error = load.kind === 'ready' ? load.error : null;
  const age = snapshot ? formatSnapshotAge(snapshot.updatedAt) : null;

  const loadOnce = useCallback(async () => {
    if (awaiting.current) return;
    const ticket = ++epoch.current;
    setRefreshing(true);
    try {
      const next = await fetchRobinhoodSnapshot();
      if (ticket !== epoch.current || awaiting.current) return;
      shownUpdatedAt.current = next.snapshot?.updatedAt ?? null;
      setLoad((prev) => {
        const previousStamp = prev.kind === 'ready' ? (prev.snapshot?.updatedAt ?? null) : null;
        const nextStamp = next.snapshot?.updatedAt ?? null;
        const keepWait =
          prev.kind === 'ready' && prev.error === ROBINHOOD_REFRESH_WAIT_MESSAGE && previousStamp === nextStamp;
        return {
          kind: 'ready',
          snapshot: next.snapshot,
          error: keepWait ? ROBINHOOD_REFRESH_WAIT_MESSAGE : null,
        };
      });
    } catch (err) {
      if (ticket !== epoch.current || awaiting.current) return;
      const message = err instanceof Error ? err.message : 'Snapshot fetch failed.';
      setLoad((prev) => ({
        kind: 'ready',
        snapshot: prev.kind === 'ready' ? prev.snapshot : null,
        error: message,
      }));
    } finally {
      if (ticket === epoch.current && !awaiting.current) setRefreshing(false);
    }
  }, []);

  const requestLive = useCallback(async () => {
    if (awaiting.current) return;
    const ticket = ++epoch.current;
    const previousUpdatedAt = shownUpdatedAt.current;
    awaiting.current = true;
    setRefreshing(true);
    setAwaitingSync(true);
    setLoad((prev) =>
      prev.kind === 'ready' ? { kind: 'ready', snapshot: prev.snapshot, error: null } : { kind: 'wait' },
    );
    try {
      const asked = await requestRobinhoodRefresh();
      if (ticket !== epoch.current) return;
      const deadline = Date.now() + ROBINHOOD_REFRESH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (ticket !== epoch.current) return;
        try {
          const next = await fetchRobinhoodSnapshot();
          if (ticket !== epoch.current) return;
          if (snapshotIsFresher(next.snapshot?.updatedAt, previousUpdatedAt, asked.requestedAt)) {
            shownUpdatedAt.current = next.snapshot?.updatedAt ?? null;
            setLoad({ kind: 'ready', snapshot: next.snapshot, error: null });
            return;
          }
        } catch {
          // A missed poll is not fatal. Keep waiting for Chief of Staff until the timeout.
        }
        const wait = Math.min(ROBINHOOD_REFRESH_POLL_MS, deadline - Date.now());
        if (wait <= 0) break;
        await delay(wait);
      }
      if (ticket !== epoch.current) return;
      setLoad((prev) => ({
        kind: 'ready',
        snapshot: prev.kind === 'ready' ? prev.snapshot : null,
        error: ROBINHOOD_REFRESH_WAIT_MESSAGE,
      }));
    } catch (err) {
      if (ticket !== epoch.current) return;
      const message = err instanceof Error ? err.message : 'Snapshot refresh failed.';
      setLoad((prev) => ({
        kind: 'ready',
        snapshot: prev.kind === 'ready' ? prev.snapshot : null,
        error: message,
      }));
    } finally {
      if (ticket === epoch.current) {
        awaiting.current = false;
        setAwaitingSync(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadOnce();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadOnce();
    }, ROBINHOOD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadOnce();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      epoch.current += 1;
      awaiting.current = false;
    };
  }, [loadOnce]);

  const badge = awaitingSync
    ? 'WAIT'
    : !snapshot
      ? error
        ? 'ERR'
        : 'WAIT'
      : error
        ? 'ERR'
        : age?.stale
          ? 'STALE'
          : 'LIVE';
  const footer = awaitingSync
    ? 'Waiting for Chief of Staff sync…'
    : snapshot
      ? `${age?.label ?? 'Updated time unknown'}${error ? ' · last snapshot kept' : ''}`
      : error
        ? 'Sync failed'
        : 'Waiting for first sync…';

  return (
    <WidgetFrame
      widget={widget}
      title="Robinhood"
      badge={badge}
      footer={<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">{footer}</p>}
    >
      {error ? (
        <div className="mb-3 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2" role="alert">
          <p className="text-sm leading-relaxed text-rose-100">{error}</p>
          <button
            type="button"
            className="hud-btn-ghost widget-no-drag mt-2 w-full"
            onClick={() => void requestLive()}
            disabled={refreshing}
          >
            Retry
          </button>
        </div>
      ) : null}
      {snapshot ? (
        <Portfolio snapshot={snapshot} refreshing={refreshing} onRefresh={() => void requestLive()} />
      ) : (
        <div className="flex min-h-[8rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center">
          {error ? null : (
            <p className="font-display text-sm uppercase tracking-[0.2em] text-white/70">Waiting for first sync…</p>
          )}
          <p className="text-sm leading-relaxed text-white/50">
            Chief of Staff pushes the individual brokerage snapshot. This phone never logs in to Robinhood.
          </p>
          {error ? null : <RefreshButton refreshing={refreshing} onRefresh={() => void requestLive()} />}
        </div>
      )}
    </WidgetFrame>
  );
}
