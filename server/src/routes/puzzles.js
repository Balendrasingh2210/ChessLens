/**
 * puzzles.js — puzzle trainer routes
 *
 * GET  /api/puzzles/next      — serve the next puzzle for the user
 *   Priority order for selecting a puzzle:
 *     1. Local MongoDB (import-puzzles.js), filtered by weakness theme + rating band
 *     2. Lichess live API (/api/puzzle/next) if local DB is empty
 *     3. Hardcoded FALLBACK_PUZZLES if Lichess also fails
 *
 *   Theme selection (when no ?theme query param):
 *     - User's WeaknessProfile.recommendedThemes, cycled by total attempt count
 *     - Falls back to 'hangingPiece' for new users
 *
 * POST /api/puzzles/attempt   — record a solve attempt (correct/incorrect)
 * GET  /api/puzzles/history   — last 50 attempts with per-theme accuracy stats
 * GET  /api/puzzles/stats     — local DB puzzle count
 *
 * All routes require authentication.
 *
 * @module routes/puzzles
 */

const router       = require('express').Router();
const { protect }  = require('../middleware/auth');
const Puzzle        = require('../models/Puzzle');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const WeaknessProfile = require('../models/WeaknessProfile');

// Lichess theme → our weakness category mapping (for weakness-based selection)
const CATEGORY_THEMES = {
  'tactical':      ['fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection'],
  'hanging-piece': ['hangingPiece', 'trappedPiece', 'capturingDefender'],
  'king-safety':   ['kingSafety', 'attackingF2F7', 'mateIn2', 'mateIn3'],
  'endgame':       ['rookEndgame', 'queenEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame'],
  'positional':    ['quietMove', 'advancedPawn', 'outpost', 'zugzwang'],
  'opening':       ['opening'],
  'time-pressure': ['fork', 'hangingPiece'],
  'other':         ['middlegame'],
};

