import { useMemo } from 'react';
import GridLayout, { type Layout, type LayoutItem } from 'react-grid-layout';
import { useDashboard } from './DashboardContext';
import { widgetRegistry } from './widgetRegistry';
import { GRID_COLS, ROW_HEIGHT, type WidgetId } from './types';

interface Props {
  width: number;
}

export function DashboardGrid({ width }: Props) {
  const { persistedLayout, draftLayout, isEditing, applyDraft } = useDashboard();
  const current = draftLayout ?? persistedLayout;

  const rglLayout: LayoutItem[] = useMemo(
    () =>
      current.widgets.map(w => {
        const def = widgetRegistry[w.i];
        return {
          i: w.i,
          x: w.x, y: w.y, w: w.w, h: w.h,
          minW: def.minW, minH: def.minH,
        };
      }),
    [current],
  );

  const onLayoutChange = (next: Layout) => {
    if (!isEditing) return;
    applyDraft({
      version: 1,
      widgets: next.map(l => ({
        i: l.i as WidgetId,
        x: l.x, y: l.y, w: l.w, h: l.h,
      })),
    });
  };

  return (
    <GridLayout
      className="layout"
      layout={rglLayout}
      width={width}
      gridConfig={{
        cols: GRID_COLS,
        rowHeight: ROW_HEIGHT,
        margin: [12, 12],
      }}
      dragConfig={{
        enabled: isEditing,
        handle: '.widget-drag-handle',
      }}
      resizeConfig={{
        enabled: isEditing,
      }}
      onLayoutChange={onLayoutChange}
    >
      {current.widgets.map(w => {
        const def = widgetRegistry[w.i];
        const Comp = def.component;
        return (
          <div key={w.i}>
            <Comp />
          </div>
        );
      })}
    </GridLayout>
  );
}
