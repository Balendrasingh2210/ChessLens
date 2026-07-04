import { useEffect, useState } from 'react';

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

const KEY = import.meta.env.VITE_YOUTUBE_API_KEY as string;
const SEARCH = 'https://www.googleapis.com/youtube/v3/search';

// ── Query pools — rotate through these so each game gets different videos ──

const TACTIC_POOL = [
  { q: 'chess tactics patterns how to spot combinations',           reason: 'Improve your tactics' },
  { q: 'chess puzzle tactics explained grandmaster solutions',      reason: 'Tactics puzzles' },
  { q: 'chess tactical patterns fork pin skewer',                   reason: 'Tactical patterns' },
  { q: 'chess tactics intermediate level combinations',             reason: 'Combination play' },
  { q: 'how to calculate chess moves tactics tree',                 reason: 'Calculation skills' },
];

const BLUNDER_POOL = [
  { q: 'chess how to stop blundering lose fewer pieces',            reason: 'Reduce blunders' },
  { q: 'why do i blunder in chess how to stop making mistakes',     reason: 'Stop blundering' },
  { q: 'chess blunder prevention checklist before moving',          reason: 'Blunder prevention' },
  { q: 'chess one move blunders how to avoid losing pieces',        reason: 'Avoid one-movers' },
];

const ENDGAME_POOL = [
  { q: 'chess endgame technique fundamentals tutorial',             reason: 'Endgame training' },
  { q: 'chess rook endgame technique how to win',                   reason: 'Rook endgames' },
  { q: 'chess king and pawn endgame principles',                    reason: 'K+P endgames' },
  { q: 'chess endgame fundamentals every player must know',         reason: 'Endgame fundamentals' },
];

const POSITIONAL_POOL = [
  { q: 'chess positional play strategy plan',                       reason: 'Positional understanding' },
  { q: 'chess strategic planning how to formulate a plan',          reason: 'Strategic planning' },
  { q: 'chess weak squares outpost strategy positional ideas',      reason: 'Weak squares & outposts' },
  { q: 'chess piece activity and coordination strategy',            reason: 'Piece coordination' },
];

const HANGING_POOL = [
  { q: 'chess how to avoid hanging pieces losing material',         reason: 'Stop losing pieces' },
  { q: 'chess material safety check before every move',             reason: 'Material safety' },
  { q: 'chess hanging pieces checklist how to prevent losing',      reason: 'Prevent piece losses' },
];

const OPENING_POOL = [
  { q: 'chess opening principles theory guide',                     reason: 'Opening theory' },
  { q: 'chess opening mistakes to avoid beginners',                 reason: 'Opening mistakes' },
  { q: 'how to study chess openings effectively',                   reason: 'Study openings' },
  { q: 'chess opening repertoire how to build one',                 reason: 'Build an opening rep' },
];

const KING_SAFETY_POOL = [
  { q: 'chess king safety attack defense principles',               reason: 'King safety' },
  { q: 'chess how to defend when your king is under attack',        reason: 'King defense' },
  { q: 'chess attack on the king how to launch and defend',         reason: 'Attacking the king' },
];

const TIME_POOL = [
  { q: 'chess time management clock blitz bullet tips',             reason: 'Time management' },
  { q: 'chess how to play faster blitz time trouble tips',          reason: 'Play faster' },
];

// Accuracy-tier pools
const LOW_ACC_POOL = [
  { q: 'chess fundamentals beginners how to improve fast',          reason: 'Build fundamentals' },
  { q: 'chess basics for beginners complete guide',                 reason: 'Chess basics' },
  { q: 'most important chess principles every beginner should know', reason: 'Core principles' },
  { q: 'chess improvement plan for beginners step by step',         reason: 'Improvement plan' },
];

const MID_ACC_POOL = [
  { q: 'chess tactics training intermediate calculate better',      reason: 'Sharpen calculation' },
  { q: 'chess how to improve from 800 to 1200 rating tips',        reason: 'Rating improvement' },
  { q: 'chess intermediate player common mistakes to fix',          reason: 'Fix common mistakes' },
  { q: 'chess accuracy improvement tips reduce mistakes',           reason: 'Improve accuracy' },
];

