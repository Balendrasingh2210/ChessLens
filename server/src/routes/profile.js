/**
 * profile.js — routes for the dashboard and account management
 *
 * GET  /api/profile/dashboard         — single call that returns everything the
 *                                       Dashboard page needs: user, weaknessProfile,
 *                                       recentGames, puzzleStats, openingStats
 * GET  /api/profile/recommendations   — YouTube video recs (requires YOUTUBE_API_KEY;
 *                                       the real logic is client-side, this is a stub)
 * DELETE /api/profile/accounts/:platform — remove a linked chess.com or lichess account
 *
 * All routes require authentication.
 *
 * @module routes/profile
 */

const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const AnalyzedGame = require('../models/AnalyzedGame');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const WeaknessProfile = require('../models/WeaknessProfile');
const { getWeaknessRecommendations } = require('../services/youtubeService');

// Full dashboard data in one call
router.get('/dashboard', protect, async (req, res) => {
  try {
    const [user, weaknessProfile, recentGames, puzzleStats, openingStats] = await Promise.all([
      User.findById(req.user._id).select('-password'),
      WeaknessProfile.findOne({ userId: req.user._id }),
      AnalyzedGame.find({ userId: req.user._id, analysisStatus: 'done' })
        .sort({ playedAt: -1 })
        .limit(5)
        .select('opponent result accuracy platform playedAt opening playerColor playerRating opponentRating'),
      PuzzleAttempt.aggregate([
        { $match: { userId: req.user._id } },
        { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: ['$correct', 1, 0] } } } },
      ]),
      AnalyzedGame.aggregate([
        { $match: { userId: req.user._id, analysisStatus: 'done', opening: { $ne: null } } },
        { $group: {
          _id: '$opening',
          count:       { $sum: 1 },
          wins:        { $sum: { $cond: [{ $eq: ['$result', 'win']  }, 1, 0] } },
          losses:      { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          avgAccuracy: { $avg: '$accuracy' },
        }},
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
    ]);

    res.json({
      user,
      weaknessProfile,
      recentGames,
      puzzleStats: puzzleStats[0] || { total: 0, correct: 0 },
      openingStats: openingStats.map(o => ({
        opening:     o._id,
        count:       o.count,
        wins:        o.wins,
        losses:      o.losses,
        draws:       o.count - o.wins - o.losses,
        avgAccuracy: o.avgAccuracy != null ? Math.round(o.avgAccuracy) : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// YouTube recommendations based on weakness profile (Dashboard)
router.get('/recommendations', protect, async (req, res) => {
  try {
    if (!process.env.YOUTUBE_API_KEY) {
      return res.json({ videos: [], message: 'YouTube API key not configured' });
    }
    const weaknessProfile = await WeaknessProfile.findOne({ userId: req.user._id });
    const videos = await getWeaknessRecommendations(weaknessProfile);
    res.json({ videos });
  } catch (err) {
    console.error('[recommendations] error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// Activity calendar data — games analyzed + puzzles solved per day for last 84 days
router.get('/activity', protect, async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 83);
    since.setHours(0, 0, 0, 0);

    const [gameActivity, puzzleActivity] = await Promise.all([
      AnalyzedGame.aggregate([
        { $match: { userId: req.user._id, analysisStatus: 'done', playedAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$playedAt' } },
          games: { $sum: 1 },
        }},
      ]),
      PuzzleAttempt.aggregate([
        { $match: { userId: req.user._id, createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          puzzles: { $sum: 1 },
          correct: { $sum: { $cond: ['$correct', 1, 0] } },
        }},
      ]),
    ]);

    // Merge into a date-keyed map
    const map = {};
    gameActivity.forEach(d => {
      if (!map[d._id]) map[d._id] = { games: 0, puzzles: 0, correct: 0 };
      map[d._id].games = d.games;
    });
    puzzleActivity.forEach(d => {
      if (!map[d._id]) map[d._id] = { games: 0, puzzles: 0, correct: 0 };
      map[d._id].puzzles = d.puzzles;
      map[d._id].correct = d.correct;
    });

    // Fill all 84 days so the calendar grid is complete
    const days = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, ...(map[key] || { games: 0, puzzles: 0, correct: 0 }) });
    }

    res.json({ days });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Disconnect a platform account
router.delete('/accounts/:platform', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { connectedAccounts: { platform: req.params.platform } },
    });
    res.json({ message: 'Account disconnected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
