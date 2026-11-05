import type { LayoutDocument, WidgetInstance } from '../types/layout';

/** Photo gallery went live 2026-10-07. Boards saved before then never had it. */
export const GALLERY_ADDED_AT = Date.UTC(2026, 9, 7, 20, 30);

/** Add the gallery to a board saved before it shipped. Later boards keep the owner's choice. */
export function withGalleryForOlderBoard(doc: LayoutDocument, createId: () => string): LayoutDocument {
  if (!doc || !Array.isArray(doc.widgets)) return doc;
  if (Number(doc.updatedAt) >= GALLERY_ADDED_AT) return doc;
  return ensureGalleryWidget(doc, createId);
}

/** Append a full-width Photo gallery to the Media board when that board lacks one. */
export function ensureGalleryWidget(doc: LayoutDocument, createId: () => string): LayoutDocument {
  if (doc.widgets.some((widget) => widget.type === 'gallery')) return doc;
  const y = doc.widgets
    .filter((widget) => widget.page === 'media')
    .reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
  const next: WidgetInstance = {
    id: createId(),
    type: 'gallery',
    x: 0,
    y,
    w: 12,
    h: 10,
    page: 'media',
    settings: {},
  };
  return { ...doc, widgets: [...doc.widgets, next] };
}
