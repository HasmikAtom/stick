import { Clock } from 'lucide-react';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import { useTorrents } from '@/hooks/useTorrents';
import type { TorrentStatus } from '@/Models';

const COMPLETE_PCT = 100; // backend multiplies percentDone by 100
const TAKE = 5;

function formatRelative(epochSeconds: number): string {
  const secs = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function RecentActivityWidget() {
  const { torrents } = useTorrents();

  const recent = (torrents ?? [])
    .filter((t: TorrentStatus) => t.percentDone >= COMPLETE_PCT && t.doneDate > 0)
    .sort((a, b) => b.doneDate - a.doneDate)
    .slice(0, TAKE);

  return (
    <WidgetFrame id="recent" title="Recent Activity" icon={Clock}>
      {torrents === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed downloads yet.</p>
      ) : (
        <ul className="divide-y">
          {recent.map(t => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-2 min-w-0">
              <span className="truncate text-sm" title={t.name}>{t.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatRelative(t.doneDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
