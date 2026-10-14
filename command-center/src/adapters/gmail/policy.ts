/** Locked mailbox. The phone never chooses another account. */
export const GMAIL_MAILBOX = 'caseylsims@gmail.com';

export const GMAIL_INBOX_LIMIT = 25;

/**
 * Distinctive serif for the Gmail label. Body copy stays on Sora.
 * Fraunces loads from the same Google Fonts sheet as the rest of the shell.
 */
export const GMAIL_TITLE_FONT =
  '"Fraunces", "Iowan Old Style", Palatino, "Palatino Linotype", "Book Antiqua", serif';

export const GMAIL_TITLE_STYLE = {
  fontFamily: GMAIL_TITLE_FONT,
  textTransform: 'none' as const,
  letterSpacing: '0.01em',
  fontWeight: 560,
};

export const PUBLIC_CLOSED_MESSAGE =
  'Gmail is closed on this public site. The inbox is not loaded and send is disabled, so a stranger cannot read or send mail. Set GMAIL_APP_PASSWORD on the private mail server and open Command Center from that host — not from GitHub Pages and not from the public chat Space.';

export const UNREACHABLE_MESSAGE =
  'The private mail server is not running on this host. Start server/gmail_mail.py with GMAIL_APP_PASSWORD set. It listens on 127.0.0.1:8787. That secret stays off GitHub Pages, off VITE_ variables, and off the public chat Space.';

const PUBLIC_SUFFIXES = [
  'github.io',
  'githubusercontent.com',
  'github.com',
  'hf.space',
  'huggingface.co',
  'vercel.app',
  'netlify.app',
  'pages.dev',
];

export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 1 ? host.slice(1, end) : '';
  }
  if (host.includes(':') && host.split(':').length === 2) {
    host = host.slice(0, host.indexOf(':'));
  }
  return host;
}

export function isPublicMailHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;
  return PUBLIC_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Public Pages, the chat Space, and other public hosts never call the mail API. */
export function mailRequestsAllowed(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  return !isPublicMailHost(host);
}

export interface MailSummary {
  uid: string;
  from: string;
  subject: string;
  date: string;
}

export interface MailMessage extends MailSummary {
  to: string;
  body: string;
}

export function normalizeSummary(value: unknown): MailSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const uid = typeof row.uid === 'string' ? row.uid : typeof row.uid === 'number' ? String(row.uid) : '';
  if (!/^\d{1,20}$/.test(uid)) return null;
  return {
    uid,
    from: typeof row.from === 'string' ? row.from : '',
    subject: typeof row.subject === 'string' ? row.subject : '',
    date: typeof row.date === 'string' ? row.date : '',
  };
}

export function capInbox(messages: MailSummary[]): MailSummary[] {
  return messages.slice(0, GMAIL_INBOX_LIMIT);
}
