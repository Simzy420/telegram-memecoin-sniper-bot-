import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { get, put } from '@vercel/blob';
import { DEFAULT_BOARDS, type BoardId, type LayoutDocument, type WidgetInstance } from '../../src/types/layout.ts';

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

const scryptAsync = promisify(scrypt);
const COOKIE_NAME = 'cc_account';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const BLOB_PATH = 'accounts/v1.json';
const MAX_WIDGETS = 80;
const PAGES = new Set<string>(DEFAULT_BOARDS.map((board) => board.id));

export const ACCOUNTS_SETUP_MESSAGE =
  'Connect a private Vercel Blob store to this project. Profile passwords and boards stay in that store. The server reads BLOB_READ_WRITE_TOKEN. Do not put that token in a VITE_ variable, GitHub Pages, or the app.';

interface SessionRow {
  hash: string;
  exp: number;
}

interface AccountRecord {
  username: string;
  salt: string;
  hash: string;
  sessions: SessionRow[];
  layout: LayoutDocument;
}

interface AccountDb {
  users: AccountRecord[];
}

export class AccountsInputError extends Error {}

function emptyDb(): AccountDb {
  return { users: [] };
}

function emptyLayout(now = Date.now()): LayoutDocument {
  return { version: 1, boards: DEFAULT_BOARDS, widgets: [], updatedAt: now };
}

function storeKind(): 'blob' | 'file' | 'unset' {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  if (process.env.VERCEL && !process.env.ACCOUNTS_FILE) return 'unset';
  return 'file';
}

function accountsFile(): string {
  return process.env.ACCOUNTS_FILE || path.join(process.cwd(), '.data', 'accounts.json');
}

function readFileDb(): AccountDb {
  try {
    const parsed: unknown = JSON.parse(readFileSync(accountsFile(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as AccountDb).users)) return emptyDb();
    return parsed as AccountDb;
  } catch {
    return emptyDb();
  }
}

function writeFileDb(db: AccountDb): void {
  const file = accountsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(db));
  renameSync(temp, file);
}

async function readBlobText(): Promise<string | null> {
  const loaded = await get(BLOB_PATH, { access: 'private', useCache: false });
  if (!loaded || loaded.stream == null) return null;
  return new Response(loaded.stream).text();
}

async function readDb(): Promise<AccountDb> {
  const kind = storeKind();
  if (kind === 'unset') throw new AccountsInputError(ACCOUNTS_SETUP_MESSAGE);
  if (kind === 'file') return readFileDb();
  try {
    const text = await readBlobText();
    if (!text) return emptyDb();
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as AccountDb).users)) return emptyDb();
    return parsed as AccountDb;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/not found|404/i.test(message)) return emptyDb();
    throw err;
  }
}

