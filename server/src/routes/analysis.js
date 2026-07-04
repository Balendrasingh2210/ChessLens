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
    const result = await AnalyzedGame.aggregate([
      { $match: { userId: req.user._id, analysisStatus: 'done' } },
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

module.exports = router;
