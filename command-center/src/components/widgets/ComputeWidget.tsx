import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import type { WidgetRenderProps } from '@/registry/types';

interface ComputeData {
  limit: number;
  remaining: number;
  totalUsage: number;
  updated: string;
}

type Phase = 'loading' | 'live' | 'err';
type RefreshLight = 'idle' | 'ok' | 'fail';

/**
 * Fetches the agent's Virtuals compute balance from the API endpoint.
 * The endpoint runs `acp compute status` server-side and returns JSON.
 * Falls back to the static JSON file in the dashboard repo (updated by cron).
 */
async function fetchCompute(): Promise<ComputeData> {
  // Try the Vercel API endpoint first (live data)
  try {
    const res = await fetch('/api/compute-status?t=' + Date.now());
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json.remaining === 'number') {
        return json;
      }
    }
  } catch {
    // fall through to static file
  }

  // Fallback: static JSON file updated by the trading cron job
  const base = import.meta.env.BASE_URL || '/';
  const res2 = await fetch(base + 'compute-balance.json?t=' + Date.now());
  if (!res2.ok) throw new Error('Could not reach compute status endpoint.');
  const data = await res2.json();
  if (!data || typeof data.remaining !== 'number') {
    throw new Error('Invalid compute balance data.');
  }
  return data;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ComputeWidget({ widget }: WidgetRenderProps) {
  const [data, setData] = useState<ComputeData | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [light, setLight] = useState<RefreshLight>('idle');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const d = await fetchCompute();
      setData(d);
      setPhase('live');
      setLight('ok');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compute balance.');
      setPhase('err');
      setLight('fail');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remaining = data?.remaining ?? 0;
  const limit = data?.limit ?? 0;
  const usage = data?.totalUsage ?? 0;
  const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
  const barColor = pct > 50 ? '#3fb950' : pct > 20 ? '#d29922' : '#f85149';
  const barWidth = Math.max(pct, 2); // min 2% so it's visible

  const badge = phase === 'err' ? 'ERR' : phase === 'live' ? 'LIVE' : 'SYNC';

  return (
    <WidgetFrame widget={widget} title="Compute" badge={badge}>
      <div className="space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-300" />
            <span className="text-xs uppercase tracking-widest text-white/55">
              Virtuals Balance
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              data-refresh-light={light}
              aria-label={
                light === 'ok'
                  ? 'Refresh succeeded'
                  : light === 'fail'
                    ? 'Refresh failed'
                    : 'Refresh has not finished'
              }
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                light === 'ok' && 'bg-emerald-400 shadow-[0_0_10px_#34d399]',
                light === 'fail' && 'bg-rose-500 shadow-[0_0_10px_#fb7185]',
                light === 'idle' && 'bg-white/25',
              )}
            />
            <button
              type="button"
              className="widget-no-drag rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white/70 hover:bg-white/10 disabled:opacity-40"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="Refresh compute balance"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Error state */}
        {phase === 'err' ? (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-4 text-center">
            <p className="text-sm text-rose-300">{error ?? 'Could not load compute balance.'}</p>
            <p className="mt-1 text-xs text-white/40">Tap refresh to retry.</p>
          </div>
        ) : phase === 'loading' ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-white/40" />
          </div>
        ) : (
          <>
            {/* Big remaining number */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-white/45">Remaining</span>
              <span
                className="font-mono text-2xl font-bold tabular-nums"
                style={{ color: barColor }}
              >
                {formatUsd(remaining)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${barWidth}%`, backgroundColor: barColor }}
              />
            </div>

            {/* Stats row */}
            <div className="flex justify-between text-xs text-white/45">
              <span>Limit: {formatUsd(limit)}</span>
              <span>Total Used: {formatUsd(usage)}</span>
            </div>

            {/* Updated timestamp */}
            {data?.updated ? (
              <p className="text-right font-mono text-[10px] uppercase tracking-widest text-white/30">
                Updated: {data.updated}
              </p>
            ) : null}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
