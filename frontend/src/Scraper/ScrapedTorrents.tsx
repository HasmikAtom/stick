import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { TorrentDownloadPopup } from './DownloadPopup';
import { BatchDownloadPopup } from './BatchDownloadPopup';
import { ScrapedTorrents } from '../Models';
import { DownloadSource } from './ScraperUI';

interface Props {
  foundTorrents: ScrapedTorrents[] | null;
  downloadSource: DownloadSource;
  selectedTorrents: Map<string, string>;
  onToggleSelection: (id: string, downloadUrl: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadComplete?: () => void;
  filterText: string;
  onFilterChange: (value: string) => void;
  filterText2: string;
  onFilterChange2: (value: string) => void;
  selectedUploaders: Set<string>;
  onToggleUploader: (uploader: string) => void;
}

export const ScrapedTorrentsCards: React.FC<Props> = React.memo(({
  foundTorrents,
  downloadSource,
  selectedTorrents,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDownloadComplete,
  filterText,
  onFilterChange,
  filterText2,
  onFilterChange2,
  selectedUploaders,
  onToggleUploader,
}) => {

  const filteredTorrents = useMemo(() => {
    if (!foundTorrents) return foundTorrents;
    let results = foundTorrents;
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      results = results.filter(t => t.title.toLowerCase().includes(lower));
    }
    if (filterText2.trim()) {
      const lower2 = filterText2.toLowerCase();
      results = results.filter(t => t.title.toLowerCase().includes(lower2));
    }
    if (selectedUploaders.size > 0) {
      results = results.filter(t => selectedUploaders.has(t.uploader));
    }
    return results;
  }, [foundTorrents, filterText, filterText2, selectedUploaders]);

  const uploaders = useMemo(() => {
    if (!foundTorrents) return [];
    const set = new Set<string>();
    foundTorrents.forEach(t => { if (t.uploader) set.add(t.uploader); });
    return Array.from(set).sort();
  }, [foundTorrents]);

  const selectedCount = selectedTorrents.size;
  const isRuTracker = downloadSource === 'download_url';

  return (
    <Card className="w-full max-w-2xl mx-auto mt-8">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Search Results</CardTitle>
          {foundTorrents && foundTorrents.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onSelectAll}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClearSelection}
                disabled={selectedCount === 0}
              >
                Clear
              </Button>
              {selectedCount > 0 && (
                <BatchDownloadPopup
                  selectedCount={selectedCount}
                  downloadUrls={Array.from(selectedTorrents.values())}
                  isRuTracker={isRuTracker}
                  onDownloadComplete={onDownloadComplete}
                />
              )}
            </div>
          )}
        </div>
        {foundTorrents && foundTorrents.length > 0 && (
          <div className="flex gap-6 !mt-6">
            <div className="w-1/2 flex flex-col gap-2">
              <Input
                placeholder="Primary filter..."
                value={filterText}
                onChange={(e) => onFilterChange(e.target.value)}
              />
              <Input
                placeholder="Secondary filter..."
                value={filterText2}
                onChange={(e) => onFilterChange2(e.target.value)}
              />
            </div>
            <div className="w-1/2 flex flex-wrap gap-1 content-start overflow-auto max-h-20">
              {uploaders.map(uploader => (
                <button
                  key={uploader}
                  onClick={() => onToggleUploader(uploader)}
                  className={`px-2 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${
                    selectedUploaders.has(uploader)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:bg-accent'
                  }`}
                >
                  {uploader}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {filteredTorrents && filteredTorrents.length > 0 ? (
          <div className="space-y-2">
            {filteredTorrents.map((torrent) => {
              // Per-row source overrides the prop-level downloadSource so that
              // mixed-source results (mode='both') pick the correct field.
              const perRowSource = torrent.source === 'rutracker'
                ? 'download_url'
                : torrent.source === 'piratebay'
                  ? 'magnet'
                  : downloadSource;
              const downloadUrl = torrent[perRowSource] || '';
              const rowIsRuTracker = torrent.source
                ? torrent.source === 'rutracker'
                : isRuTracker;
              const isSelected = selectedTorrents.has(torrent.id);

              return (
                <div
                  key={torrent.id}
                  className={`rounded-lg border p-3 transition-colors hover:bg-muted/50 ${isSelected ? 'bg-accent border-primary' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={`torrent-${torrent.id}`}
                      checked={isSelected}
                      onChange={() => onToggleSelection(torrent.id, downloadUrl)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 cursor-pointer shrink-0"
                      aria-label={`Select ${torrent.title}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium leading-snug break-words">{torrent.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {torrent.source && (
                          <span className={`rounded-md px-2 py-0.5 text-xs ${
                            torrent.source === 'piratebay'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          }`}>
                            {torrent.source === 'piratebay' ? 'PirateBay' : 'Rutracker'}
                          </span>
                        )}
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{torrent.category}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{torrent.size}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-green-500">SE {torrent.se}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-red-400">LE {torrent.le}</span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{torrent.uploader}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <TorrentDownloadPopup
                        downloadUrl={downloadUrl}
                        isRuTracker={rowIsRuTracker}
                        onDownloadComplete={onDownloadComplete}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-gray-500">
            {foundTorrents && foundTorrents.length > 0 ? "No matching results" : "No active torrents"}
          </p>
        )}
      </CardContent>
    </Card>
  );
});
