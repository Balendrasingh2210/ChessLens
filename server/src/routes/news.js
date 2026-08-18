const router = require('express').Router();
const axios  = require('axios');

// In-memory cache — avoids hammering Lichess on every page load
let cache = { data: null, expiry: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function unescapeHtml(str) {
  return str
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&amp;/g,  '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'");
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, '').trim();
}

function parseAtom(xml) {
  const entries = [];
  const blocks = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (const block of blocks.slice(0, 8)) {
    const title     = stripTags(unescapeHtml((block.match(/<title>([\s\S]*?)<\/title>/)     || [])[1] || ''));
    const url       = (block.match(/rel="alternate"[^>]*href="([^"]+)"/)  || [])[1] || '';
    const published = (block.match(/<published>([\s\S]*?)<\/published>/)  || [])[1] || '';
    let thumbnail = (block.match(/media:thumbnail url="([^"]+)"/)         || [])[1] || '';
    if (!thumbnail) thumbnail = (block.match(/media:content url="([^"]+)"/) || [])[1] || '';
    // Fall back to first <img> found inside the HTML content
    if (!thumbnail) {
      const rawImg = (block.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
      thumbnail = (unescapeHtml(rawImg).match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    }

    // Content is HTML-escaped; unescape then strip tags for snippet
    const rawContent  = (block.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
    const plainText   = stripTags(unescapeHtml(rawContent));
    const snippet     = plainText.replace(/\s+/g, ' ').trim().slice(0, 160);

    if (title && url) {
      entries.push({ title, url, image_url: thumbnail, published, snippet });
    }
  }

  return entries;
}

// GET /api/news — public, no auth required
router.get('/', async (req, res) => {
  try {
    if (cache.data && Date.now() < cache.expiry) {
      return res.json(cache.data);
    }

    const { data: xml } = await axios.get(
      'https://lichess.org/@/Lichess/blog.atom',
      { timeout: 8000, headers: { 'User-Agent': 'ChessLens/1.0' } }
    );

    const articles = parseAtom(xml);
    const result   = { articles, source: 'Lichess Blog' };
    cache = { data: result, expiry: Date.now() + CACHE_TTL };
    res.json(result);
  } catch (err) {
    console.error('[news] fetch failed:', err.message);
    // Return cached stale data rather than an error if available
    if (cache.data) return res.json(cache.data);
    res.status(502).json({ message: 'Could not fetch chess news' });
  }
});

module.exports = router;
