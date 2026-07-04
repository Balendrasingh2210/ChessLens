const axios = require('axios');

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

const CATEGORY_QUERIES = {
  'tactical':       { q: 'chess tactics patterns how to spot combinations',     reason: 'Improve your tactics' },
  'hanging-piece':  { q: 'chess how to avoid hanging pieces losing material',   reason: 'Stop losing pieces' },
  'endgame':        { q: 'chess endgame technique fundamentals tutorial',        reason: 'Endgame training' },
  'positional':     { q: 'chess positional play strategy plan',                 reason: 'Positional understanding' },
  'king-safety':    { q: 'chess king safety attack defense principles',         reason: 'King safety' },
  'opening':        { q: 'chess opening principles theory guide',               reason: 'Opening theory' },
  'time-pressure':  { q: 'chess time management clock blitz bullet tips',       reason: 'Time management' },
  'other':          { q: 'chess common mistakes how to improve faster',         reason: 'General improvement' },
};

// General fallback queries shown when there's no analysis data yet
const GENERAL_QUERIES = [
  { q: 'chess improvement tips how to get better fast',         reason: 'Get better faster' },
  { q: 'chess tactics training beginners intermediate',         reason: 'Tactics training' },
  { q: 'chess opening principles every beginner must know',     reason: 'Opening principles' },
];

async function searchYouTube(query, maxResults = 1) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.warn('[YouTube] YOUTUBE_API_KEY not set');
    return [];
  }

  try {
    const { data } = await axios.get(SEARCH_URL, {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults,
        relevanceLanguage: 'en',
        key,
      },
      timeout: 10000,
    });

    if (!data.items?.length) {
      console.warn(`[YouTube] no results for "${query}"`);
      return [];
    }

    return data.items.map(item => ({
      videoId:   item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url,
      url:       `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
  } catch (err) {
    const detail = err.response?.data?.error?.message ?? err.message;
    console.error(`[YouTube] search failed for "${query}": ${detail}`);
    return [];
  }
}

exports.getGameRecommendations = async (game) => {
  const { opening, mistakes = [], accuracy } = game;

  console.log(`[YouTube] getGameRecommendations — opening=${opening}, accuracy=${accuracy}, mistakes=${mistakes.length}`);

  const collected = [];

  // 1. Opening-specific
  if (opening && opening !== 'Unknown opening') {
    const results = await searchYouTube(`${opening} chess opening guide`);
    results.forEach(v => collected.push({ ...v, reason: `Opening: ${opening}` }));
  }

  // 2. Mistake category or blunder avoidance
  const categoryCounts = {};
  mistakes.forEach(m => { if (m.category) categoryCounts[m.category] = (categoryCounts[m.category] || 0) + 1; });
  const topCategory  = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const blunderCount = mistakes.filter(m => m.type === 'blunder').length;

  if (blunderCount >= 2) {
    const results = await searchYouTube('chess how to stop blundering lose fewer pieces');
    results.forEach(v => collected.push({ ...v, reason: 'Reduce blunders' }));
  } else if (topCategory && CATEGORY_QUERIES[topCategory]) {
    const { q, reason } = CATEGORY_QUERIES[topCategory];
    const results = await searchYouTube(q);
    results.forEach(v => collected.push({ ...v, reason }));
  }

  // 3. Accuracy-tier video
  if (accuracy != null) {
    const accTier =
      accuracy < 70 ? { q: 'chess fundamentals beginners how to improve fast',            reason: 'Build fundamentals' } :
      accuracy < 82 ? { q: 'chess tactics training intermediate calculate better',         reason: 'Sharpen calculation' } :
      accuracy < 90 ? { q: 'chess advanced strategy planning how to think like a master',  reason: 'Strategic thinking' } :
                      { q: 'chess deep analysis masterclass grandmaster technique',        reason: 'Master-level ideas' };
    const results = await searchYouTube(accTier.q);
    results.forEach(v => collected.push({ ...v, reason: accTier.reason }));
  }

  // 4. Fallback — always return 3 videos even when analysis isn't done yet
  if (collected.length < 3) {
    for (const { q, reason } of GENERAL_QUERIES) {
      if (collected.length >= 3) break;
      const results = await searchYouTube(q);
      results.forEach(v => collected.push({ ...v, reason }));
    }
  }

  // Deduplicate + cap at 3
  const seen = new Set();
  const final = collected.filter(v => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  }).slice(0, 3);

  console.log(`[YouTube] returning ${final.length} recommendations`);
  return final;
};

exports.getWeaknessRecommendations = async (weaknessProfile) => {
  const { topWeaknesses = [], averageAccuracy } = weaknessProfile ?? {};
  const collected = [];

  for (const weakness of topWeaknesses.slice(0, 2)) {
    const qData = CATEGORY_QUERIES[weakness];
    if (!qData) continue;
    const results = await searchYouTube(qData.q);
    results.forEach(v => collected.push({ ...v, reason: qData.reason }));
  }

  const studyQuery =
    averageAccuracy == null ? 'chess improvement tips study plan beginners' :
    averageAccuracy < 75    ? 'chess study routine beginners how to improve rating fast' :
    averageAccuracy < 88    ? 'chess training plan intermediate tactics endgame' :
                              'chess advanced thinking techniques positional squeeze';
  const studyReason =
    averageAccuracy == null ? 'Study tips' :
    averageAccuracy < 75    ? 'Study routine' :
    averageAccuracy < 88    ? 'Training plan' :
                              'Advanced training';

  const results = await searchYouTube(studyQuery);
  results.forEach(v => collected.push({ ...v, reason: studyReason }));

  // Fallback
  if (collected.length < 3) {
    for (const { q, reason } of GENERAL_QUERIES) {
      if (collected.length >= 3) break;
      const r = await searchYouTube(q);
      r.forEach(v => collected.push({ ...v, reason }));
    }
  }

  const seen = new Set();
  return collected.filter(v => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  }).slice(0, 3);
};
