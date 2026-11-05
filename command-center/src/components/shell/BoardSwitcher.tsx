import { DEFAULT_BOARDS } from '@/types/layout';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/sessionStore';

export function BoardSwitcher() {
  const board = useSessionStore((s) => s.board);
  const setBoard = useSessionStore((s) => s.setBoard);
  const current = DEFAULT_BOARDS.find((b) => b.id === board);

  return (
    <div className="mx-3 mt-3">
      <div className="flex items-end justify-between gap-2">
        <p className="font-display text-lg font-bold uppercase tracking-[0.18em] text-cyan-300">Data streams</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">Board: {current?.title}</p>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {DEFAULT_BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={cn('hud-chip shrink-0', board === b.id && 'hud-chip-on')}
            onClick={() => setBoard(b.id)}
          >
            {b.title}
          </button>
        ))}
      </div>
    </div>
  );
}
