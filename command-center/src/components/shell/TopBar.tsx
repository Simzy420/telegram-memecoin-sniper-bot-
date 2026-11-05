import { Menu, Pencil, Search } from 'lucide-react';
import { BOT_ROSTER } from '@/bots/roster';
import { BotAvatar } from '@/components/avatars/BotAvatar';
import { cn } from '@/lib/cn';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';

export function TopBar() {
  const drawerOpen = useSessionStore((s) => s.drawerOpen);
  const setDrawerOpen = useSessionStore((s) => s.setDrawerOpen);
  const mode = useSessionStore((s) => s.mode);
  const setMode = useSessionStore((s) => s.setMode);
  const observeOnly = useSessionStore((s) => s.observeOnly);
  const setObserveOnly = useSessionStore((s) => s.setObserveOnly);
  const search = useSessionStore((s) => s.search);
  const setSearch = useSessionStore((s) => s.setSearch);
  const activeBotId = useSessionStore((s) => s.activeBotId);
  const setActiveBot = useSessionStore((s) => s.setActiveBot);
  const signedIn = useProfileStore((s) => Boolean(s.activeId));
  const bot = BOT_ROSTER.find((b) => b.id === activeBotId) ?? BOT_ROSTER[0];

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#050816]/85 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 rounded-xl p-2 text-cyan-200 hover:bg-white/5"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[13px] font-bold uppercase tracking-[0.32em] text-cyan-300">Dark</p>
          <h1 className="bg-gradient-to-r from-fuchsia-400 via-violet-300 to-cyan-300 bg-clip-text font-display text-[clamp(1.15rem,5.2vw,1.55rem)] font-extrabold uppercase leading-[1.05] tracking-wide text-transparent">
            Command
            <br />
            Center
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/35">
            Observe · Analyze · Silence
          </p>
        </div>
        <button
          type="button"
          onClick={() => setObserveOnly(!observeOnly)}
          className={cn('observe-pill w-[9.6rem] shrink-0 text-left', observeOnly && 'observe-pill-on')}
        >
          <span className="flex items-center gap-2 font-display text-[10px] font-bold uppercase tracking-[0.16em]">
            <span className={cn('h-2 w-2 rounded-full', observeOnly ? 'bg-rose-400 shadow-[0_0_8px_#fb7185]' : 'bg-white/30')} />
            Observe only
          </span>
          <span className="mt-1 block text-[10px] leading-snug text-rose-100/80">
            Watch bots work — you don&apos;t intervene
          </span>
        </button>
      </div>

      <label className="relative mt-3 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search widgets"
          className="hud-input w-full pl-9"
        />
      </label>

      <div className="mt-2 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-2 py-1">
          <BotAvatar shape={bot.shape} hue={bot.hue} size={28} />
          <select
            value={bot.id}
            onChange={(e) => setActiveBot(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
            aria-label="Active bot"
          >
            {BOT_ROSTER.map((b) => (
              <option key={b.id} value={b.id} className="bg-slate-900">
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!signedIn}
          aria-label={signedIn ? 'Edit your board' : 'Sign in to edit your board'}
          onClick={() => {
            if (!signedIn) return;
            setMode(mode === 'edit' ? 'use' : 'edit');
          }}
          className={cn(
            'hud-btn-primary flex items-center gap-1 px-3',
            mode === 'edit' && 'hud-btn-edit',
            !signedIn && 'opacity-40',
          )}
        >
          <Pencil className="h-4 w-4" />
          {mode === 'edit' ? 'Edit' : 'Use'}
        </button>
      </div>
      {mode === 'edit' ? (
        <p className="mt-2 text-center text-[11px] text-amber-200/80">
          Edit mode — drag from a widget header. Use mode keeps scrolling free.
        </p>
      ) : null}
    </header>
  );
}
