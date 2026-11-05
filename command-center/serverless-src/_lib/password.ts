import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'cc_drive_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const PASSWORD_UNSET_MESSAGE =
  'Set COMMAND_CENTER_PASSWORD on the Vercel project. The Google Drive section stays empty until that server variable is set. Do not put it in a VITE_ variable, GitHub Pages, or the app.';

export const GOOGLE_UNSET_MESSAGE =
  'Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN on the Vercel project. The password was accepted. Drive files stay empty until those server variables are set. Do not put them in a VITE_ variable or in the app.';

export function passwordConfigured(): boolean {
  return Boolean(process.env.COMMAND_CENTER_PASSWORD && process.env.COMMAND_CENTER_PASSWORD.length > 0);
}

export function passwordsMatch(given: unknown, expected = process.env.COMMAND_CENTER_PASSWORD ?? ''): boolean {
  if (!expected || typeof given !== 'string' || given.length === 0) return false;
  const left = createHash('sha256').update(given, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export function issueToken(nowMs = Date.now()): string {
  const secret = process.env.COMMAND_CENTER_PASSWORD ?? '';
  const exp = String(Math.floor(nowMs / 1000) + MAX_AGE_SECONDS);
  const sig = createHmac('sha256', secret).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

export function tokenOk(token: string, nowMs = Date.now()): boolean {
  const secret = process.env.COMMAND_CENTER_PASSWORD ?? '';
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{10,13}$/.test(exp)) return false;
  if (Number(exp) < Math.floor(nowMs / 1000)) return false;
  const expected = createHmac('sha256', secret).update(exp).digest('hex');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readCookie(header: string | undefined, name = COOKIE_NAME): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function cookieParts(host: string, value: string, maxAge: number): string {
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  const secure = hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Path=/api/drive',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(token: string, host: string): string {
  return cookieParts(host, token, MAX_AGE_SECONDS);
}

export function clearSessionCookie(host: string): string {
  return cookieParts(host, '', 0);
}

const authHits = new Map<string, number[]>();

export function passwordAttemptBlocked(ip: string, nowMs = Date.now()): boolean {
  const recent = (authHits.get(ip) ?? []).filter((stamp) => nowMs - stamp < 60_000);
  authHits.set(ip, recent);
  return recent.length >= 8;
}

export function recordPasswordFailure(ip: string, nowMs = Date.now()): void {
  const recent = (authHits.get(ip) ?? []).filter((stamp) => nowMs - stamp < 60_000);
  recent.push(nowMs);
  authHits.set(ip, recent);
}

export function resetPasswordAttempts(): void {
  authHits.clear();
}

export function secretValues(): string[] {
  return [
    process.env.COMMAND_CENTER_PASSWORD,
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  ].filter((value): value is string => typeof value === 'string' && value.length >= 8);
}

export function scrub(text: string): string {
  let cleaned = text;
  for (const value of secretValues()) cleaned = cleaned.split(value).join('[redacted]');
  return cleaned;
}
