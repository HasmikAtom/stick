import { Download } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { TorrentList } from '@/TorrentList';

export function ActiveTorrentsWidget() {
  return (
    <WidgetFrame id="active" title="Active Torrents" icon={Download}>
      <TorrentList />
    </WidgetFrame>
  );
}
