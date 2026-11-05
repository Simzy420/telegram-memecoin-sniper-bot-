import { useMemo, useState } from 'react';
import { BOT_ROSTER, DEFAULT_BOT_ID } from '@/bots/roster';
import { BotAvatar } from '@/components/avatars/BotAvatar';
import { WidgetFrame } from '@/components/shell/WidgetFrame';
import { cn } from '@/lib/cn';
import { useActivityStore } from '@/store/activityStore';
import { useChatStore } from '@/store/chatStore';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';
import type { WidgetRenderProps } from '@/registry/types';

type Tab = 'thread' | 'log';

export function ChatWidget({ widget }: WidgetRenderProps) {
  const threads = useChatStore((s) => s.threads);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const errors = useChatStore((s) => s.errors);
  const events = useActivityStore((s) => s.events);
  const activeBotId = useSessionStore((s) => s.activeBotId);
  const updateSettings = useProfileStore((s) => s.updateSettings);

  const selected = useMemo(() => {
    const raw = widget.settings.selectedBotIds;
    if (Array.isArray(raw) && raw.length) return raw as string[];
    return [activeBotId];
  }, [widget.settings.selectedBotIds, activeBotId]);

  const [focusBot, setFocusBot] = useState(
    selected.includes(DEFAULT_BOT_ID) ? DEFAULT_BOT_ID : (selected[0] ?? activeBotId),
  );
  const [tab, setTab] = useState<Tab>('thread');
  const [draft, setDraft] = useState('');

  const visibleBots = BOT_ROSTER.filter((b) => selected.includes(b.id));
  const current = visibleBots.find((b) => b.id === focusBot) ?? visibleBots[0] ?? BOT_ROSTER[0];
  const messages = threads[current.id] ?? [];
  const waiting = Boolean(streaming[current.id]);
  const error = errors[current.id];
  const placeholder =
    current.id === 'chief' ? 'Message Chief of Staff…' : `Command ${current.name}…`;

  function toggleBot(id: string) {
    const set = new Set(selected);
    if (set.has(id)) {
      if (set.size === 1) return;
      set.delete(id);
    } else {
      set.add(id);
    }
    const next = BOT_ROSTER.map((b) => b.id).filter((bid) => set.has(bid));
    updateSettings(widget.id, { selectedBotIds: next });
    if (!set.has(focusBot)) setFocusBot(next[0]);
  }

  function pickCount(n: number | 'all') {
    const rest = BOT_ROSTER.filter((b) => b.id !== DEFAULT_BOT_ID).map((b) => b.id);
    const ids = n === 'all' ? [DEFAULT_BOT_ID, ...rest] : [DEFAULT_BOT_ID, ...rest].slice(0, n);
    updateSettings(widget.id, { selectedBotIds: ids });
    setFocusBot(ids.includes(focusBot) ? focusBot : ids[0]);
  }

  async function onSend() {
    const text = draft;
    setDraft('');
    await send(current.id, text);
  }

  return (
    <WidgetFrame
      widget={widget}
      title="Chat"
      footer={
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSend();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="hud-input flex-1"
            disabled={waiting}
          />
          <button type="submit" className="hud-btn-primary px-3 disabled:opacity-50" disabled={waiting || !draft.trim()}>
            {waiting ? '…' : 'Send'}
          </button>
        </form>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {(['1', '2', '3', 'all'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="hud-chip"
            onClick={() => pickCount(k === 'all' ? 'all' : Number(k))}
          >
            {k === 'all' ? 'All bots' : `${k}`}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {BOT_ROSTER.map((bot) => {
          const on = selected.includes(bot.id);
          return (
            <button
              key={bot.id}
              type="button"
              onClick={() => toggleBot(bot.id)}
              className={cn('shrink-0 rounded-xl p-1', on ? 'ring-1 ring-cyan-300/70' : 'opacity-40')}
            >
              <BotAvatar shape={bot.shape} hue={bot.hue} size={44} label={bot.name} />
            </button>
          );
        })}
      </div>
      <div className="mb-2 flex gap-2">
        {visibleBots.map((bot) => (
          <button
            key={bot.id}
            type="button"
            className={cn('hud-chip', bot.id === current.id && 'hud-chip-on')}
            onClick={() => setFocusBot(bot.id)}
          >
            {bot.name}
          </button>
        ))}
        <button
          type="button"
          className={cn('hud-chip ml-auto', tab === 'log' && 'hud-chip-on')}
          onClick={() => setTab(tab === 'log' ? 'thread' : 'log')}
        >
          Log
        </button>
      </div>
      {tab === 'log' ? (
        <ul className="space-y-2 font-mono text-[11px] text-cyan-100/80">
          {events.length === 0 ? <li className="text-white/40">No activity yet.</li> : null}
          {events.slice(0, 24).map((ev) => (
            <li key={ev.id} className="border-l border-cyan-400/30 pl-2">
              <span className="text-white/40">{new Date(ev.at).toLocaleTimeString()}</span> {ev.text}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {waiting ? (
            <li className="text-xs uppercase tracking-wider text-cyan-200/80">Waiting for reply…</li>
          ) : null}
          {error && !waiting ? (
            <li className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</li>
          ) : null}
          {messages.length === 0 && !waiting && !error ? (
            <li className="text-sm text-white/45">
              Separate thread for {current.name}. Casey&apos;s main conversation is with Chief of Staff.
            </li>
          ) : null}
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                m.role === 'user' ? 'ml-6 bg-cyan-400/10 text-cyan-50' : 'mr-4 bg-fuchsia-500/10 text-fuchsia-50',
              )}
            >
              {m.text || (waiting ? '▍' : '')}
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
