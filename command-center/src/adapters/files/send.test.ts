import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSendKind, downloadName, isRemoteHttpUrl, sendResultMessage } from './send.ts';

test('send uses the share sheet when the phone can take a file', () => {
  const caps = { canShareFiles: true, canShareUrl: true, canShareText: true };
  assert.equal(chooseSendKind('hello', caps), 'share-file');
  assert.equal(chooseSendKind('https://example.com/clip.mp4', caps), 'share-url');
  assert.match(sendResultMessage('share-file', false), /share sheet/);
  assert.match(sendResultMessage('download', false), /downloads/);
});

test('send downloads when this browser cannot share', () => {
  const caps = { canShareFiles: false, canShareUrl: false, canShareText: false };
  assert.equal(chooseSendKind('hello', caps), 'download');
  assert.equal(chooseSendKind('https://cdn.example/a.mp4', caps), 'download');
  assert.equal(isRemoteHttpUrl('https://cdn.example/a.mp4'), true);
  assert.equal(isRemoteHttpUrl('not a url'), false);
});

test('download names stay plain files', () => {
  assert.equal(downloadName('Plan', false), 'Plan.txt');
  assert.equal(downloadName('notes.md', false), 'notes.md');
  assert.equal(downloadName('a/b', false), 'a b.txt');
  assert.equal(downloadName('clip.mp4', true), 'clip.mp4.txt');
});
