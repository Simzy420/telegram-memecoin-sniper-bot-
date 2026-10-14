export const BOARD_IDS = ['home', 'trading', 'bots', 'media', 'links'] as const;
export type BoardId = (typeof BOARD_IDS)[number];

export type WidgetType =
  | 'chat'
  | 'files'
  | 'todo'
  | 'links'
  | 'imagegen'
  | 'gallery'
  | 'watchlist'
  | 'robinhood'
  | 'gmail'
  | 'game'
  | 'drive'
  | 'trading'
  | 'compute';

export interface WidgetInstance {
  id: string;
  type: WidgetType | string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: BoardId;
  settings: Record<string, unknown>;
}

export interface Board {
  id: BoardId;
  title: string;
}

export interface LayoutDocument {
  version: 1;
  boards: Board[];
  widgets: WidgetInstance[];
  updatedAt: number;
}

export interface WidgetAnchor {
  id: string;
  type: string;
  cx: number;
  cy: number;
}

export const DEFAULT_BOARDS: Board[] = [
  { id: 'home', title: 'Home' },
  { id: 'trading', title: 'Trading' },
  { id: 'bots', title: 'Bots' },
  { id: 'media', title: 'Media' },
  { id: 'links', title: 'Links' },
];
