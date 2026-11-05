import { create } from 'zustand';
import { BOT_ROSTER, DEFAULT_BOT_ID } from '@/bots/roster';
import type { BoardId, WidgetAnchor } from '@/types/layout';
import { readJson, writeJson, setPersistEnabled } from '@/store/persist';

export type InteractionMode = 'use' | 'edit';
export type Plan = 'owner' | 'guest';

export interface FeatureFlags {
  tradingStub: boolean;
}

interface SessionSnapshot {
  plan: Plan;
  flags: FeatureFlags;
}

const KEY = 'session';

function loadSession(): SessionSnapshot {
  return readJson<SessionSnapshot>(KEY, { plan: 'owner', flags: { tradingStub: false } });
}

interface SessionState {
  board: BoardId;
  mode: InteractionMode;
  observeOnly: boolean;
  plan: Plan;
  search: string;
  activeBotId: string;
  drawerOpen: boolean;
  addOpen: boolean;
  flags: FeatureFlags;
  armedWidgetId: string | null;
  activeWidgetId: string | null;
  anchors: WidgetAnchor[];
  setBoard: (board: BoardId) => void;
  setMode: (mode: InteractionMode) => void;
  setObserveOnly: (on: boolean) => void;
  setSearch: (q: string) => void;
  setActiveBot: (id: string) => void;
  setDrawerOpen: (on: boolean) => void;
  setAddOpen: (on: boolean) => void;
  setPlan: (plan: Plan) => void;
  setFlag: (key: keyof FeatureFlags, on: boolean) => void;
  armWidget: (id: string | null) => void;
  setActiveWidget: (id: string | null) => void;
  setAnchors: (anchors: WidgetAnchor[]) => void;
}

function saveMeta(plan: Plan, flags: FeatureFlags) {
  setPersistEnabled(true);
  writeJson(KEY, { plan, flags } satisfies SessionSnapshot);
  setPersistEnabled(plan === 'owner');
}

const initial = loadSession();
// Guest mode blocks writeJson for ordinary widgets. Link tiles do not use that gate.
setPersistEnabled(initial.plan === 'owner');

export const useSessionStore = create<SessionState>((set, get) => ({
  board: 'home',
  mode: 'use',
  observeOnly: false,
  plan: initial.plan,
  search: '',
  activeBotId: BOT_ROSTER.some((b) => b.id === DEFAULT_BOT_ID) ? DEFAULT_BOT_ID : BOT_ROSTER[0].id,
  drawerOpen: false,
  addOpen: false,
  flags: initial.flags,
  armedWidgetId: null,
  activeWidgetId: null,
  anchors: [],
  setBoard: (board) => set({ board, drawerOpen: false }),
  setMode: (mode) => set({ mode, armedWidgetId: mode === 'edit' ? get().armedWidgetId : null }),
  setObserveOnly: (observeOnly) => set({ observeOnly }),
  setSearch: (search) => set({ search }),
  setActiveBot: (activeBotId) => set({ activeBotId }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setAddOpen: (addOpen) => set({ addOpen }),
  setPlan: (plan) => {
    saveMeta(plan, get().flags);
    set({ plan });
  },
  setFlag: (key, on) => {
    const flags = { ...get().flags, [key]: on };
    saveMeta(get().plan, flags);
    set({ flags });
  },
  armWidget: (armedWidgetId) => set({ armedWidgetId }),
  setActiveWidget: (activeWidgetId) => set({ activeWidgetId }),
  setAnchors: (anchors) => set({ anchors }),
}));

export function canSave(): boolean {
  return useSessionStore.getState().plan === 'owner';
}
