import { useEffect, useState } from 'react';
import { apiFetch } from '@/services';
import type { TorrentStatus } from '@/Models';

const POLL_INTERVAL = 3000;

let cache: TorrentStatus[] | null = null;
let subscribers = new Set<(t: TorrentStatus[] | null) => void>();
let intervalId: number | null = null;
let inflight: Promise<void> | null = null;

async function fetchOnce() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await apiFetch('/api/torrents');
      if (!res.ok) return;
      const data = (await res.json()) as TorrentStatus[];
      cache = data;
      subscribers.forEach(cb => cb(cache));
    } catch {
      // swallow; subscribers will see the stale cache
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensurePolling() {
  if (intervalId !== null || subscribers.size === 0) return;
  intervalId = window.setInterval(fetchOnce, POLL_INTERVAL);

  // Page Visibility: pause polling when hidden, refresh + resume on visible
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    fetchOnce();
    ensurePolling();
  }
}

export interface UseTorrentsResult {
  torrents: TorrentStatus[] | null;
  refresh: () => Promise<void>;
}

export function useTorrents(): UseTorrentsResult {
  const [torrents, setTorrents] = useState<TorrentStatus[] | null>(cache);

  useEffect(() => {
    subscribers.add(setTorrents);
    fetchOnce();
    ensurePolling();
    return () => {
      subscribers.delete(setTorrents);
      if (subscribers.size === 0) stopPolling();
    };
  }, []);

  return { torrents, refresh: fetchOnce };
}
