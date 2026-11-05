import type { BoardId, LayoutDocument, WidgetInstance } from '../types/layout';

const BOARDS: { page: BoardId; h: number }[] = [
  { page: 'home', h: 10 },
  { page: 'trading', h: 10 },
];

/** Append a full-width Robinhood widget to home and trading when that board lacks one. */
export function ensureRobinhoodWidgets(doc: LayoutDocument, createId: () => string): LayoutDocument {
  let widgets = doc.widgets;
  for (const spec of BOARDS) {
    if (widgets.some((widget) => widget.page === spec.page && widget.type === 'robinhood')) continue;
    const y = widgets
      .filter((widget) => widget.page === spec.page)
      .reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
    const next: WidgetInstance = {
      id: createId(),
      type: 'robinhood',
      x: 0,
      y,
      w: 12,
      h: spec.h,
      page: spec.page,
      settings: {},
    };
    widgets = [...widgets, next];
  }
  if (widgets === doc.widgets) return doc;
  return { ...doc, widgets };
}
