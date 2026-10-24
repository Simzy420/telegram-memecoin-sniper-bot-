import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  kindFromMimeOrName,
  kindFromUrl,
  parseGallerySnapshot,
  sanitizeGalleryItems,
  sameGalleryItems,
} from './galleryPersist.ts';

test('sanitizeGalleryItems keeps valid image and video entries', () => {
  const items = sanitizeGalleryItems([
    { id: '1', kind: 'image', name: 'a.jpg', src: 'https://example.com/a.jpg', createdAt: 1 },
    { id: '2', kind: 'video', name: 'b.mp4', src: 'data:video/mp4;base64,aaa', createdAt: 2 },
    { id: 'bad', kind: 'pdf', name: 'x', src: 'https://x' },
    null,
    { id: 3 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'image');
  assert.equal(items[1].kind, 'video');
});

test('parseGallerySnapshot accepts bare arrays and envelopes', () => {
  const bare = parseGallerySnapshot([
    { id: '1', kind: 'image', name: 'a', src: 'https://a.example/a.png', createdAt: 9 },
  ]);
  assert.equal(bare?.items.length, 1);
  assert.equal(bare?.updatedAt, 0);

  const envelope = parseGallerySnapshot({
    items: [{ id: '2', kind: 'video', name: 'clip', src: 'https://a.example/a.mp4', createdAt: 3 }],
    updatedAt: 44,
  });
  assert.equal(envelope?.updatedAt, 44);
  assert.equal(parseGallerySnapshot({ nope: true }), null);
});

test('kind helpers detect images and videos from mime, name, and url', () => {
  assert.equal(kindFromMimeOrName('image/png', 'x'), 'image');
  assert.equal(kindFromMimeOrName('video/mp4', 'x'), 'video');
  assert.equal(kindFromMimeOrName('', 'photo.WEBP'), 'image');
  assert.equal(kindFromMimeOrName('', 'clip.mov'), 'video');
  assert.equal(kindFromMimeOrName('application/pdf', 'doc.pdf'), null);
  assert.equal(kindFromUrl('https://cdn.example/a.webm'), 'video');
  assert.equal(kindFromUrl('data:image/jpeg;base64,abc'), 'image');
  assert.equal(kindFromUrl('https://cdn.example/still'), 'image');
});

test('sameGalleryItems compares identity fields', () => {
  const a = [{ id: '1', kind: 'image' as const, name: 'a', src: 'x', createdAt: 1 }];
  const b = [{ id: '1', kind: 'image' as const, name: 'a', src: 'x', createdAt: 1 }];
  const c = [{ id: '1', kind: 'image' as const, name: 'a', src: 'y', createdAt: 1 }];
  assert.equal(sameGalleryItems(a, b), true);
  assert.equal(sameGalleryItems(a, c), false);
});
