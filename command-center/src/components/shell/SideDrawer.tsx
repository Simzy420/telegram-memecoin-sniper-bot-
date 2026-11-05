import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AiToolsMenuButton, AiToolsPanel } from '@/components/shell/aiTools';
import { ProfilesSection } from '@/components/shell/ProfilesSection';
import { DEFAULT_BOARDS, type LayoutDocument } from '@/types/layout';
import { cn } from '@/lib/cn';
import { DEFAULT_CHAT_API_BASE, isChatBridgeConfigured, resolveChatApiBase } from '@/adapters/chat';
import { OpenAiKeyFields } from '@/components/image/OpenAiKeyFields';
import { StillProviderSwitch } from '@/components/image/StillProviderSwitch';
import { useChatStore } from '@/store/chatStore';
import { useImageStore } from '@/store/imageStore';
import { getOwnerBoard } from '@/profiles/ownerBoard';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';
import { useVaultStore } from '@/store/vaultStore';

export function SideDrawer() {
  const open = useSessionStore((s) => s.drawerOpen);
  const setDrawerOpen = useSessionStore((s) => s.setDrawerOpen);
  const board = useSessionStore((s) => s.board);
  const setBoard = useSessionStore((s) => s.setBoard);
  const plan = useSessionStore((s) => s.plan);
  const setPlan = useSessionStore((s) => s.setPlan);
  const flags = useSessionStore((s) => s.flags);
  const setFlag = useSessionStore((s) => s.setFlag);
  const observeOnly = useSessionStore((s) => s.observeOnly);
  const setObserveOnly = useSessionStore((s) => s.setObserveOnly);
  const activeId = useProfileStore((s) => s.activeId);
  const userLayout = useProfileStore((s) => s.layout);
  const importLayout = useProfileStore((s) => s.importLayout);
  const resetMyBoard = useProfileStore((s) => s.resetMyBoard);
  const hasKey = useVaultStore((s) => s.hasKey);
  const hint = useVaultStore((s) => s.hint);
  const chatApiBase = useVaultStore((s) => s.chatApiBase);
  const saveChatApiBase = useVaultStore((s) => s.saveChatApiBase);
  const clearChatApiBase = useVaultStore((s) => s.clearChatApiBase);
  const chatStatus = useChatStore((s) => s.status);
  const chatError = useChatStore((s) => s.lastError);
  const stillProvider = useImageStore((s) => s.stillProvider);
  const fileRef = useRef<HTMLInputElement>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMsg, setChatMsg] = useState('');
  const [menuView, setMenuView] = useState<'system' | 'tools'>('system');
  if (!open && menuView !== 'system') setMenuView('system');
  const bridgeConfigured = isChatBridgeConfigured();
  const resolvedChatBase = resolveChatApiBase();
  const chatStatusLine = !bridgeConfigured
    ? 'Error — Chat API base missing'
    : chatStatus === 'waiting'
      ? 'Waiting for reply'
      : chatStatus === 'error'
        ? 'Error'
        : 'Connected';

  function downloadLayout() {
    const doc = activeId && userLayout ? userLayout : getOwnerBoard();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'command-center-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const doc = JSON.parse(text) as LayoutDocument;
    importLayout(doc);
  }

  return (
    <>
      <div
        className={cn('fixed inset-0 z-40 bg-black/50 transition', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-0 z-50 flex w-[min(22rem,88vw)] flex-col overflow-y-auto border-r border-cyan-400/20 bg-[#070b1c] p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-glow transition-transform',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {menuView === 'tools' ? (
          <AiToolsPanel onBack={() => setMenuView('system')} onClose={() => setDrawerOpen(false)} />
        ) : (
          <>
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-sm uppercase tracking-[0.22em] text-cyan-300">System</p>
          <button type="button" className="rounded-lg p-2 hover:bg-white/5" onClick={() => setDrawerOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <AiToolsMenuButton onOpen={() => setMenuView('tools')} />

        <ProfilesSection />

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Boards</p>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {DEFAULT_BOARDS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={cn('hud-chip justify-center py-2', board === b.id && 'hud-chip-on')}
              onClick={() => setBoard(b.id)}
            >
              {b.title}
            </button>
          ))}
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Layout JSON</p>
        <div className="mb-5 flex flex-col gap-2">
          <button type="button" className="hud-btn-primary" onClick={downloadLayout}>
            Export layout
          </button>
          <button type="button" className="hud-btn-ghost" disabled={!activeId} onClick={() => fileRef.current?.click()}>
            Import layout
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void onImport(e.target.files?.[0])}
          />
          <button
            type="button"
            className="hud-btn-ghost text-amber-200 disabled:opacity-40"
            disabled={!activeId}
            onClick={() => {
              resetMyBoard();
              setBoard('home');
            }}
          >
            Reset my board
          </button>
          {activeId ? null : (
            <p className="text-xs leading-relaxed text-white/45">
              Casey's board is view only. Sign in to import or reset your own board.
            </p>
          )}
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Billing stub</p>
        <div className="mb-5 space-y-2 rounded-2xl border border-white/10 p-3 text-sm text-white/70">
          <p>Plan: {plan === 'owner' ? 'Owner (saves locally)' : 'Guest / unpaid'}</p>
          <button type="button" className="hud-btn-primary w-full" onClick={() => setPlan(plan === 'owner' ? 'guest' : 'owner')}>
            {plan === 'owner' ? 'Simulate unpaid preview' : 'Upgrade to save (stub)'}
          </button>
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Image vault</p>
        <div className="mb-5 space-y-3 rounded-2xl border border-white/10 p-3 text-sm text-white/70">
          <StillProviderSwitch />
          {stillProvider === 'openai' ? (
            <OpenAiKeyFields framed={false} />
          ) : (
            <p>
              {hasKey
                ? `Pollinations is on. An OpenAI key is saved ${hint}. Switch to OpenAI to use it.`
                : 'Pollinations is on. Generate does not need an OpenAI key.'}
            </p>
          )}
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Chat bridge</p>
        <div className="mb-5 space-y-2 rounded-2xl border border-white/10 p-3 text-sm text-white/70">
          <p>
            Status:{' '}
            <span className={cn(bridgeConfigured && chatStatus !== 'error' ? 'text-cyan-100' : 'text-rose-200')}>
              {chatStatusLine}
            </span>
          </p>
          {resolvedChatBase ? (
            <p className="font-mono text-[11px] break-all text-white/45">{resolvedChatBase}</p>
          ) : (
            <p className="text-xs text-white/45">No API base — the live Space is {DEFAULT_CHAT_API_BASE}.</p>
          )}
          {chatError ? <p className="text-xs text-rose-200">{chatError}</p> : null}
          <p className="text-xs leading-relaxed text-white/55">
            Chief of Staff answers here for real via the live Hugging Face Space{' '}
            <span className="font-mono text-white/70">{DEFAULT_CHAT_API_BASE}</span>
            {' '}(
            <a
              className="text-cyan-200/80 underline decoration-cyan-400/30"
              href="https://huggingface.co/spaces/Simzy/command-center-chat"
              target="_blank"
              rel="noreferrer"
            >
              Simzy/command-center-chat
            </a>
            ). You do not have to type that URL — empty vault falls back to it. Set GROK_WEBHOOK_URL and
            GROK_WEBHOOK_SENDER_KEY on the Space, not here. Optional override below. Never paste webhook secrets.
          </p>
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={chatDraft}
            onChange={(e) => {
              setChatDraft(e.target.value);
              setChatMsg('');
            }}
            placeholder={chatApiBase || DEFAULT_CHAT_API_BASE}
            className="hud-input w-full"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="hud-btn-primary flex-1"
              onClick={() => {
                if (saveChatApiBase(chatDraft)) {
                  setChatDraft('');
                  setChatMsg('Saved on this device only.');
                  useChatStore.getState().clearError();
                } else {
                  setChatMsg('Paste the Hugging Face Space URL first.');
                }
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="hud-btn-ghost flex-1"
              onClick={() => {
                clearChatApiBase();
                setChatDraft('');
                setChatMsg(`Cleared override. Using ${DEFAULT_CHAT_API_BASE}.`);
              }}
            >
              Clear
            </button>
          </div>
          {chatMsg ? <p className="text-xs text-cyan-200/80">{chatMsg}</p> : null}
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Flags</p>
        <label className="mb-4 flex items-center justify-between text-sm">
          <span>Trading stub</span>
          <input type="checkbox" checked={flags.tradingStub} onChange={(e) => setFlag('tradingStub', e.target.checked)} />
        </label>
        <label className="mb-6 flex items-center justify-between text-sm">
          <span>Observe Only overlay</span>
          <input type="checkbox" checked={observeOnly} onChange={(e) => setObserveOnly(e.target.checked)} />
        </label>
        <p className="font-mono text-[11px] leading-relaxed text-white/40">
          Default is Use mode. Observe Only never blocks commands. No live wallets, no fake markets, no App Store build.
        </p>
          </>
        )}
      </aside>
    </>
  );
}
