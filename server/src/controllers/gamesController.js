const { Chess } = require('chess.js');
const User = require('../models/User');
const AnalyzedGame = require('../models/AnalyzedGame');
const { fetchGames: fetchChessCom, verifyUser: verifyChessCom } = require('../services/chessComService');
const { fetchGames: fetchLichess, verifyUser: verifyLichess } = require('../services/lichessService');
const { enqueueGame } = require('../workers/analysisWorker');
const { detectOpening } = require('../services/openingService');

/**
 * Connect a chess.com or lichess account
 */
exports.connectAccount = async (req, res) => {
  try {
    const { platform, username } = req.body;
    if (!platform || !username) return res.status(400).json({ message: 'platform and username required' });
    if (!['chess.com', 'lichess'].includes(platform))
      return res.status(400).json({ message: 'platform must be chess.com or lichess' });

    // Verify the account exists
    let profile;
    try {
      profile = platform === 'chess.com'
        ? await verifyChessCom(username)
        : await verifyLichess(username);
    } catch {
      return res.status(404).json({ message: `Username "${username}" not found on ${platform}` });
    }

    // Check if already connected
    const alreadyConnected = req.user.connectedAccounts.find(
      (a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase()
    );
    if (alreadyConnected)
      return res.status(409).json({ message: `${platform} account already connected` });

    await User.findByIdAndUpdate(req.user._id, {
      $push: { connectedAccounts: { platform, username: profile.username } },
    });

    res.json({ message: 'Account connected', profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Fetch + queue analysis for a user's recent games
 */
exports.importGames = async (req, res) => {
  try {
    const { platform, username, count = 20 } = req.body;

    const account = req.user.connectedAccounts.find(
      (a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase()
    );
    if (!account) return res.status(400).json({ message: 'Account not connected' });

    // Fetch games from platform
    const games = platform === 'chess.com'
      ? await fetchChessCom(username, Math.min(count, 50))
      : await fetchLichess(username, Math.min(count, 50));

    let imported = 0;
    let skipped = 0;
    const queued = [];

    for (const g of games) {
      // Skip if already analyzed
      const exists = await AnalyzedGame.findOne({
        userId: req.user._id, platform, gameId: g.gameId,
      });
      if (exists) { skipped++; continue; }

      // Save to DB with pending status
      // Detect opening from ECO database immediately (analysis will refine later)
      const ecoResult = detectOpening(g.pgn);
      const doc = await AnalyzedGame.create({
        userId: req.user._id,
        platform,
        gameId: g.gameId,
        pgn: g.pgn,
        playerColor: g.playerColor,
        opponent: g.opponent,
        playerRating: g.playerRating,
        opponentRating: g.opponentRating,
        result: g.result,
        timeControl: g.timeControl,
        playedAt: g.playedAt,
        opening: ecoResult?.name ?? g.opening,
        eco:     ecoResult?.eco  ?? null,
        analysisStatus: 'pending',
      });

      // Queue for background Stockfish analysis
      await enqueueGame(doc._id.toString(), req.user._id.toString());
      queued.push(doc._id);
      imported++;
    }

    // Update lastSynced
    await User.findOneAndUpdate(
      { _id: req.user._id, 'connectedAccounts.platform': platform, 'connectedAccounts.username': account.username },
      { $set: { 'connectedAccounts.$.lastSynced': new Date() } }
    );

    res.json({
      message: `Imported ${imported} new games (${skipped} already analyzed)`,
      imported,
      skipped,
      queuedIds: queued,
    });
  } catch (err) {
    console.error('[importGames] error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || 'Import failed' });
    }
  }
};

/**
 * Get all analyzed games for the user
 */
exports.getMyGames = async (req, res) => {
  try {
    const { platform, status, page = 1, limit = 20 } = req.query;
    const filter = { userId: req.user._id };
    if (platform) filter.platform = platform;
    if (status) filter.analysisStatus = status;

    const total = await AnalyzedGame.countDocuments(filter);
    const games = await AnalyzedGame.find(filter)
      .sort({ playedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('-pgn -mistakes.playedFen'); // exclude heavy fields from list view

    res.json({ games, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Delete all analyzed games for the current user
 */
exports.deleteAllGames = async (req, res) => {
  try {
    const result = await AnalyzedGame.deleteMany({ userId: req.user._id });
    res.json({ message: `Deleted ${result.deletedCount} games`, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Import pre-fetched games from the browser (bypasses server-side chess.com blocks).
 * Frontend fetches directly from chess.com API (CORS-enabled), sends raw game objects here.
 */
exports.importRaw = async (req, res) => {
  try {
    const { games: rawGames, platform = 'chess.com', username } = req.body;
    if (!Array.isArray(rawGames) || !username) {
      return res.status(400).json({ message: 'games array and username are required' });
    }

    let imported = 0;
    let skipped = 0;

    for (const g of rawGames) {
      const exists = await AnalyzedGame.findOne({
        userId: req.user._id, platform, gameId: g.gameId,
      });
      if (exists) { skipped++; continue; }

      const ecoResult = detectOpening(g.pgn);
      const doc = await AnalyzedGame.create({
        userId: req.user._id,
        platform,
        gameId:         g.gameId,
        pgn:            g.pgn,
        playerColor:    g.playerColor,
        opponent:       g.opponent,
        playerRating:   g.playerRating,
        opponentRating: g.opponentRating,
        result:         g.result,
        timeControl:    g.timeControl,
        playedAt:       new Date(g.playedAt),
        opening:        ecoResult?.name ?? g.opening ?? null,
        eco:            ecoResult?.eco  ?? null,
        analysisStatus: 'pending',
      });

      await enqueueGame(doc._id.toString(), req.user._id.toString());
      imported++;
    }

    await User.findOneAndUpdate(
      { _id: req.user._id, 'connectedAccounts.platform': platform, 'connectedAccounts.username': username },
      { $set: { 'connectedAccounts.$.lastSynced': new Date() } }
    );

    res.json({
      message: `Imported ${imported} game${imported !== 1 ? 's' : ''} (${skipped} already analyzed)`,
      imported,
      skipped,
    });
  } catch (err) {
    console.error('[importRaw] error:', err.message);
    if (!res.headersSent) res.status(500).json({ message: err.message });
  }
};

/**
 * Import games from raw PGN text (manual paste — no chess.com API needed)
 */
exports.importPgn = async (req, res) => {
  try {
    const { pgn, platform = 'chess.com', username } = req.body;
    if (!pgn || !username) return res.status(400).json({ message: 'pgn and username are required' });

    // Split multi-game PGN on double newline before [Event
    const blocks = pgn.split(/\n(?=\[Event\s)/).map(b => b.trim()).filter(Boolean);
    if (!blocks.length) return res.status(400).json({ message: 'No valid PGN games found' });

    let imported = 0;
    let skipped = 0;

    for (const block of blocks) {
      const chess = new Chess();
      try {
        chess.loadPgn(block);
      } catch {
        skipped++;
        continue;
      }

      // Parse headers
      const headers = chess.header();
      const white = headers.White || 'White';
      const black = headers.Black || 'Black';
      const playerColor = white.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
      const opponent = playerColor === 'white' ? black : white;
      const resultHeader = headers.Result ?? '*';
      const result =
        resultHeader === '1-0' ? (playerColor === 'white' ? 'win' : 'loss') :
        resultHeader === '0-1' ? (playerColor === 'black' ? 'win' : 'loss') :
        'draw';

      // Build a stable gameId from white+black+date+first move
      const dateStr = headers.Date ?? '';
      const firstMove = chess.history()[0] ?? '';
      const gameId = Buffer.from(`${white}|${black}|${dateStr}|${firstMove}`).toString('base64').slice(0, 24);

      const exists = await AnalyzedGame.findOne({ userId: req.user._id, platform, gameId });
      if (exists) { skipped++; continue; }

      const playedAt = headers.Date
        ? new Date(headers.Date.replace(/\./g, '-'))
        : new Date();

      const ecoResult = detectOpening(block);
      const doc = await AnalyzedGame.create({
        userId: req.user._id,
        platform,
        gameId,
        pgn: block,
        playerColor,
        opponent,
        playerRating:   parseInt(headers[playerColor === 'white' ? 'WhiteElo' : 'BlackElo']) || null,
        opponentRating: parseInt(headers[playerColor === 'white' ? 'BlackElo' : 'WhiteElo']) || null,
        result,
        timeControl: headers.TimeControl || null,
        playedAt,
        opening: ecoResult?.name ?? headers.Opening ?? headers.ECO ?? null,
        eco:     ecoResult?.eco  ?? null,
        analysisStatus: 'pending',
      });

      await enqueueGame(doc._id.toString(), req.user._id.toString());
      imported++;
    }

    res.json({
      message: `Imported ${imported} game${imported !== 1 ? 's' : ''} (${skipped} skipped)`,
      imported,
      skipped,
    });
  } catch (err) {
    console.error('[importPgn] error:', err.message);
    if (!res.headersSent) res.status(500).json({ message: err.message });
  }
};

/**
 * Disconnect a linked platform account
 */
exports.disconnectAccount = async (req, res) => {
  try {
    const { platform, username } = req.params;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { connectedAccounts: { platform, username } },
    });
    res.json({ message: `Disconnected ${platform} account ${username}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// YouTube recommendations moved to browser — see client/src/hooks/useYouTubeRecs.ts

/**
 * Get a single analyzed game with full details
 */
exports.getGame = async (req, res) => {
  try {
    const game = await AnalyzedGame.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!game) return res.status(404).json({ message: 'Game not found' });
    res.json({ game });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
