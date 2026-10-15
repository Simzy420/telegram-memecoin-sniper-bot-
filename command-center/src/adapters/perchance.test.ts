import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PERCHANCE_PHOTO_URL } from './perchance.ts';

test('Perchance stays a new-tab link and does not replace the image models', () => {
  assert.equal(PERCHANCE_PHOTO_URL, 'https://perchance.org/ai-photo-generator');
  const widget = readFileSync('src/components/widgets/ImageGenWidget.tsx', 'utf8');
  assert.match(widget, /Perchance \(free\)/);
  assert.match(widget, /normal-case/);
  assert.match(widget, /target="_blank"/);
  assert.match(widget, /PERCHANCE_PHOTO_URL/);
  assert.match(widget, /setModel\('stills'\)/);
  assert.match(widget, /setModel\('wan22'\)/);
  assert.match(widget, /setModel\('wanExtend'\)/);
  assert.match(widget, /setModel\('swapr'\)/);
  assert.match(widget, /setModel\('swaprMix'\)/);
  assert.match(widget, /Swapr Mix/);
  const model = readFileSync('src/store/imageModel.ts', 'utf8');
  assert.equal(model.includes('perchance'), false);
});
