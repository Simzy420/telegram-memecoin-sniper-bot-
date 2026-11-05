import { create } from 'zustand';
import {
  loadAccountSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveAccountLayout,
} from '@/adapters/accounts/client';
import { lockDriveSession } from '@/adapters/drive/client';
import { withGalleryForOlderBoard } from '@/data/ensureGallery';
import { createStarterLayout } from '@/data/starterLayout';
import { uid } from '@/lib/ids';
import { fromGridLayout, type GridItem } from '@/lib/grid';
import type { BoardId, LayoutDocument, WidgetInstance } from '@/types/layout';

let saveChain: Promise<void> = Promise.resolve();

async function dropDriveSession() {
  if (typeof location === 'undefined') return;
  await lockDriveSession(location.hostname);
}

function queueSave(
  layout: LayoutDocument,
  set: (partial: Partial<ProfileState>) => void,
) {
  saveChain = saveChain
    .catch(() => undefined)
    .then(async () => {
      await saveAccountLayout(layout);
      set({ saveError: '' });
    })
    .catch((err: unknown) => {
      set({ saveError: err instanceof Error ? err.message : 'Could not save this board.' });
    });
}

interface ProfileState {
  activeId: string | null;
  activeName: string;
  layout: LayoutDocument | null;
  saveError: string;
  hydrate: () => Promise<void>;
  createAccount: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  addWidget: (
    page: BoardId,
    type: string,
    opts?: { w?: number; h?: number; settings?: Record<string, unknown> },
  ) => void;
  removeWidget: (id: string) => void;
  moveWidgets: (page: BoardId, items: GridItem[], cols: number) => void;
  updateSettings: (id: string, settings: Record<string, unknown>) => void;
  importLayout: (doc: LayoutDocument) => void;
  resetMyBoard: () => void;
}

function applySession(
  set: (partial: Partial<ProfileState>) => void,
  username: string,
  layout: LayoutDocument | null,
) {
  set({
    activeId: username || null,
    activeName: username,
    layout: username && layout ? withGalleryForOlderBoard(layout, () => uid('w')) : null,
    saveError: '',
  });
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  activeId: null,
  activeName: '',
  layout: null,
  saveError: '',
  hydrate: async () => {
    try {
      const session = await loadAccountSession();
      if (session.username && session.layout) applySession(set, session.username, session.layout);
    } catch {
      /* Visitors keep Casey's board when the account server is absent. */
    }
  },
  createAccount: async (username, password) => {
    const session = await registerAccount(username, password);
    await dropDriveSession();
    applySession(set, session.username, session.layout);
  },
  login: async (username, password) => {
    const session = await loginAccount(username, password);
    await dropDriveSession();
    applySession(set, session.username, session.layout);
  },
  logout: async () => {
    try {
      await logoutAccount();
    } catch {
      /* The local view still returns to Casey's board. */
    }
    await dropDriveSession();
    applySession(set, '', null);
  },
  addWidget: (page, type, opts) => {
    const { activeId, layout } = get();
    if (!activeId || !layout) throw new Error('Sign in to build your own board.');
    const pageWidgets = layout.widgets.filter((widget) => widget.page === page);
    const y = pageWidgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
    const widget: WidgetInstance = {
      id: uid('w'),
      type,
      x: 0,
      y,
      w: opts?.w ?? 6,
      h: opts?.h ?? 6,
      page,
      settings: { ...(opts?.settings ?? {}) },
    };
    const next = { ...layout, widgets: [...layout.widgets, widget], updatedAt: Date.now() };
    set({ layout: next, saveError: '' });
    queueSave(next, set);
  },
  removeWidget: (id) => {
    const { activeId, layout } = get();
    if (!activeId || !layout) return;
    const next = {
      ...layout,
      widgets: layout.widgets.filter((widget) => widget.id !== id),
      updatedAt: Date.now(),
    };
    set({ layout: next, saveError: '' });
    queueSave(next, set);
  },
  moveWidgets: (page, items, cols) => {
    const { activeId, layout } = get();
    if (!activeId || !layout) return;
    const pageWidgets = layout.widgets.filter((widget) => widget.page === page);
    const moved = new Map(fromGridLayout(items, pageWidgets, cols).map((item) => [item.id, item]));
    const next = {
      ...layout,
      widgets: layout.widgets.map((widget) => {
        const update = moved.get(widget.id);
        return update ? { ...widget, x: update.x, y: update.y, w: update.w, h: update.h } : widget;
      }),
      updatedAt: Date.now(),
    };
    set({ layout: next });
    queueSave(next, set);
  },
  updateSettings: (id, settings) => {
    const { activeId, layout } = get();
    if (!activeId || !layout) return;
    const next = {
      ...layout,
      widgets: layout.widgets.map((widget) =>
        widget.id === id ? { ...widget, settings: { ...widget.settings, ...settings } } : widget,
      ),
      updatedAt: Date.now(),
    };
    set({ layout: next });
    queueSave(next, set);
  },
  importLayout: (doc) => {
    const { activeId } = get();
    if (!activeId) throw new Error('Sign in to save a board.');
    if (!doc || doc.version !== 1 || !Array.isArray(doc.widgets)) throw new Error('Invalid layout JSON');
    const next: LayoutDocument = {
      version: 1,
      boards: doc.boards?.length ? doc.boards : createStarterLayout().boards,
      widgets: doc.widgets,
      updatedAt: Date.now(),
    };
    set({ layout: next, saveError: '' });
    queueSave(next, set);
  },
  resetMyBoard: () => {
    const { activeId } = get();
    if (!activeId) return;
    const next = createStarterLayout();
    set({ layout: next, saveError: '' });
    queueSave(next, set);
  },
}));
