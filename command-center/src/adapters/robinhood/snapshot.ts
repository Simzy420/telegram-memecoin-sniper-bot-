export interface RobinhoodAccount {
  label: string;
  last4: string;
}

export interface RobinhoodPosition {
  symbol: string;
  quantity: number;
  avgCost: number | null;
  price: number | null;
  marketValue: number | null;
  dayChangePct: number | null;
}

export interface RobinhoodSnapshot {
  updatedAt: string;
  account: RobinhoodAccount;
  totalValue: number | null;
  equityValue: number | null;
  cryptoValue: number | null;
  cash: number | null;
  currency: string;
  positions: RobinhoodPosition[];
}

export const ROBINHOOD_POLL_MS = 30_000;
export const ROBINHOOD_STALE_MS = 10 * 60 * 1000;
/** How often the phone re-reads the Space while a manual refresh is open. */
export const ROBINHOOD_REFRESH_POLL_MS = 2_000;
/** Stop waiting for Chief of Staff and surface an error after this long. */
export const ROBINHOOD_REFRESH_TIMEOUT_MS = 45_000;
export const ROBINHOOD_REFRESH_WAIT_MESSAGE =
  'Waiting for Chief of Staff sync — try again in a moment.';

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,15}$/;

function finite(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function accountLabel(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || /^[\d\s-]+$/.test(text) || text.toLowerCase() === 'individual') return 'Individual';
  return text.slice(0, 40);
}

/** Digits only, last four. Full account numbers never stay on the client. */
export function maskLast4(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.slice(-4);
}

export function normalizeSnapshot(raw: unknown): RobinhoodSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt.trim() : '';
  if (!updatedAt) return null;
  const accountRaw =
    row.account && typeof row.account === 'object' ? (row.account as Record<string, unknown>) : {};
  const currencyRaw = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'USD';
  const positions: RobinhoodPosition[] = [];
  if (Array.isArray(row.positions)) {
    for (const item of row.positions) {
      if (!item || typeof item !== 'object') continue;
      const pos = item as Record<string, unknown>;
      const symbol = String(pos.symbol ?? '')
        .replace(/\s+/g, '')
        .toUpperCase();
      const quantity = finite(pos.quantity);
      if (!SYMBOL_RE.test(symbol) || quantity == null) continue;
      positions.push({
        symbol,
        quantity,
        avgCost: finite(pos.avgCost),
        price: finite(pos.price),
        marketValue: finite(pos.marketValue),
        dayChangePct: finite(pos.dayChangePct),
      });
    }
  }
  return {
    updatedAt,
    account: {
      label: accountLabel(accountRaw.label),
      last4: maskLast4(accountRaw.last4),
    },
    totalValue: finite(row.totalValue),
    equityValue: finite(row.equityValue),
    cryptoValue: finite(row.cryptoValue),
    cash: finite(row.cash),
    currency,
    positions,
  };
}

/**
 * Manual refresh succeeds when the snapshot moved past the one on screen.
 * With nothing on screen yet, it has to be newer than the refresh request.
 */
export function snapshotIsFresher(
  updatedAt: string | null | undefined,
  previousUpdatedAt: string | null | undefined,
  requestedAt: string | null | undefined,
): boolean {
  if (!updatedAt) return false;
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return false;
  const previous = previousUpdatedAt ? Date.parse(previousUpdatedAt) : Number.NaN;
  if (Number.isFinite(previous)) return updated > previous;
  const requested = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  if (Number.isFinite(requested)) return updated > requested;
  return false;
}

/** A zero price or market value means the snapshot did not include a quote. */
export function livePrice(position: RobinhoodPosition): number | null {
  if (position.price == null || position.price === 0) return null;
  return position.price;
}

export function liveMarketValue(position: RobinhoodPosition): number | null {
  if (position.marketValue == null || position.marketValue === 0) return null;
  return position.marketValue;
}

export function formatMoney(value: number | null, currency = 'USD'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function formatChangePct(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.005) return '0.00%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatSnapshotAge(
  updatedAt: string,
  now = Date.now(),
): { label: string; stale: boolean } | null {
  const stamp = Date.parse(updatedAt);
  if (!Number.isFinite(stamp)) return null;
  const delta = Math.max(0, now - stamp);
  const stale = delta >= ROBINHOOD_STALE_MS;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return { label: 'Updated just now', stale };
  if (mins < 60) return { label: `Updated ${mins}m ago`, stale };
  const hours = Math.floor(mins / 60);
  if (hours < 48) return { label: `Updated ${hours}h ago`, stale: true };
  const days = Math.floor(hours / 24);
  return { label: `Updated ${days}d ago`, stale: true };
}
