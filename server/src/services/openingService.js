/**
 * openingService.js
 *
 * Detects the most specific chess opening name for a game by replaying its
 * moves and matching each position against the Lichess ECO database
 * (3,608 entries, bundled via the chess-openings npm package).
 *
 * The FEN keys in the ECO map omit halfmove/fullmove counters, so we
 * normalise every position to the same 4-part format before comparing.
 *
 * Usage:
 *   const { detectOpening } = require('./openingService');
 *   const opening = detectOpening(pgn);
 *   // => { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' } | null
 */

const { Chess } = require('chess.js');
const path      = require('path');

// ── Load ECO data ──────────────────────────────────────────────────────────────
// The chess-openings package ships eco.js with keys like:
//   'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
// (4-part FEN: pieces, turn, castling, ep — no halfmove/fullmove)

let ecoMap = null;

function loadEco() {
  if (ecoMap) return;
  try {
    const pkgDir = path.dirname(require.resolve('chess-openings'));
    const { eco } = require(path.join(pkgDir, 'chess', 'openings', 'eco.js'));
    ecoMap = eco; // Object keyed by normalised FEN
    console.log(`📖 ECO database loaded: ${Object.keys(ecoMap).length} openings`);
  } catch (err) {
    console.warn('⚠️  chess-openings package not found — opening detection disabled:', err.message);
    ecoMap = {};
  }
}

/**
 * Strip halfmove clock and fullmove number from a FEN string.
 * "rnbq.../... b KQkq - 0 1" → "rnbq.../... b KQkq -"
 */
function normaliseFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Replay all moves in a PGN and return the most specific ECO opening found.
 *
 * @param {string} pgn
 * @returns {{ eco: string, name: string } | null}
 */
function detectOpening(pgn) {
  loadEco();
  if (!pgn || Object.keys(ecoMap).length === 0) return null;

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }

  const history    = chess.history({ verbose: true });
  const replay     = new Chess();
  let   lastMatch  = null;

  // Check starting position
  const startKey = normaliseFen(replay.fen());
  if (ecoMap[startKey]) lastMatch = ecoMap[startKey];

  // Replay move by move — last position that matches ECO wins (most specific)
  for (const mv of history) {
    replay.move(mv);
    const key = normaliseFen(replay.fen());
    if (ecoMap[key]) {
      lastMatch = ecoMap[key];
    }
  }

  return lastMatch ? { eco: lastMatch.eco, name: lastMatch.name } : null;
}

/**
 * Convenience: returns just the opening name string (or null).
 */
function detectOpeningName(pgn) {
  const result = detectOpening(pgn);
  if (!result) return null;
  return result.name; // e.g. "Sicilian Defense: Najdorf Variation"
}

module.exports = { detectOpening, detectOpeningName };
