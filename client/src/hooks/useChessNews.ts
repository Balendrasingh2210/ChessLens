import { useEffect, useState } from 'react';
import api from '../utils/api';

export interface ChessNewsItem {
  title: string;
  url: string;
  image_url: string;
  published: string;
  snippet: string;
}

export function useChessNews(limit = 6) {
  const [news, setNews]       = useState<ChessNewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/news')
      .then(({ data }) => setNews((data.articles ?? []).slice(0, limit)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit]);

  return { news, loading };
}
