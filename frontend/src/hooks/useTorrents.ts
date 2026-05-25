import { useEffect, useState } from 'react';
import { apiFetch } from '@/services';
import type { TorrentStatus } from '@/Models';

const POLL_INTERVAL = 3000;

let cache: TorrentStatus[] | null = null;
const subscribers = new Set<(t: TorrentStatus[] | null) => void>();
let intervalId: number | null = null;
let inflight: Promise<void> | null = null;
let visibilityListenerAttached = false;

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

function startInterval() {
  if (intervalId !== null) return;
  intervalId = window.setInterval(fetchOnce, POLL_INTERVAL);
}

function stopInterval() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopInterval();
  } else {
    fetchOnce();
    startInterval();
  }
}

function attachVisibilityListener() {
  if (visibilityListenerAttached) return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  visibilityListenerAttached = true;
}

function detachVisibilityListener() {
  if (!visibilityListenerAttached) return;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  visibilityListenerAttached = false;
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
    attachVisibilityListener();
    if (!document.hidden) startInterval();
    return () => {
      subscribers.delete(setTorrents);
      if (subscribers.size === 0) {
        stopInterval();
        detachVisibilityListener();
      }
    };
  }, []);

  return { torrents, refresh: fetchOnce };
}
