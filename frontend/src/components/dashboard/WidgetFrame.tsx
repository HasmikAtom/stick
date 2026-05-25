import { X } from 'lucide-react';
import type { LucideIcon, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useDashboard } from './DashboardContext';
import type { WidgetId } from './types';

interface Props {
  id: WidgetId;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}

export function WidgetFrame({ id, title, icon: Icon, children }: Props) {
  const { isEditing, hide } = useDashboard();

  return (
    <div className="h-full flex flex-col rounded-lg border bg-card overflow-hidden">
      <div
        className={`widget-drag-handle flex items-center justify-between px-3 py-2 border-b ${
          isEditing ? 'cursor-move bg-muted/40' : ''
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{title}</span>
        </div>
        {isEditing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => hide(id)}
            aria-label={`Hide ${title} widget`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}
