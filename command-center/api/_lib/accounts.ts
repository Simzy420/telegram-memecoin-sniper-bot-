import { DEFAULT_BOARDS, type LayoutDocument } from '../../src/types/layout.ts';

export const ACCOUNTS_UNAVAILABLE =
  "Sign-in is available on the Vercel site. This page stays on Casey's board.";

export interface AccountSession {
  username: string;
  layout: LayoutDocument | null;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://inlqueorerrsmfnaryzj.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

type HeaderValue = string | string[] | undefined;

interface AccountRequest {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
}

interface AccountResponse {
  statusCode?: number;
  headersSent?: boolean;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

const COOKIE_NAME = 'cc_account';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function header(req: AccountRequest, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function hostName(req: AccountRequest): string {
  return header(req, 'host') || 'localhost';
}

function readCookie(headerValue: string): string {
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

function sessionCookie(token: string, host: string, maxAge: number): string {
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  const secure = hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/api/accounts',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function send(res: AccountResponse, code: number, payload: Record<string, unknown>, cookie?: string): void {
  const body = JSON.stringify(payload);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(body);
}

async function readBody(req: AccountRequest): Promise<unknown> {
  if (typeof req.body === 'string') {
    if (req.body.length > 200_000) throw new Error('Request is too large.');
    return req.body ? JSON.parse(req.body) : {};
  }
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = req as AccountRequest & AsyncIterable<Buffer | string>;
  if (typeof stream[Symbol.asyncIterator] !== 'function') return {};
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > 200_000) throw new Error('Request is too large.');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send a JSON object.');
  return value as Record<string, unknown>;
}

// --- Supabase Auth helpers ---

async function supabaseSignUp(email: string, password: string): Promise<{ access_token?: string; user?: { id: string; email: string }; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    return { error: (data.error_code as string) || (data.msg as string) || 'Sign-up failed.' };
  }
  return {
    access_token: data.access_token as string,
    user: { id: data.id as string, email: data.email as string },
  };
}

async function supabaseSignIn(email: string, password: string): Promise<{ access_token?: string; user?: { id: string; email: string }; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    return { error: (data.error_code as string) || (data.msg as string) || 'Invalid login credentials.' };
  }
  return {
    access_token: data.access_token as string,
    user: { id: (data.user as Record<string, unknown>)?.id as string, email: (data.user as Record<string, unknown>)?.email as string },
  };
}

async function supabaseGetUser(token: string): Promise<{ id?: string; email?: string } | null> {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json() as Record<string, unknown>;
  return { id: data.id as string, email: data.email as string };
}

// --- Layout storage via Supabase (using user_metadata or a simple table) ---

async function getUserLayout(userId: string): Promise<LayoutDocument | null> {
  // Use Supabase REST API to read from the portfolio table
  const res = await fetch(`${SUPABASE_URL}/rest/v1/portfolio?user_id=eq.${userId}&select=data`, {
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json() as Array<{ data: LayoutDocument }>;
  if (!rows.length) return null;
  return rows[0].data;
}

async function saveUserLayout(userId: string, layout: LayoutDocument): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/portfolio`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, data: layout }),
  });
  if (!res.ok) throw new Error('Could not save board layout.');
}

function emptyLayout(now = Date.now()): LayoutDocument {
  return { version: 1, boards: DEFAULT_BOARDS.map((board) => ({ ...board })), widgets: [], updatedAt: now };
}

export async function handleAccountsRequest(req: AccountRequest, res: AccountResponse, _nowMs = Date.now()): Promise<void> {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 403, { ok: false, error: 'Accounts stay on this site.' });
      return;
    }

    // GET: check if user is logged in via cookie
    if (req.method === 'GET') {
      const token = readCookie(header(req, 'cookie'));
      const user = await supabaseGetUser(token);
      if (!user || !user.email) {
        send(res, 200, { ok: true, user: null, layout: null });
        return;
      }
      const layout = await getUserLayout(user.id!);
      send(res, 200, { ok: true, user: { username: user.email }, layout: layout ?? emptyLayout() });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    const data = asRecord(await readBody(req));
    const action = data.action;

    // LOGOUT
    if (action === 'logout') {
      send(res, 200, { ok: true, user: null, layout: null }, sessionCookie('', hostName(req), 0));
      return;
    }

    // SAVE layout
    if (action === 'save') {
      const token = readCookie(header(req, 'cookie'));
      const user = await supabaseGetUser(token);
      if (!user || !user.id) {
        send(res, 401, { ok: false, error: 'Sign in to save this board.' });
        return;
      }
      const layout = data.layout as LayoutDocument;
      if (!layout || layout.version !== 1 || !Array.isArray(layout.widgets)) {
        send(res, 400, { ok: false, error: 'Invalid layout.' });
        return;
      }
      await saveUserLayout(user.id, layout);
      send(res, 200, { ok: true, user: { username: user.email }, layout });
      return;
    }

    // REGISTER or LOGIN
    if (action !== 'register' && action !== 'login') {
      send(res, 400, { ok: false, error: 'Unknown account action.' });
      return;
    }

    const email = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    const password = typeof data.password === 'string' ? data.password : '';

    if (!email || !email.includes('@') || email.length > 200) {
      send(res, 400, { ok: false, error: 'Enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      send(res, 400, { ok: false, error: 'Use at least 8 characters.' });
      return;
    }

    const result = action === 'register'
      ? await supabaseSignUp(email, password)
      : await supabaseSignIn(email, password);

    if (result.error || !result.access_token || !result.user) {
      const msg = result.error === 'invalid_credentials' ? 'Wrong email or password.' : (result.error || 'Authentication failed.');
      send(res, 401, { ok: false, error: msg });
      return;
    }

    const layout = await getUserLayout(result.user.id);
    send(
      res,
      200,
      { ok: true, user: { username: result.user.email }, layout: layout ?? emptyLayout() },
      sessionCookie(result.access_token, hostName(req), MAX_AGE_SECONDS),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Account request failed.';
    send(res, 500, { ok: false, error: msg });
  }
}
