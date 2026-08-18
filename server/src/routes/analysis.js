/**
 * analysis.js — routes for weakness analysis data
 *
 * GET /api/analysis/profile    — weakness profile + Groq coaching summary
 * GET /api/analysis/status     — count of games per analysisStatus
 * GET /api/analysis/breakdown  — aggregated mistake counts by category and type
 *                                (optional ?limit=N restricts to N most recent games)
 *
 * All routes require authentication (protect middleware).
 *
 * @module routes/analysis
 */

const router = require('express').Router();
const { protect } = require('../middleware/auth');
const WeaknessProfile = require('../models/WeaknessProfile');
const AnalyzedGame = require('../models/AnalyzedGame');
const { generateCoachingSummary } = require('../services/claudeService');

// Get weakness profile
router.get('/profile', protect, async (req, res) => {
  try {
    const profile = await WeaknessProfile.findOne({ userId: req.user._id });
    if (!profile) return res.json({ profile: null });

    // Generate coaching summary with Claude
    const summary = await generateCoachingSummary(profile);
    res.json({ profile, coachingSummary: summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get analysis status for pending/analyzing games
router.get('/status', protect, async (req, res) => {
  try {
    const counts = await AnalyzedGame.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$analysisStatus', count: { $sum: 1 } } },
    ]);
    const status = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    res.json({ status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get breakdown of mistakes across all games (for charts)
router.get('/breakdown', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    const baseMatch = { userId: req.user._id, analysisStatus: 'done' };

    let matchStage = baseMatch;
    if (limit > 0) {
      const recent = await AnalyzedGame.find(baseMatch)
        .sort({ playedAt: -1 })
        .limit(limit)
        .select('_id');
      matchStage = { ...baseMatch, _id: { $in: recent.map(g => g._id) } };
    }

    const result = await AnalyzedGame.aggregate([
      { $match: matchStage },
      { $unwind: '$mistakes' },
      {
        $group: {
          _id: { category: '$mistakes.category', type: '$mistakes.type' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const byCategory = {};
    const byType = {};
    for (const r of result) {
      const cat = r._id.category;
      const type = r._id.type;
      byCategory[cat] = (byCategory[cat] || 0) + r.count;
      byType[type] = (byType[type] || 0) + r.count;
    }

    res.json({ byCategory, byType });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Accuracy per game over time (for line chart)
router.get('/accuracy-trend', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const games = await AnalyzedGame.find({
      userId: req.user._id,
      analysisStatus: 'done',
      accuracy: { $ne: null },
    })
      .sort({ playedAt: -1 })
      .limit(Math.min(limit, 100))
      .select('accuracy result opponent playedAt opening playerRating');

    // Reverse so oldest game is index 0 (left side of chart)
    res.json({ games: games.reverse() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mistake count bucketed by clock time remaining (time pressure heatmap)
router.get('/time-pressure', protect, async (req, res) => {
  try {
    const result = await AnalyzedGame.aggregate([
      { $match: { userId: req.user._id, analysisStatus: 'done' } },
      { $unwind: '$mistakes' },
      { $match: { 'mistakes.clockBefore': { $ne: null, $gte: 0 } } },
      { $project: { clock: '$mistakes.clockBefore', type: '$mistakes.type' } },
    ]);

    const buckets = [
      { label: '< 10s',   min: 0,   max: 10  },
      { label: '10–20s',  min: 10,  max: 20  },
      { label: '20–30s',  min: 20,  max: 30  },
      { label: '30–60s',  min: 30,  max: 60  },
      { label: '1–2 min', min: 60,  max: 120 },
      { label: '2 min+',  min: 120, max: Infinity },
    ].map(b => ({ ...b, count: 0, blunders: 0, mistakes: 0 }));

    for (const m of result) {
      const b = buckets.find(bk => m.clock >= bk.min && m.clock < bk.max);
      if (!b) continue;
      b.count++;
      if (m.type === 'blunder')  b.blunders++;
      if (m.type === 'mistake')  b.mistakes++;
    }

    res.json({
      buckets: buckets.map(({ label, count, blunders, mistakes }) => ({ label, count, blunders, mistakes })),
      hasClockData: result.length > 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Opening repertoire: per-opening win rate + accuracy + mistake count
router.get('/openings', protect, async (req, res) => {
  try {
    const result = await AnalyzedGame.aggregate([
      { $match: { userId: req.user._id, analysisStatus: 'done', opening: { $ne: null } } },
      { $addFields: {
          openingMistakes: {
            $size: { $filter: { input: '$mistakes', as: 'm', cond: { $eq: ['$$m.category', 'opening'] } } }
          }
      }},
      { $group: {
        _id: '$opening',
        eco:            { $first: '$eco' },
        count:          { $sum: 1 },
        wins:           { $sum: { $cond: [{ $eq: ['$result', 'win']  }, 1, 0] } },
        losses:         { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
        avgAccuracy:    { $avg: '$accuracy' },
        openingMistakes:{ $sum: '$openingMistakes' },
        totalMistakes:  { $sum: { $size: '$mistakes' } },
      }},
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]);

    res.json({
      openings: result.map(o => ({
        opening:         o._id,
        eco:             o.eco,
        count:           o.count,
        wins:            o.wins,
        losses:          o.losses,
        draws:           o.count - o.wins - o.losses,
        winRate:         Math.round((o.wins / o.count) * 100),
        avgAccuracy:     o.avgAccuracy != null ? Math.round(o.avgAccuracy) : null,
        openingMistakes: o.openingMistakes,
        totalMistakes:   o.totalMistakes,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Performance broken down by opponent rating band
router.get('/rating-bands', protect, async (req, res) => {
  try {
    const games = await AnalyzedGame.find({
      userId: req.user._id,
      analysisStatus: 'done',
      playerRating: { $ne: null },
      opponentRating: { $ne: null },
    }).select('playerRating opponentRating result accuracy');

    const bands = [
      { label: 'Much weaker  (200+)',  min:  200, max: Infinity, count: 0, wins: 0, losses: 0, draws: 0, accSum: 0, accCnt: 0 },
      { label: 'Weaker  (100–200)',    min:  100, max: 200,      count: 0, wins: 0, losses: 0, draws: 0, accSum: 0, accCnt: 0 },
      { label: 'Similar  (±100)',      min: -100, max: 100,      count: 0, wins: 0, losses: 0, draws: 0, accSum: 0, accCnt: 0 },
      { label: 'Stronger  (100–200)', min: -200, max: -100,     count: 0, wins: 0, losses: 0, draws: 0, accSum: 0, accCnt: 0 },
      { label: 'Much stronger  (200+)',min: -Infinity, max: -200, count: 0, wins: 0, losses: 0, draws: 0, accSum: 0, accCnt: 0 },
    ];

    for (const g of games) {
      const diff = g.playerRating - g.opponentRating; // positive = player is stronger
      const band = bands.find(b => diff >= b.min && diff < b.max);
      if (!band) continue;
      band.count++;
      if (g.result === 'win')  band.wins++;
      if (g.result === 'loss') band.losses++;
      if (g.result === 'draw') band.draws++;
      if (g.accuracy != null) { band.accSum += g.accuracy; band.accCnt++; }
    }

    res.json({
      bands: bands
        .filter(b => b.count > 0)
        .map(({ label, count, wins, losses, draws, accSum, accCnt }) => ({
          label,
          count,
          wins,
          losses,
          draws,
          winRate: Math.round((wins / count) * 100),
          avgAccuracy: accCnt > 0 ? Math.round(accSum / accCnt) : null,
        })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Endgame theme detector: categorise endgame types from mistake FENs
router.get('/endgame-themes', protect, async (req, res) => {
  try {
    const { Chess } = require('chess.js');

    function categoriseEndgame(fen) {
      try {
        const ch = new Chess(fen);
        const pieces = ch.board().flat().filter(Boolean);
        const has  = t => pieces.some(p => p.type === t);
        if (has('q')) return 'Queen endgame';
        if (has('r') && (has('b') || has('n'))) return 'Rook + minor piece';
        if (has('r')) return 'Rook endgame';
        if (has('b') && has('n')) return 'Bishop vs Knight';
        if (has('b')) return 'Bishop endgame';
        if (has('n')) return 'Knight endgame';
        if (has('p')) return 'King & Pawn';
        return 'King vs King';
      } catch { return 'Other'; }
    }

    const games = await AnalyzedGame.find({
      userId: req.user._id,
      analysisStatus: 'done',
    }).select('mistakes result');

    const themeMap = {};

    for (const game of games) {
      for (const m of game.mistakes) {
        if (m.category !== 'endgame') continue;
        if (!m.playedFen) continue;
        const theme = categoriseEndgame(m.playedFen);
        if (!themeMap[theme]) themeMap[theme] = { count: 0, wins: 0, losses: 0, draws: 0 };
        themeMap[theme].count++;
        // Note: a game may have multiple endgame mistakes, we only need game result
      }
      // Also track game results by endgame theme
      const endgameMistakes = game.mistakes.filter(m => m.category === 'endgame');
      const seenThemes = new Set();
      for (const m of endgameMistakes) {
        if (!m.playedFen) continue;
        const theme = categoriseEndgame(m.playedFen);
        if (seenThemes.has(theme)) continue;
        seenThemes.add(theme);
        if (!themeMap[theme]) themeMap[theme] = { count: 0, wins: 0, losses: 0, draws: 0 };
        themeMap[theme][`${game.result}s`] = (themeMap[theme][`${game.result}s`] || 0) + 1;
      }
    }

    const themes = Object.entries(themeMap)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({ name, ...data }));

    res.json({ themes, hasSufficientData: themes.length > 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Opponent history: how you've performed against specific opponents
router.get('/opponents', protect, async (req, res) => {
  try {
    const result = await AnalyzedGame.aggregate([
      { $match: { userId: req.user._id, analysisStatus: 'done' } },
      { $group: {
        _id: '$opponent',
        count:       { $sum: 1 },
        wins:        { $sum: { $cond: [{ $eq: ['$result', 'win']  }, 1, 0] } },
        losses:      { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
        draws:       { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
        avgAccuracy: { $avg: '$accuracy' },
        avgOppRating:{ $avg: '$opponentRating' },
        lastPlayed:  { $max: '$playedAt' },
      }},
      { $match: { count: { $gte: 2 } } }, // only show repeated opponents
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]);

    res.json({
      opponents: result.map(o => ({
        opponent:     o._id,
        count:        o.count,
        wins:         o.wins,
        losses:       o.losses,
        draws:        o.draws,
        winRate:      Math.round((o.wins / o.count) * 100),
        avgAccuracy:  o.avgAccuracy != null ? Math.round(o.avgAccuracy) : null,
        avgRating:    o.avgOppRating != null ? Math.round(o.avgOppRating) : null,
        lastPlayed:   o.lastPlayed,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