// Hardcoded fallback pool — used only if local DB is empty
const FALLBACK_PUZZLES = [
  { puzzleId: 'fb-1', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', solution: ['f3g5','f6d5','c4d5'], themes: ['fork','tactical'], rating: 1200, gameUrl: null },
  { puzzleId: 'fb-2', fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',                                   solution: ['e1e8'],             themes: ['backRankMate','mateIn1'], rating: 900,  gameUrl: null },
  { puzzleId: 'fb-3', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'],             themes: ['mateIn1','kingSafety'], rating: 800,  gameUrl: null },
  { puzzleId: 'fb-4', fen: '2rr2k1/pp3ppp/8/3R4/8/1B6/PP3PPP/6K1 w - - 0 1',                         solution: ['d5d8','c8d8','b3f7'], themes: ['discoveredAttack'], rating: 1500, gameUrl: null },
];

/**
 * Pick a random puzzle from local DB matching a theme and rating band.
 * Falls back to any theme in that rating band, then to pure random.
 */
async function getLocalPuzzle(theme, targetRating = 1500) {
  const ratingMin = targetRating - 200;
  const ratingMax = targetRating + 200;

  // Map theme string → list of Lichess theme tags
  const themeTags = CATEGORY_THEMES[theme] || [theme];

  // Try: matching theme + rating band
  let puzzle = await Puzzle.findOne({
    themes: { $in: themeTags },
    rating: { $gte: ratingMin, $lte: ratingMax },
  }).skip(Math.floor(Math.random() * 500)).limit(1).lean();

  // Widen to any rating if nothing found in band
  if (!puzzle) {
    puzzle = await Puzzle.findOne({ themes: { $in: themeTags } })
      .skip(Math.floor(Math.random() * 1000)).limit(1).lean();
  }

  // Last resort: totally random puzzle
  if (!puzzle) {
    const count = await Puzzle.countDocuments();
    if (count > 0) {
      puzzle = await Puzzle.findOne().skip(Math.floor(Math.random() * count)).limit(1).lean();
    }
  }

  return puzzle;
}

// ── GET /api/puzzles/next ─────────────────────────────────────────────────────

router.get('/next', protect, async (req, res) => {
  try {
    const { theme } = req.query;

    // Determine theme from query param or user's weakness profile
    let puzzleTheme = theme;
    let targetRating = 1500;

    if (!puzzleTheme) {
      const profile = await WeaknessProfile.findOne({ userId: req.user._id });
      if (profile?.recommendedThemes?.length > 0) {
        const attemptCount = await PuzzleAttempt.countDocuments({ userId: req.user._id });
        puzzleTheme = profile.recommendedThemes[attemptCount % profile.recommendedThemes.length];
        targetRating = profile.averageRating || 1500;
      } else {
        puzzleTheme = 'hangingPiece';
      }
    }

    // Check if local DB has puzzles
    const dbCount = await Puzzle.estimatedDocumentCount();

    let puzzle;
    if (dbCount > 0) {
      // Serve from local DB — fast, unlimited
      const doc = await getLocalPuzzle(puzzleTheme, targetRating);
      if (doc) {
        // Lichess CSV format: moves[0] is the opponent's last game move (the "intro"
        // that created the tactic). Apply it so the board shows the position the
        // player actually needs to solve, with the correct side to move.
        let fen      = doc.fen;
        let solution = doc.moves;
        if (doc.moves.length > 1) {
          try {
            const { Chess } = require('chess.js');
            const tmp   = new Chess();
            tmp.load(doc.fen);
            const intro = doc.moves[0];
            tmp.move({ from: intro.slice(0, 2), to: intro.slice(2, 4), promotion: intro[4] || undefined });
            fen      = tmp.fen();
            solution = doc.moves.slice(1);
          } catch { /* keep raw FEN/moves if intro move fails to parse */ }
        }
        puzzle = {
          puzzleId: doc.puzzleId,
          fen,
          solution,
          themes:   doc.themes,
          rating:   doc.rating,
          gameUrl:  doc.gameUrl,
        };
      }
    }

    // If local DB is empty or query returned nothing, use fallback
    if (!puzzle) {
      puzzle = FALLBACK_PUZZLES[Math.floor(Math.random() * FALLBACK_PUZZLES.length)];
      // Also try Lichess as a live fallback (non-blocking — if it fails, use hardcoded)
      try {
        const { fetchPuzzle } = require('../services/lichessService');
        puzzle = await fetchPuzzle(puzzleTheme);
      } catch { /* use hardcoded above */ }
    }

    res.json({ puzzle, theme: puzzleTheme, source: dbCount > 0 ? 'local' : 'fallback' });
  } catch (err) {
    console.error('[Puzzles] /next error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/puzzles/attempt ─────────────────────────────────────────────────

router.post('/attempt', protect, async (req, res) => {
  try {
    const { puzzleId, theme, fen, solution, correct, timeTaken } = req.body;

    await PuzzleAttempt.create({
      userId: req.user._id,
      puzzleId,
      theme,
      fen,
      solution,
      correct,
      timeTaken,
    });

    const stats = await PuzzleAttempt.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
    ]);

    res.json({
      message: correct ? '✅ Correct!' : '❌ Incorrect',
      stats: stats[0] || { total: 0, correct: 0 },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/puzzles/history ──────────────────────────────────────────────────

router.get('/history', protect, async (req, res) => {
  try {
    const attempts = await PuzzleAttempt.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    const byTheme = {};
    for (const a of attempts) {
      if (!byTheme[a.theme]) byTheme[a.theme] = { total: 0, correct: 0 };
      byTheme[a.theme].total++;
      if (a.correct) byTheme[a.theme].correct++;
    }

    res.json({ attempts, byTheme });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/puzzles/stats ────────────────────────────────────────────────────

router.get('/stats', protect, async (req, res) => {
  try {
    const dbCount = await Puzzle.estimatedDocumentCount();
    res.json({ localPuzzleCount: dbCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
