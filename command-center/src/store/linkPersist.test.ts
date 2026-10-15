import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setPersistEnabled, writeJson } from './persist';
import {
  LINKS_LOCAL_STORAGE_KEY,
  chooseLinkSnapshot,
  parseLinkSnapshot,
  readStoredLinks,
  writeStoredLinks,
  type LinkTile,
} from './linkPersist';

const tile = (id: string, title = id): LinkTile => ({
  id,
  title,
  url: `https://${id}.example`,
  color: '#22e9ff',
});

function installMemoryStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
  return store;
}

afterEach(() => {
  setPersistEnabled(true);
  Reflect.deleteProperty(globalThis, 'localStorage');
});

test('parseLinkSnapshot reads a legacy bare array and the envelope', () => {
  const legacy = parseLinkSnapshot([tile('a'), { id: 1 }, null]);
  assert.deepEqual(legacy, { tiles: [tile('a')], updatedAt: 0 });

  const envelope = parseLinkSnapshot({ tiles: [tile('b')], updatedAt: 12 });
  assert.deepEqual(envelope, { tiles: [tile('b')], updatedAt: 12 });
  assert.equal(parseLinkSnapshot({ nope: true }), null);
});

test('chooseLinkSnapshot prefers the newer copy and otherwise the longer primary', () => {
  const older = { tiles: [tile('a')], updatedAt: 1 };
  const newer = { tiles: [tile('b'), tile('c')], updatedAt: 2 };
  assert.deepEqual(chooseLinkSnapshot(older, newer), newer);
  assert.deepEqual(chooseLinkSnapshot(newer, older), newer);
  assert.deepEqual(chooseLinkSnapshot(null, older), older);
  assert.deepEqual(chooseLinkSnapshot(null, null), { tiles: [], updatedAt: 0 });

  const primary = { tiles: [tile('a')], updatedAt: 5 };
  const more = { tiles: [tile('a'), tile('b')], updatedAt: 5 };
  assert.deepEqual(chooseLinkSnapshot(primary, more).tiles.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(chooseLinkSnapshot(more, primary).tiles.map((item) => item.id), ['a', 'b']);
});

test('guest mode still persists link tiles', async () => {
  const store = installMemoryStorage();
  store.set(
    LINKS_LOCAL_STORAGE_KEY,
    JSON.stringify([tile('maps'), tile('mail')]),
  );

  setPersistEnabled(false);
  const loaded = await readStoredLinks();
  assert.deepEqual(
    loaded.tiles.map((item) => item.id),
    ['maps', 'mail'],
  );

  const written = await writeStoredLinks([...loaded.tiles, tile('notes')]);
  assert.equal(written.ok, true);

  writeJson('links', []);
  const again = await readStoredLinks();
  assert.deepEqual(
    again.tiles.map((item) => item.id),
    ['maps', 'mail', 'notes'],
  );
  assert.equal(store.has(LINKS_LOCAL_STORAGE_KEY), true);
});

test('failed storage write reports failure and leaves the previous list in place', async () => {
  const store = installMemoryStorage();
  const first = await writeStoredLinks([tile('keep')]);
  assert.equal(first.ok, true);
  const raw = store.get(LINKS_LOCAL_STORAGE_KEY);

  localStorage.setItem = () => {
    throw new Error('quota');
  };
  const failed = await writeStoredLinks([tile('keep'), tile('new')]);
  assert.equal(failed.ok, false);
  assert.equal(store.get(LINKS_LOCAL_STORAGE_KEY), raw);

  const still = await readStoredLinks();
  assert.deepEqual(
    still.tiles.map((item) => item.id),
    ['keep'],
  );
});
