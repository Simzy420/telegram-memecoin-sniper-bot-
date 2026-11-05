import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  loadInbox,
  loadMessage,
  MailClosedError,
  MailUnreachableError,
  sendMail,
} from '@/adapters/gmail/client';
import {
  GMAIL_MAILBOX,
  GMAIL_TITLE_STYLE,
  PUBLIC_CLOSED_MESSAGE,
  mailRequestsAllowed,
  type MailMessage,
  type MailSummary,
} from '@/adapters/gmail/policy';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import type { WidgetRenderProps } from '@/registry/types';

function formatWhen(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-amber-300/30 bg-black/20 px-3 py-3 text-sm leading-relaxed text-amber-100/90">
      {children}
    </p>
  );
}

export function GmailWidget({ widget }: WidgetRenderProps) {
  const [view, setView] = useState<'inbox' | 'read' | 'compose'>('inbox');
  const [closedMessage, setClosedMessage] = useState<string | null>(() =>
    typeof window !== 'undefined' && !mailRequestsAllowed(window.location.hostname)
      ? PUBLIC_CLOSED_MESSAGE
      : null,
  );
  const [messages, setMessages] = useState<MailSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [opened, setOpened] = useState<MailMessage | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (view !== 'inbox') return;
    const hostname = window.location.hostname;
    if (!mailRequestsAllowed(hostname)) {
      setClosedMessage(PUBLIC_CLOSED_MESSAGE);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setListError(null);
    loadInbox(hostname, controller.signal)
      .then((inbox) => {
        if (controller.signal.aborted) return;
        setClosedMessage(null);
        setMessages(inbox.messages);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof MailClosedError) {
          setClosedMessage(err.message);
          setMessages([]);
          return;
        }
        if (err instanceof MailUnreachableError) {
          setClosedMessage(null);
          setListError(err.message);
          return;
        }
        setListError(err instanceof Error ? err.message : 'Could not load the inbox.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view, reloadKey]);

  async function openMessage(uid: string) {
    const hostname = window.location.hostname;
    if (!mailRequestsAllowed(hostname)) {
      setClosedMessage(PUBLIC_CLOSED_MESSAGE);
      return;
    }
    setView('read');
    setOpened(null);
    setReadError(null);
    setReading(true);
    try {
      const message = await loadMessage(hostname, uid);
      setOpened(message);
    } catch (err) {
      if (err instanceof MailClosedError) setClosedMessage(err.message);
      else setReadError(err instanceof Error ? err.message : 'Could not open that message.');
    } finally {
      setReading(false);
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    setFormError(null);
    const hostname = window.location.hostname;
    if (!mailRequestsAllowed(hostname)) {
      setClosedMessage(PUBLIC_CLOSED_MESSAGE);
      setFormError(PUBLIC_CLOSED_MESSAGE);
      return;
    }
    if (closedMessage) {
      setFormError(closedMessage);
      return;
    }
    if (!to.trim()) {
      setFormError('Add a recipient in To.');
      return;
    }
    setSending(true);
    try {
      await sendMail(hostname, { to: to.trim(), subject, body });
      setTo('');
      setSubject('');
      setBody('');
      setSent(true);
    } catch (err) {
      if (err instanceof MailClosedError) {
        setClosedMessage(err.message);
        setFormError(err.message);
      } else {
        setFormError(err instanceof Error ? err.message : 'Could not send.');
      }
    } finally {
      setSending(false);
    }
  }

  const badge = closedMessage || listError ? 'CLOSED' : 'LIVE';

  return (
    <WidgetFrame widget={widget} title="Gmail" titleStyle={GMAIL_TITLE_STYLE} badge={badge}>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">{GMAIL_MAILBOX}</p>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={cn('hud-chip widget-no-drag', view === 'inbox' && 'hud-chip-on')}
          onClick={() => setView('inbox')}
        >
          Inbox
        </button>
        <button
          type="button"
          className={cn('hud-chip widget-no-drag', view === 'compose' && 'hud-chip-on')}
          onClick={() => setView('compose')}
        >
          Compose
        </button>
      </div>

      {view === 'inbox' ? (
        <div>
          {closedMessage ? (
            <Notice>{closedMessage}</Notice>
          ) : (
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs text-white/45">{loading ? 'Loading the newest 25…' : 'Newest 25'}</p>
              <button
                type="button"
                className="hud-btn-ghost widget-no-drag h-11 w-11 shrink-0 px-0 disabled:opacity-50"
                aria-label="Refresh inbox"
                disabled={loading}
                onClick={() => setReloadKey((key) => key + 1)}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
            </div>
          )}
          {listError ? <Notice>{listError}</Notice> : null}
          {!closedMessage && !listError && !loading && messages.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/15 bg-black/20 px-3 py-6 text-center text-sm text-white/50">
              Inbox is empty.
            </p>
          ) : null}
          <ul className="space-y-2">
            {messages.map((message) => (
              <li key={message.uid}>
                <button
                  type="button"
                  className="widget-no-drag w-full rounded-xl bg-white/5 px-3 py-2.5 text-left hover:bg-white/10"
                  onClick={() => void openMessage(message.uid)}
                >
                  <span className="block truncate text-sm text-white">{message.from || '(unknown sender)'}</span>
                  <span className="mt-0.5 block truncate text-sm text-white/75">
                    {message.subject || '(no subject)'}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] text-white/40">{formatWhen(message.date)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view === 'read' ? (
        <div>
          <button type="button" className="hud-btn-ghost widget-no-drag mb-3" onClick={() => setView('inbox')}>
            Back
          </button>
          {closedMessage ? <Notice>{closedMessage}</Notice> : null}
          {reading ? <p className="text-sm text-white/55">Opening message…</p> : null}
          {readError ? <Notice>{readError}</Notice> : null}
          {opened ? (
            <article>
              <h4 className="text-base text-white">{opened.subject || '(no subject)'}</h4>
              <p className="mt-1 text-sm text-white/70">{opened.from || '(unknown sender)'}</p>
              {opened.to ? <p className="text-xs text-white/45">To {opened.to}</p> : null}
              <p className="mt-1 font-mono text-[10px] text-white/40">{formatWhen(opened.date)}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                {opened.body || 'This message has no text body.'}
              </p>
            </article>
          ) : null}
        </div>
      ) : null}

      {view === 'compose' ? (
        <form className="space-y-2" onSubmit={(event) => void onSend(event)}>
          {closedMessage ? <Notice>{closedMessage}</Notice> : null}
          <label className="block text-xs text-white/55">
            To
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              autoComplete="email"
              className="hud-input widget-no-drag mt-1 w-full"
              placeholder="name@example.com"
            />
          </label>
          <label className="block text-xs text-white/55">
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="hud-input widget-no-drag mt-1 w-full"
            />
          </label>
          <label className="block text-xs text-white/55">
            Body
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              className="hud-input widget-no-drag mt-1 w-full resize-y"
            />
          </label>
          {formError ? <p className="text-sm text-rose-200">{formError}</p> : null}
          {sent ? <p className="text-sm text-emerald-200">Sent.</p> : null}
          <button type="submit" className="hud-btn-primary widget-no-drag w-full" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
    </WidgetFrame>
  );
}
