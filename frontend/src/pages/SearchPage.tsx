import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScraperUI } from '@/Scraper/ScraperUI';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';

  useEffect(() => {
    document.title = q ? `Search · ${q}` : 'Search';
    return () => { document.title = 'TorrentUI'; };
  }, [q]);

  return (
    <div className="py-4">
      <ScraperUI key={q} mode="both" defaultQuery={q} />
    </div>
  );
}
