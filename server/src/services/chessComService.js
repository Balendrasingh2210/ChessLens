/**
 * chessComService.js — Chess.com public API adapter
 *
 * Chess.com's API is CORS-enabled from browsers, so game fetching can be
 * done client-side too (see gamesController.importRaw for the client-side path).
 * This server-side adapter is used when the server can reach Chess.com directly.
 *
 * Rate limits: Chess.com does not publish limits but blocks aggressive crawlers.
 * We cache user profiles for 1 hour and game archives for 30 minutes.
 *
 * Game archive structure:
 *   Chess.com organises games by month. We iterate archive URLs newest-first
 *   and stop once we have enough games, to avoid fetching unnecessary months.
 *
 * @module services/chessComService
 */

const axios = require('axios');
const { cache } = require('../config/redis');

const BASE = 'https://api.chess.com/pub';

// Simple client — just like the original that worked
const client = axios.create({
  baseURL: BASE,
  headers: { 'User-Agent': 'ChessLens/1.0 (contact@chesslens.app)' },
  timeout: 30000,
});

exports.verifyUser = async (username) => {
  const cacheKey = `chesscom:user:${username}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const { data } = await client.get(`/player/${username}`);
  const profile = {
    username: data.username,
    rating: data.stats?.chess_rapid?.last?.rating ?? null,
    avatar: data.avatar ?? null,
    joined: data.joined,
    country: data.country,
  };

  await cache.set(cacheKey, profile, 3600);
  return profile;
};

exports.fetchGames = async (username, maxGames = 50) => {
  const cacheKey = `chesscom:games:${username}:${maxGames}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  // Step 1: get the list of archive URLs (only months that actually have games)
  console.log(`[chess.com] fetching archives list for ${username}`);
  const { data: archiveData } = await client.get(`/player/${username}/games/archives`);
  const archiveUrls = (archiveData.archives || []).slice().reverse(); // newest first
  console.log(`[chess.com] found ${archiveUrls.length} archive months`);

  if (!archiveUrls.length) return [];

  // Step 2: fetch archives one by one (newest first) until we have enough
  const games = [];

  for (const url of archiveUrls) {
    if (games.length >= maxGames) break;

    console.log(`[chess.com] fetching ${url}`);
    let monthGames;
    try {
      const { data } = await client.get(url);
      monthGames = data.games || [];
      console.log(`[chess.com] got ${monthGames.length} games`);
    } catch (err) {
      console.warn(`[chess.com] skipping ${url}: ${err.message}`);
      continue;
    }

    for (const game of monthGames.slice().reverse()) {
      if (games.length >= maxGames) break;
      if (!game.pgn) continue;

      const playerColor =
        game.white.username.toLowerCase() === username.toLowerCase() ? 'white' : 'black';

      const playerResult = playerColor === 'white' ? game.white.result : game.black.result;
      const result =
        playerResult === 'win'                                                          ? 'win'  :
        ['resigned', 'timeout', 'checkmated', 'abandoned'].includes(playerResult)       ? 'loss' :
                                                                                          'draw';

      games.push({
        gameId:         game.url.split('/').pop(),
        pgn:            game.pgn,
        platform:       'chess.com',
        playerColor,
        opponent:       playerColor === 'white' ? game.black.username : game.white.username,
        playerRating:   playerColor === 'white' ? game.white.rating   : game.black.rating,
        opponentRating: playerColor === 'white' ? game.black.rating   : game.white.rating,
        result,
        timeControl:    game.time_control,
        playedAt:       new Date(game.end_time * 1000),
        opening:        null,
        url:            game.url,
      });
    }
  }

  await cache.set(cacheKey, games, 1800);
  return games;
};
