import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureRobinhoodWidgets } from './ensureRobinhood.ts';
import type { LayoutDocument } from '../types/layout.ts';

function doc(widgets: LayoutDocument['widgets'] = []): LayoutDocument {
  return {
    version: 1,
    boards: [
      { id: 'home', title: 'Home' },
      { id: 'trading', title: 'Trading' },
    ],
    widgets,
    updatedAt: 1,
  };
}

test('adds robinhood to home and trading without duplicating', () => {
  let n = 0;
  const first = ensureRobinhoodWidgets(doc(), () => `w_${++n}`);
  assert.deepEqual(
    first.widgets.map((widget) => widget.page),
    ['home', 'trading'],
  );
  assert.equal(first.widgets[0]?.type, 'robinhood');
  assert.equal(first.widgets[0]?.w, 12);
  assert.equal(first.widgets[1]?.y, 0);
  const again = ensureRobinhoodWidgets(first, () => 'w_extra');
  assert.equal(again, first);
});

test('fills only the board that is missing the widget', () => {
  const homeOnly = doc([
    {
      id: 'w_home',
      type: 'robinhood',
      x: 0,
      y: 4,
      w: 12,
      h: 10,
      page: 'home',
      settings: {},
    },
  ]);
  const next = ensureRobinhoodWidgets(homeOnly, () => 'w_trading');
  assert.equal(next.widgets.length, 2);
  assert.equal(next.widgets[1]?.page, 'trading');
  assert.equal(next.widgets[1]?.id, 'w_trading');
});
