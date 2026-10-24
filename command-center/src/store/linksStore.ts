import { create } from 'zustand';
import { uid } from '@/lib/ids';
import {
  LINKS_LOCAL_STORAGE_KEY,
  readLocalSnapshot,
  readStoredLinks,
  sameLinkTiles,
  writeStoredLinks,
  type LinkTile,
} from '@/store/linkPersist';

export type { LinkTile };

const COLORS = ['#22e9ff', '#e879f9', '#a78bfa', '#f5c542', '#4ade80'];
const SAVE_ERROR = "Couldn't save links on this device.";

export type SaveNotice = 'idle' | 'saved' | 'error';

interface LinksState {
  tiles: LinkTile[];
  saveNotice: SaveNotice;
  saveError: string | null;
  add: (title: string, url: string) => void;
  remove: (id: string) => void;
  rehydrate: () => Promise<void>;
}

let writesInFlight = 0;
let dirty = false;
let hydrated = false;
/** True after add/remove in this page session. Boot rehydrate must not treat the sync cache as newer than IndexedDB. */
let edited = false;
let lastAckedAt = readLocalSnapshot()?.updatedAt ?? 0;
let savedTimer = 0;
let writeQueue: Promise<void> = Promise.resolve();

function showSaved() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    if (useLinksStore.getState().saveNotice === 'saved') {
      useLinksStore.setState({ saveNotice: 'idle' });
    }
  }, 2000);
}

function applySaveResult(ok: boolean, tiles: LinkTile[], quiet: boolean) {
  if (!sameLinkTiles(useLinksStore.getState().tiles, tiles)) return;
  if (ok) {
    dirty = false;
    if (quiet) {
      if (useLinksStore.getState().saveNotice === 'error') {
        useLinksStore.setState({ saveNotice: 'idle', saveError: null });
      }
      return;
    }
    useLinksStore.setState({ saveNotice: 'saved', saveError: null });
    showSaved();
    return;
  }
  dirty = true;
  useLinksStore.setState({ saveNotice: 'error', saveError: SAVE_ERROR });
}

function persist(tiles: LinkTile[], quiet = false) {
  writesInFlight += 1;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const latest = useLinksStore.getState().tiles;
      const toSave = sameLinkTiles(latest, tiles) ? tiles : latest;
      try {
        const result = await writeStoredLinks(toSave);
        if (result.ok && sameLinkTiles(useLinksStore.getState().tiles, toSave)) {
          lastAckedAt = Math.max(lastAckedAt, result.updatedAt);
        }
        applySaveResult(result.ok, toSave, quiet);
      } catch {
        applySaveResult(false, toSave, quiet);
      }
    })
    .finally(() => {
      writesInFlight -= 1;
      hydrated = true;
    });
}

export const useLinksStore = create<LinksState>((set, get) => ({
  tiles: readLocalSnapshot()?.tiles ?? [],
  saveNotice: 'idle',
  saveError: null,
  add: (title, url) => {
    const tiles = [
      ...get().tiles,
      {
        id: uid('link'),
        title,
        url,
        color: COLORS[get().tiles.length % COLORS.length],
      },
    ];
    edited = true;
    set({ tiles });
    persist(tiles);
  },
  remove: (id) => {
    const tiles = get().tiles.filter((tile) => tile.id !== id);
    edited = true;
    set({ tiles });
    persist(tiles);
  },
  rehydrate: async () => {
    if (writesInFlight > 0 || dirty) return;
    let snapshot;
    try {
      snapshot = await readStoredLinks();
    } catch {
      hydrated = true;
      return;
    }
    if (writesInFlight > 0 || dirty) return;
    const current = get().tiles;

    // A remount or storage race can leave memory empty while disk still has the list.
    if (current.length === 0 && snapshot.tiles.length > 0) {
      set({ tiles: snapshot.tiles });
      lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      hydrated = true;
      return;
    }

    if (!edited) {
      // An empty read must not clear tiles already loaded from the other store.
      if (snapshot.tiles.length === 0 && current.length > 0) {
        persist(current, true);
      } else if (!sameLinkTiles(current, snapshot.tiles)) {
        set({ tiles: snapshot.tiles });
        lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      } else {
        lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      }
      hydrated = true;
      return;
    }

    if (snapshot.updatedAt > lastAckedAt && snapshot.tiles.length > 0 && !sameLinkTiles(current, snapshot.tiles)) {
      set({ tiles: snapshot.tiles });
      lastAckedAt = snapshot.updatedAt;
      hydrated = true;
      return;
    }

    if (current.length > 0 && !sameLinkTiles(current, snapshot.tiles)) persist(current, true);
    hydrated = true;
  },
}));

if (typeof window !== 'undefined') {
  const rehydrate = () => {
    void useLinksStore.getState().rehydrate();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rehydrate();
  });
  window.addEventListener('focus', rehydrate);
  window.addEventListener('pageshow', rehydrate);
  window.addEventListener('pagehide', () => {
    if (!hydrated || writesInFlight > 0) return;
    const tiles = useLinksStore.getState().tiles;
    // Don't stamp an empty list over a store we haven't edited; a late empty flush can wipe IndexedDB.
    if (tiles.length === 0 && !edited) return;
    const local = readLocalSnapshot();
    if (local && sameLinkTiles(local.tiles, tiles)) return;
    void writeStoredLinks(tiles).then((result) => {
      if (result.ok) lastAckedAt = Math.max(lastAckedAt, result.updatedAt);
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === LINKS_LOCAL_STORAGE_KEY) rehydrate();
  });
  rehydrate();
}