const HIGH_ACC_POOL = [
  { q: 'chess advanced strategy planning how to think like a master', reason: 'Strategic thinking' },
  { q: 'chess thinking process how strong players think',           reason: 'Thinking process' },
  { q: 'chess advanced technique positional squeeze imbalances',    reason: 'Advanced technique' },
  { q: 'how to study chess like a grandmaster advanced players',    reason: 'Study like a GM' },
];

const ELITE_ACC_POOL = [
  { q: 'chess deep analysis masterclass grandmaster technique',     reason: 'Master-level ideas' },
  { q: 'chess grandmaster game analysis instructive masterpiece',   reason: 'GM game analysis' },
  { q: 'chess prophylaxis preventive thinking advanced',            reason: 'Prophylaxis' },
  { q: 'chess complex positions calculation and evaluation',        reason: 'Complex positions' },
];

// General fallback pool — large so every game can get unique fallbacks
const GENERAL_POOL = [
  { q: 'chess improvement tips how to get better fast',             reason: 'Get better faster' },
  { q: 'chess tactics training beginners intermediate',             reason: 'Tactics training' },
  { q: 'chess opening principles every beginner must know',         reason: 'Opening principles' },
  { q: 'chess endgame basics every player should know',             reason: 'Endgame basics' },
  { q: 'chess thought process how to think during a game',          reason: 'Thought process' },
  { q: 'chess mistakes beginners make and how to fix them',         reason: 'Fix beginner mistakes' },
  { q: 'chess study tips how to improve your rating fast',          reason: 'Study tips' },
  { q: 'how to calculate chess moves ahead visualization',          reason: 'Move calculation' },
  { q: 'chess pattern recognition training spots tactics instantly', reason: 'Pattern recognition' },
  { q: 'chess positional sacrifice how to evaluate',                reason: 'Positional sacrifices' },
];

// ── Simple hash to pick deterministic-but-varied items from a pool ──
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickFrom<T>(pool: T[], seed: number, offset = 0): T {
  return pool[(seed + offset) % pool.length];
}

// ── YouTube fetch ──
async function ytSearch(query: string, reason: string): Promise<VideoRec[]> {
  if (!KEY) return [];
  try {
    const url = new URL(SEARCH);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('relevanceLanguage', 'en');
    url.searchParams.set('key', KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json() as {
      items?: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
        };
      }>;
    };

    return (data.items ?? []).map(item => ({
      videoId:   item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
      url:       `https://www.youtube.com/watch?v=${item.id.videoId}`,
      reason,
    }));
  } catch {
    return [];
  }
}

