import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ARTIFACT =
  'https://claude.ai/code/artifact/e0be7c72-8356-45f3-a242-90e73c1ff645?org=ab3580a3-ad7b-4517-a457-271ef6ae591c';

test('Game opens the Claude artifact in a new tab', () => {
  const widget = readFileSync('src/components/widgets/GameWidget.tsx', 'utf8');
  const registry = readFileSync('src/registry/index.ts', 'utf8');
  assert.equal(widget.includes(ARTIFACT), true);
  assert.match(widget, /target="_blank"/);
  assert.match(widget, /rel="noopener noreferrer"/);
  assert.match(widget, /title=\{GAME_TITLE\}/);
  assert.match(widget, /GAME_TITLE = 'Game'/);
  assert.match(registry, /type: 'game'/);
  assert.match(registry, /title: GAME_TITLE/);
  assert.equal(registry.includes("featureFlag: 'game'"), false);
});
