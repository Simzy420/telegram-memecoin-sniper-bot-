import { CheckSquare, Folder, Link2, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/sessionStore';

export function MobileDock() {
  const board = useSessionStore((s) => s.board);
  const setBoard = useSessionStore((s) => s.setBoard);
  const setDrawerOpen = useSessionStore((s) => s.setDrawerOpen);
  const setAddOpen = useSessionStore((s) => s.setAddOpen);
  const setSearch = useSessionStore((s) => s.setSearch);

  const items = [
    {
      id: 'files',
      label: 'Files',
      icon: Folder,
      run: () => {
        setSearch('files');
        setBoard('home');
      },
    },
    {
      id: 'todo',
      label: 'To-Do',
      icon: CheckSquare,
      run: () => {
        setSearch('to-do');
        setBoard('home');
      },
    },
    {
      id: 'links',
      label: 'Links',
      icon: Link2,
      run: () => {
        setSearch('');
        setBoard('links');
      },
    },
    {
      id: 'system',
      label: 'System',
      icon: Settings,
      run: () => setDrawerOpen(true),
    },
  ] as const;

  return (
    <nav className="dock pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-400/25 bg-[#070b1c]/92 px-2 py-2 shadow-glow backdrop-blur-md">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.run}
            className={cn(
              'flex min-w-[3.6rem] flex-col items-center rounded-2xl px-2 py-1 text-[10px] uppercase tracking-wider text-cyan-100/80',
              item.id === 'links' && board === 'links' && 'text-cyan-300',
            )}
          >
            <item.icon className="mb-0.5 h-5 w-5" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-slate-950 shadow-mag"
          aria-label="Add widget"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
    </nav>
  );
}
