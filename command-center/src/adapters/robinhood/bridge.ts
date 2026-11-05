import { resolveChatApiBase } from '@/adapters/chat/bridge';
import { normalizeSnapshot, type RobinhoodSnapshot } from './snapshot';

/** Origin of the snapshot bridge. Unset follows the chat Space (vault → env → default). */
export function resolveRobinhoodApiBase(): string {
  const env = (import.meta.env.VITE_ROBINHOOD_API_BASE ?? '').trim().replace(/\/$/, '');
  if (env) return env;
  return resolveChatApiBase();
}

export function robinhoodSnapshotUrl(base = resolveRobinhoodApiBase(), cacheBust?: string | number): string {
  const path = /\/api\/robinhood$/.test(base) ? base : `${base}/api/robinhood`;
  if (cacheBust == null || cacheBust === '') return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}t=${encodeURIComponent(String(cacheBust))}`;
}

export function robinhoodRefreshUrl(base = resolveRobinhoodApiBase()): string {
  return `${robinhoodSnapshotUrl(base)}/refresh`;
}

export interface RobinhoodPoll {
  snapshot: RobinhoodSnapshot | null;
  refreshPending: boolean;
  refreshRequestedAt: string | null;
}

async function readError(res: Response): Promise<string> {
  if (res.status === 404) {
    return 'Snapshot bridge has no /api/robinhood route yet. Update the chat Space, then retry.';
  }
  const raw = await res.text().catch(() => '');
  try {
    const parsed = raw ? (JSON.parse(raw) as { error?: string; detail?: unknown }) : {};
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail;
  } catch {
    /* not json */
  }
  return raw.slice(0, 240) || `Snapshot bridge HTTP ${res.status}`;
}

export async function fetchRobinhoodSnapshot(
  url = robinhoodSnapshotUrl(resolveRobinhoodApiBase(), Date.now()),
): Promise<RobinhoodPoll> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the snapshot bridge. Check the chat Space URL.');
  }
  if (!res.ok) throw new Error(await readError(res));
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Snapshot bridge returned an unreadable response.');
  }
  if (!data || typeof data !== 'object') {
    return { snapshot: null, refreshPending: false, refreshRequestedAt: null };
  }
  const row = data as { snapshot?: unknown; refreshPending?: unknown; refreshRequestedAt?: unknown };
  const refreshPending = row.refreshPending === true;
  const refreshRequestedAt =
    typeof row.refreshRequestedAt === 'string' && row.refreshRequestedAt.trim()
      ? row.refreshRequestedAt.trim()
      : null;
  if (row.snapshot == null) return { snapshot: null, refreshPending, refreshRequestedAt };
  const normalized = normalizeSnapshot(row.snapshot);
  if (!normalized) throw new Error('Snapshot bridge returned an unreadable portfolio.');
  return { snapshot: normalized, refreshPending, refreshRequestedAt };
}

/** Ask the Space to store a pending refresh. Chief of Staff pulls Robinhood and pushes a snapshot. */
export async function requestRobinhoodRefresh(url = robinhoodRefreshUrl()): Promise<{ requestedAt: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    throw new Error('Could not reach the snapshot bridge. Check the chat Space URL.');
  }
  if (res.status === 404) {
    throw new Error('Snapshot bridge has no /api/robinhood/refresh route yet. Update the chat Space, then retry.');
  }
  if (!res.ok) throw new Error(await readError(res));
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Snapshot bridge returned an unreadable response.');
  }
  const requestedAt =
    data && typeof data === 'object' && typeof (data as { requestedAt?: unknown }).requestedAt === 'string'
      ? (data as { requestedAt: string }).requestedAt.trim()
      : '';
  if (!requestedAt) throw new Error('Refresh request was not stored.');
  return { requestedAt };
}
