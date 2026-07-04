const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { connectAccount, importGames, importRaw, importPgn, getMyGames, getGame, deleteAllGames, getRecommendations } = require('../controllers/gamesController');

router.use(protect);

router.post('/connect', connectAccount);
router.post('/import', importGames);
router.post('/import-raw', importRaw);
router.post('/import-pgn', importPgn);
router.delete('/all', deleteAllGames);
router.get('/', getMyGames);
router.get('/:id/recommendations', getRecommendations);
router.get('/:id', getGame);

module.exports = router;
