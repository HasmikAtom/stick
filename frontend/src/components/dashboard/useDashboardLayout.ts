import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/services';
import { defaultLayout } from './defaultLayout';
import type { StoredLayout, WidgetLayout, WidgetId } from './types';
import { widgetRegistry } from './widgetRegistry';

type Status = 'loading' | 'ready' | 'error';

function isKnownWidget(id: string): id is WidgetId {
  return id in widgetRegistry;
}

function sanitize(layout: StoredLayout): StoredLayout {
  if (layout.version !== 1) return defaultLayout;
  const widgets = layout.widgets.filter(w => isKnownWidget(w.i)) as WidgetLayout[];
  if (widgets.length === 0) return defaultLayout;
  return { version: 1, widgets };
}

export function useDashboardLayout() {
  const [layout, setLayoutState] = useState<StoredLayout>(defaultLayout);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/user/dashboard');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { layout: StoredLayout | null };
        if (cancelled) return;
        setLayoutState(body.layout ? sanitize(body.layout) : defaultLayout);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setLayoutState(defaultLayout);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (next: StoredLayout) => {
    const res = await apiFetch('/api/user/dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'save failed' }));
      throw new Error(body.error ?? 'save failed');
    }
    setLayoutState(next);
  }, []);

  return { layout, status, save };
}
