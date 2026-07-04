const axios = require('axios');
const { cache } = require('../config/redis');

const BASE = 'https://lichess.org/api';

const client = axios.create({
  baseURL: BASE,
  headers: {
    'User-Agent': 'ChessLens/1.0',
    'Accept': 'application/json',
  },
  timeout: 6000,
});

/**
 * Verify a Lichess username
 */
exports.verifyUser = async (username) => {
  const cacheKey = `lichess:user:${username}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const { data } = await client.get(`/user/${username}`);
  const profile = {
    username: data.username,
    rating: data.perfs?.rapid?.rating ?? data.perfs?.blitz?.rating ?? null,
    title: data.title ?? null,
    joined: data.createdAt,
  };

  await cache.set(cacheKey, profile, 3600);
  return profile;
};

/**
 * Fetch recent games from Lichess (NDJSON stream)
 */
exports.fetchGames = async (username, maxGames = 50) => {
  const cacheKey = `lichess:games:${username}:${maxGames}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  // Lichess exports games as NDJSON with clocks and opening tags
  const response = await axios.get(`${BASE}/games/user/${username}`, {
    params: {
      max: maxGames,
      rated: true,
      pgnInJson: true,
      clocks: true,
      opening: true,
      tags: true,
    },
    headers: {
      'Accept': 'application/x-ndjson',
      'User-Agent': 'ChessLens/1.0',
    },
    responseType: 'text',
    timeout: 20000,
  });

  // Parse NDJSON (each line is a JSON object)
  const lines = response.data.trim().split('\n').filter(Boolean);
  const games = lines.map((line) => {
    const g = JSON.parse(line);
    const playerColor =
      g.players.white.user?.id?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';

    const playerResult = g.winner
      ? (g.winner === playerColor ? 'win' : 'loss')
      : 'draw';

    return {
      gameId: g.id,
      pgn: g.pgn || '',
      platform: 'lichess',
      playerColor,
      opponent:
        playerColor === 'white'
          ? (g.players.black.user?.name ?? 'Anonymous')
          : (g.players.white.user?.name ?? 'Anonymous'),
      playerRating:
        playerColor === 'white' ? g.players.white.rating : g.players.black.rating,
      opponentRating:
        playerColor === 'white' ? g.players.black.rating : g.players.white.rating,
      result: playerResult,
      timeControl: g.clock ? `${g.clock.initial}+${g.clock.increment}` : null,
      playedAt: new Date(g.createdAt),
      opening: g.opening?.name ?? null,
      url: `https://lichess.org/${g.id}`,
      // Lichess includes clock times in PGN — useful for time pressure detection
      clocks: g.clocks ?? [],
    };
  });

  await cache.set(cacheKey, games, 1800);
  return games;
};

// In-memory puzzle pool: { [theme]: puzzle[] }
const puzzlePool = {};
const POOL_SIZE  = 5; // pre-fetch up to 5 puzzles per theme

function parseLichessPuzzle(data) {
  const { Chess } = require('chess.js');
  const chess = new Chess();
  try { chess.loadPgn(data.game.pgn); } catch { /* ignore */ }

  const history   = chess.history({ verbose: true });
  const targetPly = data.puzzle.initialPly;
  const replay    = new Chess();
  for (let i = 0; i < Math.min(targetPly - 1, history.length); i++) {
    replay.move(history[i]);
  }
  // Sanity-check: ensure side-to-move matches solution[0]'s piece color
  const sol0 = data.puzzle.solution?.[0];
  if (sol0) {
    const piece = replay.get(sol0.slice(0, 2));
    if (piece && piece.color !== replay.turn()) {
      replay.move(history[Math.min(targetPly - 1, history.length - 1)]);
    }
  }
  return {
    puzzleId: data.puzzle.id,
    fen:      replay.fen(),
    solution: data.puzzle.solution,
    themes:   data.puzzle.themes,
    rating:   data.puzzle.rating,
    gameUrl:  data.game.id ? `https://lichess.org/${data.game.id}` : null,
  };
}

async function fetchFromLichess(theme, difficulty) {
  const { data } = await client.get('/puzzle/next', { params: { theme, difficulty } });
  return parseLichessPuzzle(data);
}

// Silently refill pool in background (no await, swallow errors)
function refillPool(theme, difficulty) {
  if ((puzzlePool[theme]?.length ?? 0) >= POOL_SIZE) return;
  fetchFromLichess(theme, difficulty)
    .then(p => {
      if (!puzzlePool[theme]) puzzlePool[theme] = [];
      puzzlePool[theme].push(p);
    })
    .catch(() => {}); // rate-limit errors are silently ignored
}

/**
 * Fetch the Lichess daily puzzle (separate endpoint — not rate-limited the same way)
 */
exports.fetchDailyPuzzle = async () => {
  const { data } = await client.get('/puzzle/daily');
  return parseLichessPuzzle(data);
};

/**
 * Fetch puzzles from Lichess by theme (with in-memory pool to absorb rate limits)
 */
exports.fetchPuzzle = async (theme = 'hangingPiece', difficulty = 'normal') => {
  // Serve from pool if available
  if (puzzlePool[theme]?.length > 0) {
    const puzzle = puzzlePool[theme].shift();
    refillPool(theme, difficulty); // kick off background refill
    return puzzle;
  }

  // Pool empty — fetch live (may throw 429, caller sees error)
  const puzzle = await fetchFromLichess(theme, difficulty);
  refillPool(theme, difficulty); // start building pool for next time
  return puzzle;
};

/**
 * Map our weakness categories → Lichess puzzle themes
 */
exports.categoryToThemes = {
  'tactical':       ['fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection'],
  'hanging-piece':  ['hangingPiece', 'trappedPiece', 'capturingDefender'],
  'king-safety':    ['kingSafety', 'attackingF2F7', 'mateIn2', 'mateIn3'],
  'endgame':        ['rookEndgame', 'queenEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame'],
  'positional':     ['quietMove', 'advancedPawn', 'outpost', 'zugzwang'],
  'opening':        ['opening'],
  'time-pressure':  ['fork', 'hangingPiece'], // simple tactics for time pressure training
  'other':          ['middlegame'],
};
