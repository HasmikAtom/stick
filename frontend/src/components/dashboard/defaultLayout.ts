import type { StoredLayout } from './types';

export const defaultLayout: StoredLayout = {
  version: 1,
  widgets: [
    { i: 'active',   x: 0, y: 0, w: 8, h: 8 },
    { i: 'quickAdd', x: 8, y: 0, w: 4, h: 3 },
    { i: 'storage',  x: 8, y: 3, w: 4, h: 3 },
    { i: 'recent',   x: 8, y: 6, w: 4, h: 5 },
  ],
};
