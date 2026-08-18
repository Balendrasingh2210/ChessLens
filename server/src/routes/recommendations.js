const router    = require('express').Router();
const axios     = require('axios');
const { protect } = require('../middleware/auth');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ── Curated chess channels ────────────────────────────────────────────────────
// Mapped by weakness → YouTube @handle. All are free, high-quality chess channels.
const WEAKNESS_CHANNEL = {
  'tactical':       'GothamChess',
  'hanging-piece':  'GothamChess',
  'endgame':        'GothamChess',
  'positional':     'GothamChess',
  'opening':        'GothamChess',
  'king-safety':    'GothamChess',
  'time-pressure':  'GothamChess',
};

const WEAKNESS_REASON = {
  'tactical':       'Sharpen your tactics',
  'hanging-piece':  'Stop losing pieces',
  'endgame':        'Endgame technique',
  'positional':     'Positional play',
  'opening':        'Opening theory',
  'king-safety':    'King safety ideas',
  'time-pressure':  'Play faster & smarter',
};

// channelId cache — never expires (handles don't change)
const channelIdCache = new Map();

// playlistId → { videos, expiry } — refreshed every 24 h
const playlistCache  = new Map();
const PLAYLIST_TTL   = 24 * 60 * 60 * 1000;

// response cache per weakness profile — 6 h
const responseCache  = new Map();
const RESPONSE_TTL   = 6 * 60 * 60 * 1000;

async function getChannelId(handle, key) {
  if (channelIdCache.has(handle)) return channelIdCache.get(handle);
  const { data } = await axios.get(`${YT_BASE}/channels`, {
    params: { part: 'id', forHandle: handle, key },
    timeout: 6000,
  });
  const id = data.items?.[0]?.id ?? null;
  if (id) channelIdCache.set(handle, id);
  return id;
}

async function getChannelVideos(handle, key) {
  const channelId = await getChannelId(handle, key);
  if (!channelId) return [];

  // Upload playlist = UU + channelId without the leading UC
  const playlistId = 'UU' + channelId.slice(2);

  const hit = playlistCache.get(playlistId);
  if (hit && Date.now() < hit.expiry) return hit.videos;

  const { data } = await axios.get(`${YT_BASE}/playlistItems`, {
    params: { part: 'snippet', playlistId, maxResults: 20, key },
    timeout: 8000,
  });

  const videos = (data.items ?? [])
    .filter(item => item.snippet?.resourceId?.videoId)
    .map(item => ({
      videoId:   item.snippet.resourceId.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url
        ?? `https://img.youtube.com/vi/${item.snippet.resourceId.videoId}/mqdefault.jpg`,
    }));

  playlistCache.set(playlistId, { videos, expiry: Date.now() + PLAYLIST_TTL });
  return videos;
}

// GET /api/recommendations?weaknesses=tactical,endgame&accuracy=72
router.get('/', protect, async (req, res) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json({ videos: [] });

  const weaknesses = (req.query.weaknesses || '').split(',').filter(Boolean);
  const cacheKey   = weaknesses.slice(0, 2).join(',') || 'general';

  const hit = responseCache.get(cacheKey);
  if (hit && Date.now() < hit.expiry) return res.json({ videos: hit.data });

  try {
    // Pick the channel for the top weakness (fall back to GothamChess)
    const primaryWeakness = weaknesses[0] ?? 'general';
    const handle = WEAKNESS_CHANNEL[primaryWeakness] ?? 'GothamChess';

    const pool = await getChannelVideos(handle, key);
    if (!pool.length) return res.json({ videos: [] });

    // Pick 3 videos spread across the pool for variety
    const step = Math.max(1, Math.floor(pool.length / 3));
    const videos = [0, step, step * 2]
      .filter(i => i < pool.length)
      .map((i, slot) => ({
        ...pool[i],
        url:    `https://www.youtube.com/watch?v=${pool[i].videoId}`,
        reason: WEAKNESS_REASON[weaknesses[slot] ?? primaryWeakness]
          ?? 'Chess improvement',
      }));

    responseCache.set(cacheKey, { data: videos, expiry: Date.now() + RESPONSE_TTL });
    res.json({ videos });
  } catch (err) {
    console.error('[recommendations]', err.message);
    res.json({ videos: [] });
  }
});

module.exports = router;
