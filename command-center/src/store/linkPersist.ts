import { writeJsonForced } from './persist';

/** localStorage key. IndexedDB stores the same snapshot under this id. */
export const LINKS_LOCAL_STORAGE_KEY = 'cc.v1.links';

const IDB_NAME = 'cc.v1';
const IDB_VERSION = 1;
const IDB_STORE = 'kv';
const IDB_KEY = 'links';

export interface LinkTile {
  id: string;
  title: string;
  url: string;
  color: string;
}

export interface LinkSnapshot {
  tiles: LinkTile[];
  updatedAt: number;
}

const EMPTY: LinkSnapshot = { tiles: [], updatedAt: 0 };

export function sameLinkTiles(a: LinkTile[], b: LinkTile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (tile, index) =>
      tile.id === b[index].id &&
      tile.title === b[index].title &&
      tile.url === b[index].url &&
      tile.color === b[index].color,
  );
}

function sanitizeTiles(value: unknown): LinkTile[] {
  if (!Array.isArray(value)) return [];
  const tiles: LinkTile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.title !== 'string' || typeof rec.url !== 'string') continue;
    tiles.push({
      id: rec.id,
      title: rec.title,
      url: rec.url,
      color: typeof rec.color === 'string' && rec.color ? rec.color : '#22e9ff',
    });
  }
  return tiles;
}

/** Accept the legacy bare array and the `{ tiles, updatedAt }` envelope. */
export function parseLinkSnapshot(value: unknown): LinkSnapshot | null {
  if (Array.isArray(value)) {
    return { tiles: sanitizeTiles(value), updatedAt: 0 };
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as { tiles?: unknown; updatedAt?: unknown };
  if (!Array.isArray(rec.tiles)) return null;
  const updatedAt = typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;
  return { tiles: sanitizeTiles(rec.tiles), updatedAt };
}

/**
 * IndexedDB is primary. localStorage is the fallback when it is missing or newer
 * (a local write can land after IndexedDB fails, and older saves were localStorage only).
 */
export function chooseLinkSnapshot(primary: LinkSnapshot | null, fallback: LinkSnapshot | null): LinkSnapshot {
  if (!primary && !fallback) return EMPTY;
  if (!primary) return fallback ?? EMPTY;
  if (!fallback) return primary;
  if (fallback.updatedAt > primary.updatedAt) return fallback;
  if (primary.updatedAt > fallback.updatedAt) return primary;
  if (fallback.tiles.length > primary.tiles.length) return fallback;
  return primary;
}

export function readLocalSnapshot(): LinkSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LINKS_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return parseLinkSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalIfNewer(snapshot: LinkSnapshot): boolean {
  const existing = readLocalSnapshot();
  if (existing && existing.updatedAt > snapshot.updatedAt) return true;
  if (
    existing &&
    existing.updatedAt === snapshot.updatedAt &&
    sameLinkTiles(existing.tiles, snapshot.tiles)
  ) {
    return true;
  }
  return writeJsonForced('links', snapshot);
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

async function readIdbSnapshot(): Promise<LinkSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await new Promise<LinkSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(parseLinkSnapshot(req.result));
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
  } catch {
    dbPromise = null;
    return null;
  }
}

async function writeIdbIfNewer(snapshot: LinkSnapshot): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_KEY);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        const existing = parseLinkSnapshot(getReq.result);
        if (existing && existing.updatedAt > snapshot.updatedAt) return;
        if (existing && existing.updatedAt === snapshot.updatedAt && sameLinkTiles(existing.tiles, snapshot.tiles)) {
          return;
        }
        store.put(snapshot, IDB_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
    return true;
  } catch {
    dbPromise = null;
    return false;
  }
}

function needsMirror(current: LinkSnapshot | null, chosen: LinkSnapshot): boolean {
  if (chosen.updatedAt === 0 && chosen.tiles.length === 0) return false;
  if (!current) return chosen.tiles.length > 0 || chosen.updatedAt > 0;
  if (current.updatedAt < chosen.updatedAt) return true;
  if (current.updatedAt === chosen.updatedAt && current.tiles.length < chosen.tiles.length) return true;
  if (current.updatedAt === chosen.updatedAt && !sameLinkTiles(current.tiles, chosen.tiles)) return true;
  return false;
}

/** Read IndexedDB and localStorage, keep the newer copy, and backfill the stale side. */
export async function readStoredLinks(): Promise<LinkSnapshot> {
  const local = readLocalSnapshot();
  let idb: LinkSnapshot | null = null;
  try {
    idb = await readIdbSnapshot();
  } catch {
    idb = null;
  }
  const chosen = chooseLinkSnapshot(idb, local);
  if (needsMirror(idb, chosen)) await writeIdbIfNewer(chosen);
  if (needsMirror(local, chosen)) writeLocalIfNewer(chosen);
  return chosen;
}

export async function writeStoredLinks(tiles: LinkTile[]): Promise<{ ok: boolean; updatedAt: number }> {
  const snapshot: LinkSnapshot = { tiles: sanitizeTiles(tiles), updatedAt: Date.now() };
  // localStorage is synchronous so a pagehide flush still lands if the process is killed mid-await.
  const localOk = writeLocalIfNewer(snapshot);
  const idbOk = await writeIdbIfNewer(snapshot);
  return { ok: localOk || idbOk, updatedAt: snapshot.updatedAt };
}
