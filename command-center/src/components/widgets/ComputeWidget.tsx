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

/** The daily trading cron commits the balance here. Reading it from GitHub
 *  means refresh gets the newest number on both GitHub Pages and Vercel,
 *  without waiting for a redeploy of either site. */
const LATEST_BALANCE_URL =
  'https://raw.githubusercontent.com/Simzy420/command-center/main/public/compute-balance.json';

function isComputeData(json: unknown): json is ComputeData {
  return !!json && typeof (json as ComputeData).remaining === 'number';
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches the agent's Virtuals compute balance.
 * First the latest copy in the repo (updated by the cron job), then the copy
 * bundled with this deploy if GitHub can't be reached.
 */
async function fetchCompute(): Promise<ComputeData> {
  try {
    const json = await fetchJson(LATEST_BALANCE_URL + '?t=' + Date.now());
    if (isComputeData(json)) return json;
  } catch {
    // fall through to the bundled file
  }

  const base = import.meta.env.BASE_URL || '/';
  let data: unknown;
  try {
    data = await fetchJson(base + 'compute-balance.json?t=' + Date.now());
  } catch {
    throw new Error('Could not reach compute balance.');
  }
  if (!isComputeData(data)) throw new Error('Invalid compute balance data.');
  return data;
}

interface RunpodData { balance: number; spendPerHr: number; hoursLeft: number | null; updated: string; }
const RUNPOD_URL = 'https://raw.githubusercontent.com/Simzy420/command-center/main/public/runpod-balance.json';
async function fetchRunpod(): Promise<RunpodData | null> {
  try {
    const j = (await fetchJson(RUNPOD_URL + '?t=' + Date.now())) as RunpodData;
    return typeof j?.balance === 'number' ? j : null;
  } catch { return null; }
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
  const [rp, setRp] = useState<RunpodData | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    void fetchRunpod().then(setRp);
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

        {/* RunPod balance */}
        <div className="space-y-2 border-t border-white/10 pt-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-300" />
            <span className="text-xs uppercase tracking-widest text-white/55">RunPod Balance</span>
          </div>
          {rp ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-white/45">Credit</span>
                <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: rp.balance > 10 ? '#3fb950' : rp.balance > 3 ? '#d29922' : '#f85149' }}>
                  {formatUsd(rp.balance)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-white/45">
                <span>Spend: {formatUsd(rp.spendPerHr)}/hr</span>
                <span>{rp.hoursLeft != null ? `~${rp.hoursLeft} hrs left` : 'Idle'}</span>
              </div>
              <p className="text-right font-mono text-[10px] uppercase tracking-widest text-white/30">Updated: {rp.updated}</p>
            </>
          ) : (
            <p className="text-xs text-white/40">RunPod balance unavailable — tap refresh.</p>
          )}
        </div>
      </div>
    </WidgetFrame>
  );
}
