import { create } from 'zustand';
import { uid } from '@/lib/ids';
import {
  kindFromMimeOrName,
  kindFromUrl,
  MAX_GALLERY_FILE_BYTES,
  readFileAsDataUrl,
  readStoredGallery,
  sameGalleryItems,
  writeStoredGallery,
  type GalleryItem,
  type GalleryKind,
} from '@/store/galleryPersist';

export type { GalleryItem, GalleryKind };

const SAVE_ERROR = "Couldn't save the gallery on this device.";
const FILE_TOO_LARGE = `Each file must be under ${Math.round(MAX_GALLERY_FILE_BYTES / (1024 * 1024))} MB.`;

export type GallerySaveNotice = 'idle' | 'saved' | 'error';

interface GalleryState {
  items: GalleryItem[];
  hydrated: boolean;
  busy: boolean;
  saveNotice: GallerySaveNotice;
  saveError: string | null;
  addFiles: (files: FileList | File[]) => Promise<{ added: number; skipped: number }>;
  addUrl: (url: string, name?: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
  rehydrate: () => Promise<void>;
}

let writesInFlight = 0;
let dirty = false;
let edited = false;
let lastAckedAt = 0;
let savedTimer = 0;
let writeQueue: Promise<void> = Promise.resolve();

function showSaved() {
  if (typeof window === 'undefined') return;
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    if (useGalleryStore.getState().saveNotice === 'saved') {
      useGalleryStore.setState({ saveNotice: 'idle' });
    }
  }, 2000);
}

function applySaveResult(ok: boolean, items: GalleryItem[], quiet: boolean) {
  if (!sameGalleryItems(useGalleryStore.getState().items, items)) return;
  if (ok) {
    dirty = false;
    if (quiet) {
      if (useGalleryStore.getState().saveNotice === 'error') {
        useGalleryStore.setState({ saveNotice: 'idle', saveError: null });
      }
      return;
    }
    useGalleryStore.setState({ saveNotice: 'saved', saveError: null });
    showSaved();
    return;
  }
  dirty = true;
  useGalleryStore.setState({ saveNotice: 'error', saveError: SAVE_ERROR });
}

function persist(items: GalleryItem[], quiet = false) {
  writesInFlight += 1;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const latest = useGalleryStore.getState().items;
      const toSave = sameGalleryItems(latest, items) ? items : latest;
      try {
        const result = await writeStoredGallery(toSave);
        if (result.ok && sameGalleryItems(useGalleryStore.getState().items, toSave)) {
          lastAckedAt = Math.max(lastAckedAt, result.updatedAt);
        }
        applySaveResult(result.ok, toSave, quiet);
      } catch {
        applySaveResult(false, toSave, quiet);
      }
    })
    .finally(() => {
      writesInFlight -= 1;
    });
  return writeQueue;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  return `https://${trimmed}`;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  items: [],
  hydrated: false,
  busy: false,
  saveNotice: 'idle',
  saveError: null,
  clearError: () => set({ saveError: null, saveNotice: 'idle' }),
  addFiles: async (files) => {
    const list = Array.from(files);
    if (!list.length) return { added: 0, skipped: 0 };
    set({ busy: true, saveError: null });
    const next = [...get().items];
    let added = 0;
    let skipped = 0;
    try {
      for (const file of list) {
        const kind = kindFromMimeOrName(file.type, file.name);
        if (!kind) {
          skipped += 1;
          continue;
        }
        if (file.size > MAX_GALLERY_FILE_BYTES) {
          skipped += 1;
          set({ saveNotice: 'error', saveError: FILE_TOO_LARGE });
          continue;
        }
        try {
          const src = await readFileAsDataUrl(file);
          if (!src) {
            skipped += 1;
            continue;
          }
          next.unshift({
            id: uid('gal'),
            kind,
            name: file.name || (kind === 'video' ? 'Video' : 'Photo'),
            src,
            createdAt: Date.now(),
          });
          added += 1;
        } catch {
          skipped += 1;
        }
      }
      if (added > 0) {
        edited = true;
        set({ items: next });
        await persist(next);
      }
      return { added, skipped };
    } finally {
      set({ busy: false });
    }
  },
  addUrl: async (url, name) => {
    const href = normalizeUrl(url);
    if (!href) return false;
    const kind = kindFromUrl(href);
    const item: GalleryItem = {
      id: uid('gal'),
      kind,
      name: name?.trim() || (kind === 'video' ? 'Video' : 'Photo'),
      src: href,
      createdAt: Date.now(),
    };
    const items = [item, ...get().items];
    edited = true;
    set({ items, saveError: null });
    await persist(items);
    return true;
  },
  remove: async (id) => {
    const items = get().items.filter((item) => item.id !== id);
    edited = true;
    set({ items });
    await persist(items);
  },
  rehydrate: async () => {
    if (writesInFlight > 0 || dirty) return;
    let snapshot;
    try {
      snapshot = await readStoredGallery();
    } catch {
      set({ hydrated: true });
      return;
    }
    if (writesInFlight > 0 || dirty) return;
    const current = get().items;

    if (current.length === 0 && snapshot.items.length > 0) {
      set({ items: snapshot.items, hydrated: true });
      lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      return;
    }

    if (!edited) {
      if (snapshot.items.length === 0 && current.length > 0) {
        await persist(current, true);
      } else if (!sameGalleryItems(current, snapshot.items)) {
        set({ items: snapshot.items });
        lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      } else {
        lastAckedAt = Math.max(lastAckedAt, snapshot.updatedAt);
      }
      set({ hydrated: true });
      return;
    }

    if (
      snapshot.updatedAt > lastAckedAt &&
      snapshot.items.length > 0 &&
      !sameGalleryItems(current, snapshot.items)
    ) {
      set({ items: snapshot.items, hydrated: true });
      lastAckedAt = snapshot.updatedAt;
      return;
    }

    if (current.length > 0 && !sameGalleryItems(current, snapshot.items)) await persist(current, true);
    set({ hydrated: true });
  },
}));

if (typeof window !== 'undefined') {
  const rehydrate = () => {
    void useGalleryStore.getState().rehydrate();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rehydrate();
  });
  window.addEventListener('focus', rehydrate);
  window.addEventListener('pageshow', rehydrate);
  rehydrate();
}
