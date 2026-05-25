import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';

export function TopBarSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex-1 max-w-xl">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search torrents…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-8 h-8"
        />
      </div>
    </form>
  );
}
