import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFileSave, MAX_FILE_CHARS } from './fileDocument.ts';
import type { FileNode } from './filesStore.ts';

const note: FileNode = {
  id: 'file_1',
  name: 'Plan',
  kind: 'file',
  parentId: null,
  content: '',
  updatedAt: 1,
};

test('saving a file updates the contents kept on this device', () => {
  const saved = applyFileSave([note], 'file_1', 'Buy milk', 20);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.nodes[0]?.content, 'Buy milk');
  assert.equal(saved.nodes[0]?.updatedAt, 20);
});

test('saving refuses a missing file and an oversized file', () => {
  assert.equal(applyFileSave([note], 'missing', 'x').ok, false);
  const huge = applyFileSave([note], 'file_1', 'a'.repeat(MAX_FILE_CHARS + 1));
  assert.equal(huge.ok, false);
  if (huge.ok) return;
  assert.match(huge.error, /too long/);
});
