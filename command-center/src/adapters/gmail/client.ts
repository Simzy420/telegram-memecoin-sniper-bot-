import {
  GMAIL_MAILBOX,
  PUBLIC_CLOSED_MESSAGE,
  UNREACHABLE_MESSAGE,
  capInbox,
  mailRequestsAllowed,
  normalizeSummary,
  type MailMessage,
  type MailSummary,
} from './policy';

export class MailClosedError extends Error {
  readonly closed = true;

  constructor(message: string) {
    super(message);
    this.name = 'MailClosedError';
  }
}

export class MailUnreachableError extends Error {
  readonly unreachable = true;

  constructor(message = UNREACHABLE_MESSAGE) {
    super(message);
    this.name = 'MailUnreachableError';
  }
}

export function assertPrivateMailHost(hostname: string): void {
  if (!mailRequestsAllowed(hostname)) {
    throw new MailClosedError(PUBLIC_CLOSED_MESSAGE);
  }
}

async function requestJson(
  hostname: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  assertPrivateMailHost(hostname);
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MailUnreachableError();
  }
  const data: unknown = await response.json().catch(() => ({}));
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (record.closed === true) {
    const message = typeof record.error === 'string' && record.error.trim() ? record.error : PUBLIC_CLOSED_MESSAGE;
    throw new MailClosedError(message);
  }
  if (!response.ok) {
    const message = typeof record.error === 'string' && record.error.trim()
      ? record.error
      : `Mail request failed (${response.status}).`;
    throw new Error(message);
  }
  if (record.mailbox != null && record.mailbox !== GMAIL_MAILBOX) {
    throw new Error('This board only opens caseylsims@gmail.com.');
  }
  return record;
}

export async function loadInbox(
  hostname: string,
  signal?: AbortSignal,
): Promise<{ mailbox: string; messages: MailSummary[] }> {
  const data = await requestJson(hostname, '/api/gmail/inbox', { signal, headers: { Accept: 'application/json' } });
  const rows = Array.isArray(data.messages) ? data.messages : [];
  const messages = capInbox(rows.map(normalizeSummary).filter((row): row is MailSummary => row != null));
  return { mailbox: GMAIL_MAILBOX, messages };
}

export async function loadMessage(hostname: string, uid: string, signal?: AbortSignal): Promise<MailMessage> {
  if (!/^\d{1,20}$/.test(uid)) throw new Error('Unknown message.');
  const data = await requestJson(hostname, `/api/gmail/messages/${uid}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  const message = normalizeSummary(data.message);
  const raw = data.message;
  const body = raw && typeof raw === 'object' && typeof (raw as { body?: unknown }).body === 'string'
    ? (raw as { body: string }).body
    : '';
  const to = raw && typeof raw === 'object' && typeof (raw as { to?: unknown }).to === 'string'
    ? (raw as { to: string }).to
    : '';
  if (!message) throw new Error('That message is not in the newest inbox.');
  return { ...message, to, body };
}

export async function sendMail(
  hostname: string,
  draft: { to: string; subject: string; body: string },
): Promise<void> {
  await requestJson(hostname, '/api/gmail/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
    }),
  });
}
