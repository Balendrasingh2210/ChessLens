const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { connectAccount, importGames, importRaw, importPgn, getMyGames, getGame, deleteAllGames, disconnectAccount, retryGame } = require('../controllers/gamesController');

router.use(protect);

router.post('/connect', connectAccount);
router.post('/import', importGames);
router.post('/import-raw', importRaw);
router.post('/import-pgn', importPgn);
router.delete('/all', deleteAllGames);
router.delete('/account/:platform/:username', disconnectAccount);
router.get('/', getMyGames);
router.post('/:id/retry', retryGame);
router.get('/:id', getGame);

module.exports = router;
