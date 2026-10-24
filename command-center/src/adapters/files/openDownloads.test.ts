import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANDROID_DOWNLOADS_URL,
  IOS_FILES_APP_URL,
  IOS_ICLOUD_DOWNLOADS_URL,
  detectDownloadsPlatform,
  downloadsOpenMessage,
  downloadsOpenTargets,
  openDeviceDownloads,
} from './openDownloads.ts';

test('platform detection covers phone and desktop user agents', () => {
  assert.equal(detectDownloadsPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(detectDownloadsPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(detectDownloadsPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
  assert.equal(detectDownloadsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), 'other');
  assert.equal(
    detectDownloadsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 5),
    'ios',
  );
});

test('iOS opens iCloud Downloads then the Files app root', () => {
  assert.deepEqual(downloadsOpenTargets('ios'), [IOS_ICLOUD_DOWNLOADS_URL, IOS_FILES_APP_URL]);
  assert.match(IOS_ICLOUD_DOWNLOADS_URL, /^shareddocuments:\/\//);
  assert.match(IOS_ICLOUD_DOWNLOADS_URL, /Downloads$/);
});

test('Android opens the primary Download document URI', () => {
  assert.deepEqual(downloadsOpenTargets('android'), [ANDROID_DOWNLOADS_URL]);
  assert.match(ANDROID_DOWNLOADS_URL, /^content:\/\//);
  assert.match(ANDROID_DOWNLOADS_URL, /Download$/);
});

test('openDeviceDownloads tries targets in order and reports a clear message', () => {
  const tried: string[] = [];
  const result = openDeviceDownloads({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    openUrl: (url) => {
      tried.push(url);
      return url === IOS_FILES_APP_URL;
    },
  });
  assert.deepEqual(tried, [IOS_ICLOUD_DOWNLOADS_URL, IOS_FILES_APP_URL]);
  assert.equal(result.opened, true);
  assert.match(result.message, /Files app/);
});

test('desktop gets guidance instead of a custom scheme', () => {
  const result = openDeviceDownloads({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    openUrl: () => {
      throw new Error('should not open');
    },
  });
  assert.equal(result.opened, false);
  assert.match(downloadsOpenMessage('other', false), /browser’s downloads/);
  assert.match(result.message, /browser’s downloads/);
});
