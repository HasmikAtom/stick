export type WidgetId = 'active' | 'quickAdd' | 'storage' | 'recent';

export interface WidgetLayout {
  i: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredLayout {
  version: 1;
  widgets: WidgetLayout[];
}

export const GRID_COLS = 12;
export const ROW_HEIGHT = 80;
export const MOBILE_BREAKPOINT_PX = 768;
