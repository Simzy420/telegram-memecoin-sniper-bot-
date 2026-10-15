import type { LayoutDocument } from '@/types/layout';

export const ACCOUNTS_UNAVAILABLE =
  "Sign-in is available on the Vercel site. This page stays on Casey's board.";

export interface AccountSession {
  username: string;
  layout: LayoutDocument | null;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error(ACCOUNTS_UNAVAILABLE);
  return data as Record<string, unknown>;
}

function sessionFrom(record: Record<string, unknown>): AccountSession {
  const user = record.user;
  const username = user && typeof user === 'object' && typeof (user as { username?: unknown }).username === 'string'
    ? (user as { username: string }).username
    : '';
  const layout = record.layout && typeof record.layout === 'object' ? (record.layout as LayoutDocument) : null;
  return { username, layout };
}

async function request(init?: RequestInit): Promise<AccountSession> {
  let response: Response;
  try {
    response = await fetch('/api/accounts', {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(ACCOUNTS_UNAVAILABLE);
  }
  const record = await readResponse(response);
  if (!response.ok || record.ok === false) {
    const message = typeof record.error === 'string' && record.error.trim() ? record.error : 'Could not open that profile.';
    throw new Error(message);
  }
  return sessionFrom(record);
}

export function loadAccountSession(): Promise<AccountSession> {
  return request({ method: 'GET', headers: { Accept: 'application/json' } });
}

export function registerAccount(username: string, password: string): Promise<AccountSession> {
  return request({
    method: 'POST',
    body: JSON.stringify({ action: 'register', username, password }),
  });
}

export function loginAccount(username: string, password: string): Promise<AccountSession> {
  return request({
    method: 'POST',
    body: JSON.stringify({ action: 'login', username, password }),
  });
}

export function logoutAccount(): Promise<AccountSession> {
  return request({ method: 'POST', body: JSON.stringify({ action: 'logout' }) });
}

export function saveAccountLayout(layout: LayoutDocument): Promise<AccountSession> {
  return request({ method: 'POST', body: JSON.stringify({ action: 'save', layout }) });
}
