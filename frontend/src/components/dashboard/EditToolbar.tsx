import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Plus, RotateCcw } from 'lucide-react';
import { useDashboard } from './DashboardContext';
import { WIDGET_ORDER, widgetRegistry } from './widgetRegistry';
import type { WidgetId } from './types';

export function EditToolbar() {
  const { isEditing, draftLayout, persistedLayout, add, resetDraft } = useDashboard();
  if (!isEditing) return null;

  const current = draftLayout ?? persistedLayout;
  const presentIds = new Set(current.widgets.map(w => w.i));
  const hiddenIds = WIDGET_ORDER.filter((id: WidgetId) => !presentIds.has(id));

  return (
    <div className="flex items-center gap-3 mb-3 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={hiddenIds.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Add widget
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {hiddenIds.length === 0 ? (
            <DropdownMenuItem disabled>All widgets shown</DropdownMenuItem>
          ) : (
            hiddenIds.map((id) => {
              const def = widgetRegistry[id];
              const Icon = def.icon;
              return (
                <DropdownMenuItem key={id} onSelect={() => add(id)}>
                  <Icon className="h-4 w-4 mr-2" />
                  {def.title}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={resetDraft}>
        <RotateCcw className="h-4 w-4 mr-1" />
        Reset to default
      </Button>
    </div>
  );
}