// ── Game recommendations ──
async function fetchGameRecs(ctx: GameContext): Promise<VideoRec[]> {
  const { gameId = '', opening, accuracy, mistakes = [] } = ctx;
  const seed = hashStr(gameId);
  const collected: VideoRec[] = [];

  // 1. Opening-specific (unique per opening name)
  if (opening && opening !== 'Unknown opening') {
    const r = await ytSearch(`${opening} chess opening guide complete tutorial`, `Opening: ${opening}`);
    collected.push(...r);
  }

  // 2. Mistake-based — pick from pools using seed so different games get different videos
  const blunders = mistakes.filter(m => m.type === 'blunder').length;
  const counts: Record<string, number> = {};
  mistakes.forEach(m => { if (m.category) counts[m.category] = (counts[m.category] ?? 0) + 1; });
  const topCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (blunders >= 2) {
    const { q, reason } = pickFrom(BLUNDER_POOL, seed);
    collected.push(...await ytSearch(q, reason));
  } else if (topCat) {
    const pool =
      topCat === 'tactical'      ? TACTIC_POOL :
      topCat === 'hanging-piece' ? HANGING_POOL :
      topCat === 'endgame'       ? ENDGAME_POOL :
      topCat === 'positional'    ? POSITIONAL_POOL :
      topCat === 'king-safety'   ? KING_SAFETY_POOL :
      topCat === 'opening'       ? OPENING_POOL :
      topCat === 'time-pressure' ? TIME_POOL :
      TACTIC_POOL;
    const { q, reason } = pickFrom(pool, seed, 1);
    collected.push(...await ytSearch(q, reason));
  }

  // 3. Accuracy-tier — rotated by seed so same-tier games get different picks
  if (accuracy != null) {
    const pool =
      accuracy < 70 ? LOW_ACC_POOL :
      accuracy < 82 ? MID_ACC_POOL :
      accuracy < 90 ? HIGH_ACC_POOL :
                      ELITE_ACC_POOL;
    const { q, reason } = pickFrom(pool, seed, 2);
    collected.push(...await ytSearch(q, reason));
  }

  // 4. Fill remaining slots from general pool — offset by seed + collected so no repeats
  let fallbackOffset = seed % GENERAL_POOL.length;
  while (collected.length < 3) {
    const { q, reason } = GENERAL_POOL[fallbackOffset % GENERAL_POOL.length];
    fallbackOffset++;
    const r = await ytSearch(q, reason);
    collected.push(...r);
  }

  const seen = new Set<string>();
  return collected
    .filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; })
    .slice(0, 3);
}

// ── Weakness recommendations ──
async function fetchWeaknessRecs(ctx: WeaknessContext): Promise<VideoRec[]> {
  const { topWeaknesses = [], averageAccuracy } = ctx;
  const collected: VideoRec[] = [];
  const seed = hashStr(topWeaknesses.join(',') + String(averageAccuracy));

  for (const [i, w] of topWeaknesses.slice(0, 2).entries()) {
    const pool =
      w === 'tactical'      ? TACTIC_POOL :
      w === 'hanging-piece' ? HANGING_POOL :
      w === 'endgame'       ? ENDGAME_POOL :
      w === 'positional'    ? POSITIONAL_POOL :
      w === 'king-safety'   ? KING_SAFETY_POOL :
      w === 'opening'       ? OPENING_POOL :
      w === 'time-pressure' ? TIME_POOL :
      TACTIC_POOL;
    const { q, reason } = pickFrom(pool, seed, i);
    collected.push(...await ytSearch(q, reason));
  }

  const accPool =
    averageAccuracy == null ? LOW_ACC_POOL :
    averageAccuracy < 75   ? LOW_ACC_POOL :
    averageAccuracy < 88   ? MID_ACC_POOL :
                             HIGH_ACC_POOL;
  const { q, reason } = pickFrom(accPool, seed, 2);
  collected.push(...await ytSearch(q, reason));

  let fallbackOffset = seed % GENERAL_POOL.length;
  while (collected.length < 3) {
    const { q, reason } = GENERAL_POOL[fallbackOffset % GENERAL_POOL.length];
    fallbackOffset++;
    collected.push(...await ytSearch(q, reason));
  }

  const seen = new Set<string>();
  return collected
    .filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; })
    .slice(0, 3);
}

// ── Hooks ──

export function useGameRecommendations(ctx: GameContext | null) {
  const [videos, setVideos] = useState<VideoRec[]>([]);

  useEffect(() => {
    if (!ctx || !KEY) return;
    setVideos([]); // clear while loading new game's recs
    fetchGameRecs(ctx).then(setVideos).catch(() => {});
  }, [ctx?.gameId, ctx?.opening, ctx?.accuracy, ctx?.mistakes?.length]);

  return videos;
}

export function useWeaknessRecommendations(ctx: WeaknessContext | null) {
  const [videos, setVideos] = useState<VideoRec[]>([]);

  useEffect(() => {
    if (!KEY) return;
    fetchWeaknessRecs(ctx ?? {}).then(setVideos).catch(() => {});
  }, [ctx?.topWeaknesses?.join(','), ctx?.averageAccuracy]);

  return videos;
}
