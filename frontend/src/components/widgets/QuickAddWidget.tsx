import { Plus } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { TorrentDownloader } from '@/TorrentDownloader';

export function QuickAddWidget() {
  return (
    <WidgetFrame id="quickAdd" title="Quick Add" icon={Plus}>
      <TorrentDownloader />
    </WidgetFrame>
  );
}
