const router  = require('express').Router();
const axios   = require('axios');
const { protect } = require('../middleware/auth');

// Per-key cache: cacheKey → { data, expiry }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const YT_SEARCH = 'https://www.googleapis.com/youtube/v3/search';

const TACTIC_POOL = [
  { q: 'chess tactics patterns how to spot combinations',          reason: 'Improve your tactics' },
  { q: 'chess puzzle tactics explained grandmaster solutions',     reason: 'Tactics puzzles' },
  { q: 'chess tactical patterns fork pin skewer',                  reason: 'Tactical patterns' },
  { q: 'chess tactics intermediate level combinations',            reason: 'Combination play' },
  { q: 'how to calculate chess moves tactics tree',                reason: 'Calculation skills' },
];
const BLUNDER_POOL = [
  { q: 'chess how to stop blundering lose fewer pieces',           reason: 'Reduce blunders' },
  { q: 'why do i blunder in chess how to stop making mistakes',    reason: 'Stop blundering' },
  { q: 'chess blunder prevention checklist before moving',         reason: 'Blunder prevention' },
  { q: 'chess one move blunders how to avoid losing pieces',       reason: 'Avoid one-movers' },
];
const ENDGAME_POOL = [
  { q: 'chess endgame technique fundamentals tutorial',            reason: 'Endgame training' },
  { q: 'chess rook endgame technique how to win',                  reason: 'Rook endgames' },
  { q: 'chess king and pawn endgame principles',                   reason: 'K+P endgames' },
  { q: 'chess endgame fundamentals every player must know',        reason: 'Endgame fundamentals' },
];
const POSITIONAL_POOL = [
  { q: 'chess positional play strategy plan',                      reason: 'Positional understanding' },
  { q: 'chess strategic planning how to formulate a plan',         reason: 'Strategic planning' },
  { q: 'chess weak squares outpost strategy positional ideas',     reason: 'Weak squares & outposts' },
  { q: 'chess piece activity and coordination strategy',           reason: 'Piece coordination' },
];
const HANGING_POOL = [
  { q: 'chess how to avoid hanging pieces losing material',        reason: 'Stop losing pieces' },
  { q: 'chess material safety check before every move',            reason: 'Material safety' },
  { q: 'chess hanging pieces checklist how to prevent losing',     reason: 'Prevent piece losses' },
];
const OPENING_POOL = [
  { q: 'chess opening principles theory guide',                    reason: 'Opening theory' },
  { q: 'chess opening mistakes to avoid beginners',                reason: 'Opening mistakes' },
  { q: 'how to study chess openings effectively',                  reason: 'Study openings' },
  { q: 'chess opening repertoire how to build one',                reason: 'Build an opening rep' },
];
const KING_SAFETY_POOL = [
  { q: 'chess king safety attack defense principles',              reason: 'King safety' },
  { q: 'chess how to defend when your king is under attack',       reason: 'King defense' },
  { q: 'chess attack on the king how to launch and defend',        reason: 'Attacking the king' },
];
const TIME_POOL = [
  { q: 'chess time management clock blitz bullet tips',            reason: 'Time management' },
  { q: 'chess how to play faster blitz time trouble tips',         reason: 'Play faster' },
];
const LOW_ACC_POOL = [
  { q: 'chess fundamentals beginners how to improve fast',         reason: 'Build fundamentals' },
  { q: 'chess basics for beginners complete guide',                reason: 'Chess basics' },
  { q: 'most important chess principles every beginner should know', reason: 'Core principles' },
];
const MID_ACC_POOL = [
  { q: 'chess tactics training intermediate calculate better',     reason: 'Sharpen calculation' },
  { q: 'chess intermediate player common mistakes to fix',         reason: 'Fix common mistakes' },
  { q: 'chess accuracy improvement tips reduce mistakes',          reason: 'Improve accuracy' },
];
const HIGH_ACC_POOL = [
  { q: 'chess advanced strategy planning how to think like a master', reason: 'Strategic thinking' },
  { q: 'chess thinking process how strong players think',          reason: 'Thinking process' },
  { q: 'chess advanced technique positional squeeze imbalances',   reason: 'Advanced technique' },
];
const GENERAL_POOL = [
  { q: 'chess improvement tips how to get better fast',            reason: 'Get better faster' },
  { q: 'chess tactics training beginners intermediate',            reason: 'Tactics training' },
  { q: 'chess opening principles every beginner must know',        reason: 'Opening principles' },
  { q: 'chess endgame basics every player should know',            reason: 'Endgame basics' },
  { q: 'chess thought process how to think during a game',         reason: 'Thought process' },
  { q: 'chess mistakes beginners make and how to fix them',        reason: 'Fix beginner mistakes' },
  { q: 'chess study tips how to improve your rating fast',         reason: 'Study tips' },
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pickFrom(pool, seed, offset = 0) {
  return pool[(seed + offset) % pool.length];
}

function poolForWeakness(w) {
  switch (w) {
    case 'tactical':      return TACTIC_POOL;
    case 'hanging-piece': return HANGING_POOL;
    case 'endgame':       return ENDGAME_POOL;
    case 'positional':    return POSITIONAL_POOL;
    case 'king-safety':   return KING_SAFETY_POOL;
    case 'opening':       return OPENING_POOL;
    case 'time-pressure': return TIME_POOL;
    default:              return TACTIC_POOL;
  }
}

async function ytSearch(key, query, reason) {
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '1',
      relevanceLanguage: 'en',
      key,
    });
    const { data } = await axios.get(`${YT_SEARCH}?${params}`, { timeout: 6000 });
    return (data.items || []).map(item => ({
      videoId:   item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      url:       `https://www.youtube.com/watch?v=${item.id.videoId}`,
      reason,
    }));
  } catch {
    return [];
  }
}

// GET /api/recommendations?weaknesses=tactical,endgame&accuracy=72
router.get('/', protect, async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json({ videos: [] });

  const weaknesses = (req.query.weaknesses || '').split(',').filter(Boolean);
  const accuracy   = req.query.accuracy != null ? parseFloat(req.query.accuracy) : null;

  const cacheKey = `${weaknesses.join(',')}_${accuracy}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() < hit.expiry) return res.json({ videos: hit.data });

  const seed = hashStr(cacheKey);
  const collected = [];

  // 1. Top 2 weakness-based searches
  for (let i = 0; i < Math.min(2, weaknesses.length); i++) {
    const pool = poolForWeakness(weaknesses[i]);
    const { q, reason } = pickFrom(pool, seed, i);
    collected.push(...await ytSearch(key, q, reason));
  }

  // 2. Accuracy-tier search
  const accPool =
    accuracy == null ? LOW_ACC_POOL :
    accuracy < 75    ? LOW_ACC_POOL :
    accuracy < 88    ? MID_ACC_POOL :
                       HIGH_ACC_POOL;
  const { q: aq, reason: ar } = pickFrom(accPool, seed, 2);
  collected.push(...await ytSearch(key, aq, ar));

  // 3. Fill to 3 from general pool
  let fallbackOff = seed % GENERAL_POOL.length;
  while (collected.length < 3) {
    const { q, reason } = GENERAL_POOL[fallbackOff % GENERAL_POOL.length];
    fallbackOff++;
    collected.push(...await ytSearch(key, q, reason));
    if (fallbackOff > GENERAL_POOL.length * 2) break; // safety valve
  }

  const seen = new Set();
  const videos = collected
    .filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; })
    .slice(0, 3);

  cache.set(cacheKey, { data: videos, expiry: Date.now() + CACHE_TTL });
  res.json({ videos });
});

module.exports = router;
