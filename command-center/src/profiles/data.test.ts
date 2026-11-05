import assert from 'node:assert/strict';
import test from 'node:test';
import type { WidgetInstance } from '../types/layout.ts';
import {
  createProfileAccount,
  emptyProfileDatabase,
  emptyUserLayout,
  readLayout,
  readProfileSecret,
  unlockProfile,
  writeLayout,
  writeProfileSecret,
} from './data.ts';

function widget(id: string, type: string, x = 0, y = 0): WidgetInstance {
  return { id, type, x, y, w: 6, h: 6, page: 'home', settings: {} };
}

test('a saved board restores on login and does not touch the owner board', async () => {
  const owner = emptyUserLayout(1);
  owner.widgets = [widget('owner_chat', 'chat')];
  const ownerSnapshot = JSON.stringify(owner);

  let db = emptyProfileDatabase();
  const casey = await createProfileAccount(db, 'Casey', 'alpha-secret', 'profile_a');
  db = casey.db;
  const sam = await createProfileAccount(db, 'Sam', 'beta-secret', 'profile_b');
  db = sam.db;

  assert.deepEqual(readLayout(db, casey.account.id).widgets, []);
  assert.deepEqual(readLayout(db, sam.account.id).widgets, []);

  const arranged = readLayout(db, casey.account.id);
  arranged.widgets = [widget('w_files', 'files', 0, 0), widget('w_todo', 'todo', 6, 0)];
  arranged.updatedAt = 20;
  db = writeLayout(db, casey.account.id, arranged);

  const opened = await unlockProfile(db, 'Casey', 'alpha-secret');
  const restored = readLayout(db, opened.account.id);
  assert.deepEqual(
    restored.widgets.map((item) => ({ id: item.id, type: item.type, x: item.x, y: item.y })),
    [
      { id: 'w_files', type: 'files', x: 0, y: 0 },
      { id: 'w_todo', type: 'todo', x: 6, y: 0 },
    ],
  );
  assert.equal(restored.version, 1);
  assert.deepEqual(readLayout(db, sam.account.id).widgets, []);
  assert.equal(JSON.stringify(owner), ownerSnapshot);
  assert.equal(JSON.stringify(db).includes('alpha-secret'), false);
  await assert.rejects(() => unlockProfile(db, 'Casey', 'beta-secret'), /Wrong name or password/);
});

test('saved credentials stay on the account that saved them', async () => {
  let db = emptyProfileDatabase();
  const casey = await createProfileAccount(db, 'Casey', 'alpha-secret', 'profile_a');
  db = casey.db;
  const sam = await createProfileAccount(db, 'Sam', 'beta-secret', 'profile_b');
  db = sam.db;
  db = await writeProfileSecret(db, casey.account.id, casey.key, 'drive', 'drive-pass-a');
  const samOpen = await unlockProfile(db, 'Sam', 'beta-secret');
  assert.equal(await readProfileSecret(db, sam.account.id, samOpen.key, 'drive'), '');
  await assert.rejects(() => readProfileSecret(db, casey.account.id, samOpen.key, 'drive'));
  assert.equal(JSON.stringify(db.secrets).includes('drive-pass-a'), false);
});
