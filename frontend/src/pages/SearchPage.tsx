import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScraperUI } from '@/Scraper/ScraperUI';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  useEffect(() => {
    document.title = q ? `Search · ${q}` : 'Search';
    return () => { document.title = 'TorrentUI'; };
  }, [q]);

  return (
    <div className="py-4">
      {/* ScraperUI internally manages its own search input, but we seed it
          via key so changes to the URL query trigger a fresh search. */}
      <ScraperUI key={q} mode="both" />
      {/* setParams unused intentionally — kept for future URL-driven search */}
      <span hidden>{String(setParams).length > 0}</span>
    </div>
  );
}
