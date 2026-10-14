import type { WidgetInstance } from '@/types/layout';

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export const DESKTOP_COLS = 12;
export const PHONE_COLS = 2;
export const PHONE_BREAKPOINT = 768;

export function isPhoneWidth(width: number): boolean {
  return width < PHONE_BREAKPOINT;
}

export function colsForWidth(width: number): number {
  return isPhoneWidth(width) ? PHONE_COLS : DESKTOP_COLS;
}

/** Map stored 12-col widgets onto the live grid (2-col phone or 12-col desktop). */
export function toGridLayout(widgets: WidgetInstance[], cols: number): GridItem[] {
  if (cols === DESKTOP_COLS) {
    return widgets.map((w) => ({
      i: w.id,
      x: clamp(w.x, 0, DESKTOP_COLS - 1),
      y: Math.max(0, w.y),
      w: clamp(w.w, 1, DESKTOP_COLS),
      h: Math.max(1, w.h),
      minW: 1,
      minH: 2,
    }));
  }

  return widgets
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((w) => {
      const full = w.w >= 6;
      return {
        i: w.id,
        x: full ? 0 : w.x >= 6 ? 1 : 0,
        y: Math.max(0, w.y),
        w: full ? 2 : 1,
        h: Math.max(2, w.h),
        minW: 1,
        minH: 2,
      };
    });
}

/** Persist live grid coordinates back to the 12-col JSON store. */
export function fromGridLayout(
  items: GridItem[],
  widgets: WidgetInstance[],
  cols: number,
): Pick<WidgetInstance, 'id' | 'x' | 'y' | 'w' | 'h'>[] {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  return items.map((item) => {
    const prev = byId.get(item.i);
    if (cols === DESKTOP_COLS) {
      return {
        id: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      };
    }
    const wasFull = (prev?.w ?? 12) >= 6;
    const full = item.w >= 2 || wasFull && item.w !== 1;
    return {
      id: item.i,
      x: item.x === 0 ? 0 : 6,
      y: item.y,
      w: item.w >= 2 || full ? 12 : 6,
      h: item.h,
    };
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
