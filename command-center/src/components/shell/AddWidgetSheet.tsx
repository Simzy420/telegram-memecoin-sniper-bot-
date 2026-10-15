import { useEffect, useState } from 'react';
import { listWidgets } from '@/registry';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';
import { X } from 'lucide-react';

export function AddWidgetSheet() {
  const open = useSessionStore((s) => s.addOpen);
  const setAddOpen = useSessionStore((s) => s.setAddOpen);
  const flags = useSessionStore((s) => s.flags);
  const board = useSessionStore((s) => s.board);
  const activeId = useProfileStore((s) => s.activeId);
  const activeName = useProfileStore((s) => s.activeName);
  const addWidget = useProfileStore((s) => s.addWidget);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!open) setNotice('');
  }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg max-h-[min(70vh,36rem)] overflow-y-auto rounded-3xl border border-cyan-400/25 bg-[#0a1028] p-4 shadow-glow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-[0.2em] text-cyan-200">Add widget</h2>
          <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg p-2 hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        {activeName ? (
          <p className="mb-3 text-xs text-white/50">Adding to {activeName}. This board is saved on your profile.</p>
        ) : (
          <p className="mb-3 text-xs text-white/50">Casey's board is view only. Sign in to build your own.</p>
        )}
        {notice ? <p className="mb-3 text-xs text-rose-200">{notice}</p> : null}
        <ul className="grid grid-cols-1 gap-2">
          {listWidgets(flags).map((def) => (
            <li key={def.type}>
              <button
                type="button"
                data-add-widget={def.type}
                data-private-app={def.privateApp ? 'true' : 'false'}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left hover:border-cyan-400/40"
                onClick={() => {
                  const size = {
                    w: def.defaultSize.w,
                    h: def.defaultSize.h,
                    settings: def.defaultSettings,
                  };
                  if (!activeId) {
                    setNotice('Sign in to add widgets to your own board.');
                    return;
                  }
                  addWidget(board, def.type, size);
                  setNotice('');
                  setAddOpen(false);
                }}
              >
                <p
                  className={
                    def.titleStyle
                      ? 'flex items-center gap-2 text-lg text-white'
                      : 'flex items-center gap-2 font-display text-sm uppercase tracking-widest text-white'
                  }
                  style={def.titleStyle}
                >
                  {def.title}
                  {def.privateApp ? (
                    <span className="rounded-full border border-amber-300/40 px-2 py-0.5 font-sans text-[9px] font-bold uppercase tracking-widest text-amber-200">
                      Private
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-white/50">{def.description}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
