import assert from 'node:assert/strict';
import test from 'node:test';
import { GALLERY_ADDED_AT, ensureGalleryWidget, withGalleryForOlderBoard } from './ensureGallery.ts';
import type { LayoutDocument } from '../types/layout.ts';

function doc(widgets: LayoutDocument['widgets'] = []): LayoutDocument {
  return { version: 1, boards: [{ id: 'media', title: 'Media' }], widgets, updatedAt: 1 };
}

test('adds one gallery below existing Media widgets', () => {
  const base = doc([{ id: 'a', type: 'imagegen', x: 0, y: 0, w: 12, h: 14, page: 'media', settings: {} }]);
  const first = ensureGalleryWidget(base, () => 'g1');
  const gallery = first.widgets.find((w) => w.type === 'gallery');
  assert.equal(gallery?.page, 'media');
  assert.equal(gallery?.y, 14);
  assert.equal(ensureGalleryWidget(first, () => 'g2'), first);
});

test('only boards saved before the gallery shipped get it added', () => {
  const old = doc();
  assert.equal(withGalleryForOlderBoard(old, () => 'g').widgets.length, 1);
  const recent = { ...doc(), updatedAt: GALLERY_ADDED_AT + 1 };
  assert.equal(withGalleryForOlderBoard(recent, () => 'g'), recent);
});
