/** IndexedDB-backed gallery. Media stays off localStorage so large files fit. */

export type GalleryKind = 'image' | 'video';

export interface GalleryItem {
  id: string;
  kind: GalleryKind;
  name: string;
  src: string;
  createdAt: number;
}

export interface GallerySnapshot {
  items: GalleryItem[];
  updatedAt: number;
}

const IDB_NAME = 'cc.v1';
const IDB_VERSION = 1;
const IDB_STORE = 'kv';
const IDB_KEY = 'gallery';

const EMPTY: GallerySnapshot = { items: [], updatedAt: 0 };

/** Soft per-file ceiling so one upload cannot exhaust the device. Count is unlimited. */
export const MAX_GALLERY_FILE_BYTES = 12 * 1024 * 1024;

export function sameGalleryItems(a: GalleryItem[], b: GalleryItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.id === b[index].id &&
      item.kind === b[index].kind &&
      item.name === b[index].name &&
      item.src === b[index].src &&
      item.createdAt === b[index].createdAt,
  );
}

function isKind(value: unknown): value is GalleryKind {
  return value === 'image' || value === 'video';
}

export function sanitizeGalleryItems(value: unknown): GalleryItem[] {
  if (!Array.isArray(value)) return [];
  const items: GalleryItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string' || typeof rec.src !== 'string') continue;
    if (!isKind(rec.kind) || !rec.src.trim()) continue;
    const createdAt =
      typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now();
    items.push({
      id: rec.id,
      kind: rec.kind,
      name: rec.name.trim() || (rec.kind === 'video' ? 'Video' : 'Photo'),
      src: rec.src,
      createdAt,
    });
  }
  return items;
}

export function parseGallerySnapshot(value: unknown): GallerySnapshot | null {
  if (Array.isArray(value)) {
    return { items: sanitizeGalleryItems(value), updatedAt: 0 };
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as { items?: unknown; updatedAt?: unknown };
  if (!Array.isArray(rec.items)) return null;
  const updatedAt = typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;
  return { items: sanitizeGalleryItems(rec.items), updatedAt };
}

export function kindFromMimeOrName(mime: string, name: string): GalleryKind | null {
  const type = mime.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(name)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(name)) return 'video';
  return null;
}

export function kindFromUrl(url: string): GalleryKind {
  if (url.startsWith('data:video/')) return 'video';
  if (url.startsWith('data:image/')) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url)) return 'video';
  return 'image';
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch {
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = openDb().then((db) => {
      if (!db) {
        dbPromise = null;
        return null;
      }
      const drop = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        drop();
      };
      db.onclose = drop;
      return db;
    });
  }
  return dbPromise;
}

export async function readStoredGallery(): Promise<GallerySnapshot> {
  const db = await getDb();
  if (!db) return EMPTY;
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
    return parseGallerySnapshot(raw) ?? EMPTY;
  } catch {
    dbPromise = null;
    return EMPTY;
  }
}

export async function writeStoredGallery(items: GalleryItem[]): Promise<{ ok: boolean; updatedAt: number }> {
  const snapshot: GallerySnapshot = {
    items: sanitizeGalleryItems(items),
    updatedAt: Date.now(),
  };
  const db = await getDb();
  if (!db) return { ok: false, updatedAt: snapshot.updatedAt };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(snapshot, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
    return { ok: true, updatedAt: snapshot.updatedAt };
  } catch {
    dbPromise = null;
    return { ok: false, updatedAt: snapshot.updatedAt };
  }
}
