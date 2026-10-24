import { DriveGatewayError, DriveInputError, GoogleDriveGateway, googleConfigured, type DriveGateway } from './driveClient.ts';
import {
  GOOGLE_UNSET_MESSAGE,
  PASSWORD_UNSET_MESSAGE,
  issueToken,
  passwordConfigured,
  passwordsMatch,
  readCookie,
  resetPasswordAttempts,
  scrub,
  secretValues,
  passwordAttemptBlocked,
  recordPasswordFailure,
  clearSessionCookie,
  sessionCookie,
  tokenOk,
} from './password.ts';

const FILE_ID = /^[A-Za-z0-9_-]{8,200}$/;
const FORBIDDEN = new Set([
  'password',
  'secret',
  'client_secret',
  'client_id',
  'refresh_token',
  'access_token',
  'google_drive_client_secret',
  'google_drive_refresh_token',
  'google_drive_client_id',
  'command_center_password',
]);

type HeaderValue = string | string[] | undefined;

export interface DriveRequest {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
}

export interface DriveResponse {
  statusCode?: number;
  headersSent?: boolean;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export interface DriveDeps {
  gateway?: DriveGateway;
  nowMs?: number;
}

function header(req: DriveRequest, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function hostName(req: DriveRequest): string {
  return header(req, 'host') || 'localhost';
}

function clientIp(req: DriveRequest): string {
  const forwarded = header(req, 'x-forwarded-for').split(',')[0]?.trim();
  return forwarded || req.socket?.remoteAddress || 'local';
}

export function drivePath(req: DriveRequest): string {
  const url = new URL(req.url || '/', 'http://internal.local');
  const hinted = url.searchParams.get('drivePath');
  if (hinted && hinted.startsWith('/api/drive')) return hinted.split('?')[0].replace(/\/$/, '') || '/api/drive';
  const invoked = header(req, 'x-invoke-path') || header(req, 'x-matched-path');
  if (invoked.startsWith('/api/drive')) return invoked.split('?')[0].replace(/\/$/, '') || '/api/drive';
  const id = url.searchParams.get('id');
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (id && FILE_ID.test(id) && (path === '/api/drive/files/[id]' || path === '/api/drive/files')) {
    return `/api/drive/files/${id}`;
  }
  return path;
}

function send(res: DriveResponse, code: number, payload: Record<string, unknown>, cookie?: string): void {
  const body = scrub(JSON.stringify(payload));
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(body);
}

function needsPassword(res: DriveResponse, error: string, code = 401): void {
  send(res, code, { ok: false, needsPassword: true, error });
}

async function readBody(req: DriveRequest): Promise<unknown> {
  if (typeof req.body === 'string') {
    if (req.body.length > 200_000) throw new DriveInputError('Request is too large.');
    return req.body ? JSON.parse(req.body) : {};
  }
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = req as DriveRequest & AsyncIterable<Buffer | string>;
  if (typeof stream[Symbol.asyncIterator] !== 'function') return {};
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > 200_000) throw new DriveInputError('Request is too large.');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DriveInputError('Send a JSON object.');
  }
  return value as Record<string, unknown>;
}

function rejectSecrets(data: Record<string, unknown>, allowPassword: boolean): void {
  for (const key of Object.keys(data)) {
    const normalized = key.toLowerCase().replaceAll('-', '_');
    if (allowPassword && normalized === 'password') continue;
    if (FORBIDDEN.has(normalized)) throw new DriveInputError('Do not send Google secrets from the browser.');
  }
}

function sessionOk(req: DriveRequest, nowMs: number): boolean {
  return tokenOk(readCookie(header(req, 'cookie')), nowMs);
}

export async function handleDriveRequest(req: DriveRequest, res: DriveResponse, deps: DriveDeps = {}): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const path = drivePath(req);
  const nowMs = deps.nowMs ?? Date.now();
  try {
    if (method === 'POST' || method === 'PUT') req.body = await readBody(req);
    if (method === 'OPTIONS') {
      send(res, 403, { ok: false, error: 'Drive does not accept cross-site requests.' });
      return;
    }
    if (method === 'POST' && path === '/api/drive/session') {
      await unlock(req, res, nowMs);
      return;
    }
    if (!passwordConfigured()) {
      needsPassword(res, PASSWORD_UNSET_MESSAGE, 503);
      return;
    }
    if (!sessionOk(req, nowMs)) {
      needsPassword(res, method === 'GET' && path === '/api/drive/session'
        ? 'Enter the Command Center password.'
        : 'Enter the Command Center password.');
      return;
    }
    if (method === 'GET' && path === '/api/drive/session') {
      send(res, 200, { ok: true });
      return;
    }
    if (!googleConfigured()) {
      send(res, 503, { ok: false, error: GOOGLE_UNSET_MESSAGE });
      return;
    }
    const gateway = deps.gateway ?? new GoogleDriveGateway();
    if (method === 'GET' && path === '/api/drive/files') {
      const files = (await gateway.listFiles()).slice(0, 25);
      send(res, 200, { ok: true, account: 'caseylsims@gmail.com', limit: 25, files });
      return;
    }
    if (method === 'POST' && path === '/api/drive/files') {
      const data = asRecord(await readBody(req));
      rejectSecrets(data, false);
      const file = await gateway.createFile(String(data.name ?? ''), String(data.content ?? ''));
      send(res, 200, { ok: true, account: 'caseylsims@gmail.com', file });
      return;
    }
    const match = path.match(/^\/api\/drive\/files\/([A-Za-z0-9_-]{8,200})$/);
    if (match && method === 'GET') {
      const file = await gateway.readFile(match[1]);
      send(res, 200, { ok: true, account: 'caseylsims@gmail.com', file });
      return;
    }
    if (match && method === 'PUT') {
      const data = asRecord(await readBody(req));
      rejectSecrets(data, false);
      const file = await gateway.updateFile(match[1], String(data.content ?? ''));
      send(res, 200, { ok: true, account: 'caseylsims@gmail.com', file });
      return;
    }
    send(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    if (err instanceof DriveInputError) {
      send(res, 400, { ok: false, error: scrub(err.message) });
      return;
    }
    if (err instanceof DriveGatewayError) {
      send(res, 502, { ok: false, error: scrub(err.message) });
      return;
    }
    if (err instanceof SyntaxError) {
      send(res, 400, { ok: false, error: 'Send a JSON object.' });
      return;
    }
    send(res, 500, { ok: false, error: 'Drive request failed.' });
  }
}

async function unlock(req: DriveRequest, res: DriveResponse, nowMs: number): Promise<void> {
  const data = asRecord(await readBody(req));
  if (data.lock === true) {
    send(res, 200, { ok: true }, clearSessionCookie(hostName(req)));
    return;
  }
  rejectSecrets(data, true);
  if (!passwordConfigured()) {
    needsPassword(res, PASSWORD_UNSET_MESSAGE, 503);
    return;
  }
  if (passwordAttemptBlocked(clientIp(req), nowMs)) {
    needsPassword(res, 'Too many password attempts. Wait a moment.', 429);
    return;
  }
  if (!passwordsMatch(data.password)) {
    recordPasswordFailure(clientIp(req), nowMs);
    needsPassword(res, 'Wrong password.');
    return;
  }
  const token = issueToken(nowMs);
  send(res, 200, { ok: true }, sessionCookie(token, hostName(req)));
}

export function configuredSecretCount(): number {
  return secretValues().length;
}

export { resetPasswordAttempts };
