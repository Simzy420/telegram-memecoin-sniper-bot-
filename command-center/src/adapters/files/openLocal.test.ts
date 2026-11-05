import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FILE_CHARS } from '../../store/fileDocument.ts';
import { isLikelyTextFile, openLocalResultMessage, readLocalTextFiles } from './openLocal.ts';

test('open file accepts common text downloads and skips media', () => {
  assert.equal(isLikelyTextFile({ name: 'notes.txt', type: 'text/plain' }), true);
  assert.equal(isLikelyTextFile({ name: 'plan.md', type: '' }), true);
  assert.equal(isLikelyTextFile({ name: 'data.json', type: 'application/json' }), true);
  assert.equal(isLikelyTextFile({ name: 'clip.mp4', type: 'video/mp4' }), false);
  assert.equal(isLikelyTextFile({ name: 'shot.png', type: 'image/png' }), false);
  assert.equal(isLikelyTextFile({ name: 'clip.mp4', type: '' }), false);
  assert.equal(isLikelyTextFile({ name: 'shot.png', type: '' }), false);
});

test('open file messages cover empty, success, and skipped picks', () => {
  assert.match(openLocalResultMessage(0, 0), /No files selected/);
  assert.match(openLocalResultMessage(0, 2), /No files opened/);
  assert.match(openLocalResultMessage(1, 0), /downloads/);
  assert.match(openLocalResultMessage(2, 1), /Opened 2/);
});

test('readLocalTextFiles imports text and skips oversized or binary picks', async () => {
  const ok = new File(['Buy milk'], 'list.txt', { type: 'text/plain' });
  const media = new File(['xxxx'], 'clip.mp4', { type: 'video/mp4' });
  const unnamedMedia = new File(['xxxx'], 'shot.png', { type: '' });
  const huge = new File(['a'.repeat(MAX_FILE_CHARS + 1)], 'big.txt', { type: 'text/plain' });
  const result = await readLocalTextFiles([ok, media, unnamedMedia, huge]);
  assert.equal(result.opened.length, 1);
  assert.equal(result.opened[0]?.name, 'list.txt');
  assert.equal(result.opened[0]?.content, 'Buy milk');
  assert.equal(result.skipped, 3);
  assert.match(result.message, /Opened 1/);
});
