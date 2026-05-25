import { HardDrive } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { StorageInfo } from '@/StorageInfo';

export function StorageWidget() {
  return (
    <WidgetFrame id="storage" title="Storage" icon={HardDrive}>
      <StorageInfo />
    </WidgetFrame>
  );
}
