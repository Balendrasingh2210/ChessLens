const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { connectAccount, importGames, importRaw, importPgn, getMyGames, getGame, deleteAllGames, disconnectAccount, retryGame } = require('../controllers/gamesController');
const AnalyzedGame = require('../models/AnalyzedGame');

router.use(protect);

router.post('/connect', connectAccount);
router.post('/import', importGames);
router.post('/import-raw', importRaw);
router.post('/import-pgn', importPgn);
router.delete('/all', deleteAllGames);
router.delete('/account/:platform/:username', disconnectAccount);

// Critical moments: blunder/mistake positions from the user's own games
router.get('/critical-moments', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 50);

    const games = await AnalyzedGame.find({
      userId: req.user._id,
      analysisStatus: 'done',
    }).select('mistakes opponent opening');

    const moments = [];
    for (const game of games) {
      for (const m of game.mistakes) {
        if (m.color !== 'white' && m.color !== 'black') continue;
        if (m.type !== 'blunder' && m.type !== 'mistake') continue;
        if (!m.playedFen || !m.best || m.best === '—') continue;
        moments.push({
          id:         `${game._id}_${m.moveNumber}`,
          fen:        m.playedFen,
          best:       m.best,
          played:     m.played,
          type:       m.type,
          category:   m.category,
          moveNumber: m.moveNumber,
          color:      m.color,
          winDropPct: m.winDropPct,
          opponent:   game.opponent,
          opening:    game.opening,
          gameId:     game._id,
        });
      }
    }

    // Fisher-Yates shuffle then take limit
    for (let i = moments.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [moments[i], moments[j]] = [moments[j], moments[i]];
    }

    res.json({ moments: moments.slice(0, limit), total: moments.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/', getMyGames);
router.post('/:id/retry', retryGame);

router.get('/:id/narrative', async (req, res) => {
  try {
    const game = await AnalyzedGame.findOne({ _id: req.params.id, userId: req.user._id });
    if (!game) return res.status(404).json({ message: 'Game not found' });
    const { generateGameNarrative } = require('../services/claudeService');
    const narrative = await generateGameNarrative(game);
    res.json({ narrative });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', getGame);

module.exports = router;
