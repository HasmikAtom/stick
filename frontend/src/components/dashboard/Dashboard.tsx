import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDashboard } from './DashboardContext';
import { DashboardGrid } from './DashboardGrid';
import { EditToolbar } from './EditToolbar';
import { widgetRegistry, WIDGET_ORDER } from './widgetRegistry';

export function Dashboard() {
  const { isLoading } = useDashboard();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current || isMobile) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [isMobile]);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading dashboard…</div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3 py-3">
        {WIDGET_ORDER.map(id => {
          const Comp = widgetRegistry[id].component;
          return <Comp key={id} />;
        })}
      </div>
    );
  }

  return (
    <div className="py-3" ref={containerRef}>
      <EditToolbar />
      {width > 0 && <DashboardGrid width={width} />}
    </div>
  );
}
