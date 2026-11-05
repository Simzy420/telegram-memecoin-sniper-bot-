import { AddWidgetSheet } from '@/components/shell/AddWidgetSheet';
import { BoardSwitcher } from '@/components/shell/BoardSwitcher';
import { EntitySwarm } from '@/components/shell/EntitySwarm';
import { GridBoard } from '@/components/shell/GridBoard';
import { MobileDock } from '@/components/shell/MobileDock';
import { PreviewBanner } from '@/components/shell/PreviewBanner';
import { SideDrawer } from '@/components/shell/SideDrawer';
import { TopBar } from '@/components/shell/TopBar';
import { useEffect } from 'react';
import { useProfileStore } from '@/store/profileStore';
import { useSessionStore } from '@/store/sessionStore';

export default function App() {
  const mode = useSessionStore((s) => s.mode);
  const observeOnly = useSessionStore((s) => s.observeOnly);
  const hydrate = useProfileStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="app-shell min-h-dvh">
      <PreviewBanner />
      <TopBar />
      <EntitySwarm />
      <BoardSwitcher />
      <GridBoard />
      <footer className="px-4 pb-28 pt-4 text-center">
        <p className="font-display text-sm font-bold uppercase tracking-[0.35em] text-amber-300">Concept demo</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
          Mode: {mode === 'edit' ? 'Edit' : observeOnly ? 'Observe only' : 'Use'} · iPhone PWA
        </p>
      </footer>
      <MobileDock />
      <SideDrawer />
      <AddWidgetSheet />
    </div>
  );
}