async function writeDb(db: AccountDb): Promise<void> {
  const kind = storeKind();
  if (kind === 'unset') throw new AccountsInputError(ACCOUNTS_SETUP_MESSAGE);
  if (kind === 'file') {
    writeFileDb(db);
    return;
  }
  await put(BLOB_PATH, JSON.stringify(db), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function header(req: AccountRequest, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function hostName(req: AccountRequest): string {
  return header(req, 'host') || 'localhost';
}

function clientIp(req: AccountRequest): string {
  const forwarded = header(req, 'x-forwarded-for').split(',')[0]?.trim();
  return forwarded || req.socket?.remoteAddress || 'local';
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
    if (req.body.length > 200_000) throw new AccountsInputError('Request is too large.');
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
    if (size > 200_000) throw new AccountsInputError('Request is too large.');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountsInputError('Send a JSON object.');
  return value as Record<string, unknown>;
}

async function hashSecret(secret: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(secret, salt, 32)) as Buffer;
}

async function passwordHash(password: string, salt: Buffer): Promise<string> {
  return (await hashSecret(password, salt)).toString('hex');
}

function hashesEqual(leftHex: string, right: Buffer): boolean {
  const left = Buffer.from(leftHex, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(account: AccountRecord, layout: LayoutDocument) {
  return { ok: true, user: { username: account.username }, layout };
}

function liveSessions(account: AccountRecord, nowSec: number): SessionRow[] {
  return account.sessions.filter((session) => session.exp > nowSec);
}

function findSession(db: AccountDb, token: string, nowSec: number): AccountRecord | undefined {
  if (!token) return undefined;
  const hash = tokenHash(token);
  return db.users.find((user) => liveSessions(user, nowSec).some((session) => session.hash === hash));
}

function sanitizeLayout(value: unknown): LayoutDocument {
  const record = asRecord(value);
  if (record.version !== 1 || !Array.isArray(record.widgets)) throw new AccountsInputError('Invalid layout JSON.');
  if (record.widgets.length > MAX_WIDGETS) throw new AccountsInputError('That board has too many widgets.');
  const widgets: WidgetInstance[] = record.widgets.map((item) => {
    const widget = asRecord(item);
    const type = typeof widget.type === 'string' ? widget.type.slice(0, 40) : '';
    const page = typeof widget.page === 'string' && PAGES.has(widget.page) ? (widget.page as BoardId) : 'home';
    const num = (field: string, fallback: number, max: number) => {
      const raw = widget[field];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
      return Math.min(max, Math.max(0, value));
    };
    const settings: Record<string, unknown> = {};
    const rawSettings = widget.settings;
    if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
      for (const [key, item] of Object.entries(rawSettings)) {
        if (key.toLowerCase() === 'password') continue;
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item == null) settings[key] = item;
        else if (Array.isArray(item) && item.every((entry) => typeof entry === 'string')) settings[key] = item.slice(0, 40);
      }
    }
    return {
      id: typeof widget.id === 'string' && widget.id.trim() ? widget.id.slice(0, 80) : `w_${randomBytes(4).toString('hex')}`,
      type: type || 'unknown',
      x: num('x', 0, 48),
      y: num('y', 0, 400),
      w: Math.max(1, num('w', 6, 12)),
      h: Math.max(1, num('h', 6, 40)),
      page,
      settings,
    };
  });
  return { version: 1, boards: DEFAULT_BOARDS, widgets, updatedAt: Date.now() };
}

function usernameOf(value: unknown): string {
  if (typeof value !== 'string') throw new AccountsInputError('Enter a username.');
  const username = value.trim();
  if (!username || username.length > 40) throw new AccountsInputError('Enter a username.');
  if (/[\u0000-\u001f]/.test(username)) throw new AccountsInputError('Enter a username.');
  return username;
}

function passwordOf(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw new AccountsInputError('Use at least 8 characters.');
  }
  return value;
}

const failures = new Map<string, number[]>();

function attemptBlocked(ip: string, nowMs: number): boolean {
  const recent = (failures.get(ip) ?? []).filter((time) => nowMs - time < 60_000);
  failures.set(ip, recent);
  return recent.length >= 8;
}

function recordFailure(ip: string, nowMs: number): void {
  const recent = failures.get(ip) ?? [];
  recent.push(nowMs);
  failures.set(ip, recent);
}

export function resetAccountAttempts(): void {
  failures.clear();
}

let dummyHash: Buffer | null = null;

async function spendHashTime(password: string): Promise<void> {
  const salt = Buffer.alloc(16, 7);
  const hash = (await hashSecret(password, salt)) as Buffer;
  if (!dummyHash) dummyHash = hash;
  hashesEqual(dummyHash.toString('hex'), hash);
}

async function issueSession(account: AccountRecord, host: string, nowMs: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const exp = Math.floor(nowMs / 1000) + MAX_AGE_SECONDS;
  const sessions = liveSessions(account, Math.floor(nowMs / 1000));
  sessions.push({ hash: tokenHash(token), exp });
  account.sessions = sessions.slice(-4);
  return sessionCookie(token, host, MAX_AGE_SECONDS);
}

export async function handleAccountsRequest(req: AccountRequest, res: AccountResponse, nowMs = Date.now()): Promise<void> {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 403, { ok: false, error: 'Accounts stay on this site.' });
      return;
    }
    if (req.method === 'GET') {
      const db = await readDb();
      const account = findSession(db, readCookie(header(req, 'cookie')), Math.floor(nowMs / 1000));
      if (!account) {
        send(res, 200, { ok: true, user: null, layout: null });
        return;
      }
      send(res, 200, publicUser(account, account.layout));
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const data = asRecord(await readBody(req));
    const action = data.action;
    if (action === 'logout') {
      await withLock(async () => {
        const db = await readDb();
        const token = readCookie(header(req, 'cookie'));
        const hash = token ? tokenHash(token) : '';
        for (const user of db.users) user.sessions = user.sessions.filter((session) => session.hash !== hash);
        await writeDb(db);
      });
      send(res, 200, { ok: true, user: null, layout: null }, sessionCookie('', hostName(req), 0));
      return;
    }
    if (action === 'save') {
      const layout = sanitizeLayout(data.layout);
      const saved = await withLock(async () => {
        const db = await readDb();
        const account = findSession(db, readCookie(header(req, 'cookie')), Math.floor(nowMs / 1000));
        if (!account) return null;
        account.layout = layout;
        await writeDb(db);
        return account;
      });
      if (!saved) {
        send(res, 401, { ok: false, error: 'Sign in to save this board.' });
        return;
      }
      send(res, 200, publicUser(saved, saved.layout));
      return;
    }
    if (action !== 'register' && action !== 'login') {
      send(res, 400, { ok: false, error: 'Unknown account action.' });
      return;
    }
    const username = usernameOf(data.username);
    const password = passwordOf(data.password);
    const ip = clientIp(req);
    if (attemptBlocked(ip, nowMs)) {
      send(res, 429, { ok: false, error: 'Too many sign-in attempts. Wait a moment.' });
      return;
    }
    const result = await withLock(async () => {
      const db = await readDb();
      const existing = db.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
      if (action === 'register') {
        if (existing) return { status: 409 as const, error: 'That username is already in use.' };
        const salt = randomBytes(16);
        const account: AccountRecord = {
          username,
          salt: salt.toString('hex'),
          hash: await passwordHash(password, salt),
          sessions: [],
          layout: emptyLayout(nowMs),
        };
        const cookie = await issueSession(account, hostName(req), nowMs);
        db.users.push(account);
        await writeDb(db);
        return { status: 200 as const, account, cookie };
      }
      if (!existing) {
        await spendHashTime(password);
        recordFailure(ip, nowMs);
        return { status: 401 as const, error: 'Wrong username or password.' };
      }
      const actual = await hashSecret(password, Buffer.from(existing.salt, 'hex'));
      if (!hashesEqual(existing.hash, actual)) {
        recordFailure(ip, nowMs);
        return { status: 401 as const, error: 'Wrong username or password.' };
      }
      const cookie = await issueSession(existing, hostName(req), nowMs);
      await writeDb(db);
      return { status: 200 as const, account: existing, cookie };
    });
    if (result.status !== 200) {
      send(res, result.status, { ok: false, error: result.error });
      return;
    }
    const body = JSON.stringify(publicUser(result.account, result.account.layout));
    if (body.includes(password)) {
      send(res, 500, { ok: false, error: 'Account response failed.' });
      return;
    }
    send(res, 200, publicUser(result.account, result.account.layout), result.cookie);
  } catch (err) {
    if (err instanceof AccountsInputError) {
      const code = err.message === ACCOUNTS_SETUP_MESSAGE ? 503 : 400;
      send(res, code, { ok: false, error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      send(res, 400, { ok: false, error: 'Send a JSON object.' });
      return;
    }
    send(res, 500, { ok: false, error: 'Account request failed.' });
  }
}
