import { useEffect, useState } from 'react';
import api from '../utils/api';

export interface VideoRec {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
  reason: string;
}

interface GameContext {
  gameId?: string;
  opening?: string | null;
  accuracy?: number | null;
  mistakes?: Array<{ type: string; category?: string }>;
}

interface WeaknessContext {
  topWeaknesses?: string[];
  averageAccuracy?: number | null;
}

async function fetchFromServer(weaknesses: string[], accuracy: number | null): Promise<VideoRec[]> {
  try {
    const params = new URLSearchParams();
    if (weaknesses.length) params.set('weaknesses', weaknesses.join(','));
    if (accuracy != null) params.set('accuracy', String(accuracy));
    const { data } = await api.get(`/recommendations?${params}`);
    return data.videos ?? [];
  } catch {
    return [];
  }
}

export function useGameRecommendations(ctx: GameContext | null) {
  const [videos, setVideos] = useState<VideoRec[]>([]);

  useEffect(() => {
    if (!ctx) return;
    setVideos([]);

    const counts: Record<string, number> = {};
    (ctx.mistakes ?? []).forEach(m => {
      if (m.category) counts[m.category] = (counts[m.category] ?? 0) + 1;
    });
    const blunders = (ctx.mistakes ?? []).filter(m => m.type === 'blunder').length;
    const topCat   = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

    const weaknesses: string[] = [];
    if (blunders >= 2) weaknesses.push('hanging-piece');
    else if (topCat)   weaknesses.push(topCat);

    fetchFromServer(weaknesses, ctx.accuracy ?? null).then(setVideos).catch(() => {});
  }, [ctx?.gameId, ctx?.opening, ctx?.accuracy, ctx?.mistakes?.length]);

  return videos;
}

export function useWeaknessRecommendations(ctx: WeaknessContext | null) {
  const [videos, setVideos] = useState<VideoRec[]>([]);

  useEffect(() => {
    const weaknesses = ctx?.topWeaknesses ?? [];
    const accuracy   = ctx?.averageAccuracy ?? null;
    fetchFromServer(weaknesses, accuracy).then(setVideos).catch(() => {});
  }, [ctx?.topWeaknesses?.join(','), ctx?.averageAccuracy]);

  return videos;
}
