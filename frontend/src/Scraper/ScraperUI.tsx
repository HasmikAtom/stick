import React, { useState, useRef, useEffect } from 'react';
import { ScrapedTorrents } from '../Models';
import { ScrapeSearch } from './ScrapeSearch';
import { ScrapedTorrentsCards } from './ScrapedTorrents';
import { useToast } from '@/hooks/use-toast';

const ScraperConfig = {
  piratebay: {
    scrapeEndpoint: '/api/scrape/piratebay/',
    scrapeStreamEndpoint: '/api/scrape/piratebay/',
    downloadSource: 'magnet' as const,
  },
  rutracker: {
    scrapeEndpoint: '/api/scrape/rutracker/',
    scrapeStreamEndpoint: '/api/scrape/rutracker/',
    downloadSource: 'download_url' as const,
  }
} as const

interface SSEEvent {
  type: 'trying' | 'success' | 'error' | 'complete';
  message: string;
  host?: string;
  label?: string;
  data?: any;
}

export type DownloadSource = typeof ScraperConfig[keyof typeof ScraperConfig]['downloadSource'];

interface Props {
  mode: 'piratebay' | 'rutracker' | 'both';
}

export const ScraperUI: React.FC<Props> = ({ mode }) => {

    const [searchLoading, setSearchLoading] = useState<boolean>(false);
    const [torrentName, setTorrentName] = useState<string>("");
    const [foundTorrents, setFoundTorrents] = useState<ScrapedTorrents[] | null>(null);
    const [selectedTorrents, setSelectedTorrents] = useState<Map<string, string>>(new Map());
    const [filterText, setFilterText] = useState<string>("");
    const [filterText2, setFilterText2] = useState<string>("");
    const [selectedUploaders, setSelectedUploaders] = useState<Set<string>>(new Set());
    const eventSourceRefs = useRef<EventSource[]>([]);
    const { toast } = useToast();

    const sources: Array<'piratebay' | 'rutracker'> = mode === 'both'
      ? ['piratebay', 'rutracker']
      : [mode];

    // Cleanup EventSources on unmount
    useEffect(() => {
      return () => {
        eventSourceRefs.current.forEach(es => es.close());
        eventSourceRefs.current = [];
      };
    }, []);

    // Default downloadSource for the results card. In 'both' mode we fall back
    // to 'magnet'; per-row source tagging lets ScrapedTorrentsCards pick the
    // correct field per row.
    const downloadSource: DownloadSource = mode === 'rutracker'
      ? ScraperConfig.rutracker.downloadSource
      : ScraperConfig.piratebay.downloadSource;

    const handleScrapeSearch = async () => {
      // Close any existing EventSources
      eventSourceRefs.current.forEach(es => es.close());
      eventSourceRefs.current = [];

      setSearchLoading(true);
      setFoundTorrents([]);

      let completed = 0;
      const total = sources.length;

      sources.forEach((source) => {
        const cfg = ScraperConfig[source];
        const url = `${cfg.scrapeStreamEndpoint}${encodeURIComponent(torrentName)}/stream`;
        const es = new EventSource(url);
        eventSourceRefs.current.push(es);

        es.onmessage = (event) => {
          try {
            const data: SSEEvent = JSON.parse(event.data);
            if (data.type === 'success' && Array.isArray(data.data)) {
              const tagged: ScrapedTorrents[] = (data.data as ScrapedTorrents[])
                .map(t => ({ ...t, source }));
              setFoundTorrents(prev => [...(prev ?? []), ...tagged]);
            } else if (data.type === 'error') {
              toast({
                variant: 'destructive',
                title: `${source} search failed`,
                description: data.message,
              });
            } else if (data.type === 'complete') {
              es.close();
              completed += 1;
              if (completed === total) setSearchLoading(false);
            }
          } catch (e) {
            console.error('SSE parse error', e);
          }
        };

        es.onerror = () => {
          es.close();
          completed += 1;
          if (completed === total) setSearchLoading(false);
        };
      });
    }

    const handleDownloadComplete = () => {
      clearSelection();
      toast({
        title: "Download started",
        description: "Torrent(s) added to queue",
      });
    };

    const handleTorrentSearchClear = async () => {
      setSearchLoading(false);
      setFoundTorrents(null);
      setTorrentName("");
      setSelectedTorrents(new Map());
      setFilterText("");
      setFilterText2("");
      setSelectedUploaders(new Set());
    }

    const toggleTorrentSelection = (id: string, downloadUrl: string) => {
      setSelectedTorrents(prev => {
        const newMap = new Map(prev);
        if (newMap.has(id)) {
          newMap.delete(id);
        } else {
          newMap.set(id, downloadUrl);
        }
        return newMap;
      });
    };

    const selectAllTorrents = () => {
      if (!foundTorrents) return;
      const newMap = new Map<string, string>();
      foundTorrents.forEach(torrent => {
        const perRowSource: DownloadSource = torrent.source === 'rutracker'
          ? 'download_url'
          : torrent.source === 'piratebay'
            ? 'magnet'
            : downloadSource;
        const downloadUrl = torrent[perRowSource] || '';
        if (downloadUrl) {
          newMap.set(torrent.id, downloadUrl);
        }
      });
      setSelectedTorrents(newMap);
    };

    const clearSelection = () => {
      setSelectedTorrents(new Map());
    };

  return (
    <>
      <ScrapeSearch
        torrentName={torrentName}
        searchLoading={searchLoading}
        setTorrentName={setTorrentName}
        handleTorrentSearch={handleScrapeSearch}
        handleTorrentSearchClear={handleTorrentSearchClear}
      />

      <ScrapedTorrentsCards
        foundTorrents={foundTorrents}
        downloadSource={downloadSource}
        selectedTorrents={selectedTorrents}
        onToggleSelection={toggleTorrentSelection}
        onSelectAll={selectAllTorrents}
        onClearSelection={clearSelection}
        onDownloadComplete={handleDownloadComplete}
        filterText={filterText}
        onFilterChange={setFilterText}
        filterText2={filterText2}
        onFilterChange2={setFilterText2}
        selectedUploaders={selectedUploaders}
        onToggleUploader={(uploader) => {
          setSelectedUploaders(prev => {
            const next = new Set(prev);
            if (next.has(uploader)) next.delete(uploader);
            else next.add(uploader);
            return next;
          });
        }}
      />
    </>
  );
}
