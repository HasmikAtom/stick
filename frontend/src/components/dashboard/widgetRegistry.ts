import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, Plus, HardDrive, Clock } from 'lucide-react';
import type { WidgetId } from './types';

import { ActiveTorrentsWidget } from '@/components/widgets/ActiveTorrentsWidget';
import { QuickAddWidget } from '@/components/widgets/QuickAddWidget';
import { StorageWidget } from '@/components/widgets/StorageWidget';
import { RecentActivityWidget } from '@/components/widgets/RecentActivityWidget';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  icon: LucideIcon;
  component: ComponentType;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
}

export const widgetRegistry: Record<WidgetId, WidgetDef> = {
  active: {
    id: 'active',
    title: 'Active Torrents',
    icon: Download,
    component: ActiveTorrentsWidget,
    defaultW: 8, defaultH: 8,
    minW: 4,    minH: 4,
  },
  quickAdd: {
    id: 'quickAdd',
    title: 'Quick Add',
    icon: Plus,
    component: QuickAddWidget,
    defaultW: 4, defaultH: 3,
    minW: 3,    minH: 3,
  },
  storage: {
    id: 'storage',
    title: 'Storage',
    icon: HardDrive,
    component: StorageWidget,
    defaultW: 4, defaultH: 3,
    minW: 3,    minH: 3,
  },
  recent: {
    id: 'recent',
    title: 'Recent Activity',
    icon: Clock,
    component: RecentActivityWidget,
    defaultW: 4, defaultH: 5,
    minW: 3,    minH: 4,
  },
};

export const WIDGET_ORDER: WidgetId[] = ['active', 'quickAdd', 'storage', 'recent'];
