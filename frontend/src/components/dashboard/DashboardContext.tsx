import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import type { ReactNode } from 'react';
import { defaultLayout } from './defaultLayout';
import { useDashboardLayout } from './useDashboardLayout';
import { widgetRegistry } from './widgetRegistry';
import type { StoredLayout, WidgetId, WidgetLayout } from './types';

interface DashboardContextValue {
  persistedLayout: StoredLayout;
  draftLayout: StoredLayout | null;
  isEditing: boolean;
  isLoading: boolean;
  beginEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => Promise<void>;
  applyDraft: (next: StoredLayout) => void;  // called by react-grid-layout onLayoutChange
  hide: (id: WidgetId) => void;
  add: (id: WidgetId) => void;
  resetDraft: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function firstFreeSlot(widgets: WidgetLayout[], w: number, h: number): { x: number; y: number } {
  // Naive: stack a new widget at y = max(y+h) over all existing widgets, x=0.
  // The user can drag it where they want.
  const maxY = widgets.reduce((m, wt) => Math.max(m, wt.y + wt.h), 0);
  void w; void h;
  return { x: 0, y: maxY };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { layout: persistedLayout, status, save } = useDashboardLayout();
  const [draftLayout, setDraftLayout] = useState<StoredLayout | null>(null);
  const isEditing = draftLayout !== null;

  const beginEdit = useCallback(() => setDraftLayout(persistedLayout), [persistedLayout]);
  const cancelEdit = useCallback(() => setDraftLayout(null), []);

  const saveEdit = useCallback(async () => {
    if (!draftLayout) return;
    await save(draftLayout);
    setDraftLayout(null);
  }, [draftLayout, save]);

  const applyDraft = useCallback((next: StoredLayout) => {
    setDraftLayout(next);
  }, []);

  const hide = useCallback((id: WidgetId) => {
    setDraftLayout(prev => {
      const base = prev ?? persistedLayout;
      return { ...base, widgets: base.widgets.filter(w => w.i !== id) };
    });
  }, [persistedLayout]);

  const add = useCallback((id: WidgetId) => {
    setDraftLayout(prev => {
      const base = prev ?? persistedLayout;
      if (base.widgets.some(w => w.i === id)) return base;
      const def = widgetRegistry[id];
      const { x, y } = firstFreeSlot(base.widgets, def.defaultW, def.defaultH);
      const next: WidgetLayout = { i: id, x, y, w: def.defaultW, h: def.defaultH };
      return { ...base, widgets: [...base.widgets, next] };
    });
  }, [persistedLayout]);

  const resetDraft = useCallback(() => setDraftLayout(defaultLayout), []);

  const value = useMemo<DashboardContextValue>(() => ({
    persistedLayout,
    draftLayout,
    isEditing,
    isLoading: status === 'loading',
    beginEdit, cancelEdit, saveEdit, applyDraft, hide, add, resetDraft,
  }), [persistedLayout, draftLayout, isEditing, status, beginEdit, cancelEdit, saveEdit, applyDraft, hide, add, resetDraft]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return ctx;
}
