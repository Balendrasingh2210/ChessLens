/**
 * stockfishService.js — Stockfish engine wrapper + game analysis
 *
 * Architecture — singleton process:
 *   A single Stockfish child process is shared across all analysis jobs.
 *   An internal queue serialises calls so only one position is evaluated
 *   at a time. This avoids spawning/killing Stockfish per game (expensive)
 *   and ensures the UCI protocol isn't violated by concurrent writes.
 *
 * Win% model:
 *   Centipawn scores are converted to win probabilities using the logistic
 *   function from Lichess's accuracy metric: P(win) = 1/(1+e^(-0.00368208*cp))
 *   Per-move accuracy is then: 103.1668 * exp(-0.04354 * winLossPct) - 3.1668
 *   Move classification uses win-% drop thresholds: blunder≥20, mistake≥10, inaccuracy≥5.
 *
 * Key exported function:
 *   analyzeGame(pgn, playerColor) → { mistakes, accuracy, moveHistory }
 *
 * Performance:
 *   Each position is evaluated at MOVETIME=300ms. A 40-move game ≈ 24 seconds.
 *   The eval for position N is cached and reused as "evalBefore" for move N+1,
 *   halving the number of Stockfish calls needed.
 *
 * @module services/stockfishService
 */

const { Chess } = require('chess.js');
const { spawn } = require('child_process');

// ─── Analysis time budget per position (ms) ────────────────────────────────────
const MOVETIME = 300;

// ─── Win% model ────────────────────────────────────────────────────────────────
const WIN_DROP = { blunder: 20, mistake: 10, inaccuracy: 5, good: 2, excellent: 0.5 };

function cpToWinProb(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * c));
}

function perMoveAccuracy(winBefore, winAfterPlayed) {
  const loss = Math.max(0, winBefore - winAfterPlayed) * 100;
  return Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1668);
}

function classifyByWinDrop(drop) {
  if (drop >= WIN_DROP.blunder)    return 'blunder';
  if (drop >= WIN_DROP.mistake)    return 'mistake';
  if (drop >= WIN_DROP.inaccuracy) return 'inaccuracy';
  if (drop >= WIN_DROP.good)       return 'good';
  if (drop >= WIN_DROP.excellent)  return 'excellent';
  return 'best';
}

// ─── Persistent Stockfish process ──────────────────────────────────────────────
let sfProcess = null;
let sfReady   = false;
const queue   = [];
let busy      = false;

function startStockfish() {
  if (sfProcess) return;
  sfProcess = spawn('stockfish', [], { stdio: ['pipe', 'pipe', 'ignore'] });
  sfProcess.on('error', () => { sfProcess = null; sfReady = false; });
  sfProcess.on('exit',  () => { sfProcess = null; sfReady = false; busy = false; });
  sfProcess.stdout.on('data', (data) => {
    const text = data.toString();
    if (!sfReady && text.includes('readyok')) { sfReady = true; processNext(); return; }
    if (busy && queue.length > 0) queue[0].onData(text);
  });
  sfProcess.stdin.write('uci\n');
  sfProcess.stdin.write('isready\n');
}

function processNext() {
  if (busy || queue.length === 0 || !sfReady) return;
  busy = true;
  queue[0].run();
}

/**
 * Evaluate a position and return { cp, bestUci } in a SINGLE Stockfish call.
 * cp   = centipawns from the side-to-move's perspective (positive = that side winning)
 * bestUci = engine's best move in UCI notation (e.g. "e2e4")
 */
function evalWithBest(fen) {
  return new Promise((resolve) => {
    startStockfish();
    let resolved = false;
    let buffer   = '';
    let bestCp   = 0;
    let bestUci  = '0000';

    let timeout = null;

    function finish() {
      if (timeout) clearTimeout(timeout);
      queue.shift();
      busy = false;
      resolve({ cp: bestCp, bestUci });
      processNext();
    }

    const task = {
      onData(text) {
        buffer += text;
        for (const line of buffer.split('\n')) {
          if (resolved) break;

          // Keep updating cp with each info line (last one before bestmove = deepest)
          if (line.startsWith('info') && line.includes('score cp')) {
            const m = line.match(/score cp (-?\d+)/);
            if (m) bestCp = parseInt(m[1], 10);
          }
          if (line.startsWith('info') && line.includes('score mate')) {
            const m = line.match(/score mate (-?\d+)/);
            if (m) bestCp = parseInt(m[1], 10) > 0 ? 10000 : -10000;
          }
          // bestmove line = analysis complete
          if (line.startsWith('bestmove')) {
            const m = line.match(/bestmove (\S+)/);
            if (m && m[1] !== '(none)') bestUci = m[1];
            resolved = true;
            finish();
          }
        }
      },
      run() {
        buffer = '';
        bestCp = 0;
        bestUci = '0000';
        timeout = setTimeout(() => {
          if (!resolved) { resolved = true; finish(); }
        }, 3000);

        sfProcess.stdin.write('ucinewgame\n');
        sfProcess.stdin.write(`position fen ${fen}\n`);
        sfProcess.stdin.write(`go movetime ${MOVETIME}\n`);
      },
    };

    queue.push(task);
    if (sfReady) processNext();
  });
}

/** Convert a UCI move string to SAN on a given FEN. Returns null on failure. */
function uciToSan(fen, uci) {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
    const mv = chess.move({ from, to, promotion: promo || undefined });
    return mv ? mv.san : null;
  } catch { return null; }
}

// ─── Mistake category classifier ──────────────────────────────────────────────
function classifyMistakeCategory({ chess, winDropPct, moveNumber, clockBefore }) {
  const pieceCount = chess.board().flat().filter(Boolean).length;
  if (clockBefore !== null && clockBefore < 30)   return 'time-pressure';
  if (moveNumber <= 10)                            return 'opening';
  if (pieceCount <= 7)                             return 'endgame';
  if (winDropPct >= WIN_DROP.blunder)              return 'hanging-piece';
  return 'positional';
}

// ─── Main analysis function ────────────────────────────────────────────────────
/**
 * Analyse every move in the game (both sides).
 * - accuracy  : based on the game player's moves only
 * - moveHistory: all moves with classification, winPct, bestMove
 * - mistakes  : all suboptimal moves (both sides), tagged with color
 */
exports.analyzeGame = async (pgn, playerColor) => {
  const chess = new Chess();
  try { chess.loadPgn(pgn); } catch { throw new Error('Invalid PGN'); }

  const history    = chess.history({ verbose: true });
  const replay     = new Chess();

  // Extract clock times [%clk H:MM:SS]
  const clockRegex = /\[%clk (\d+):(\d+):(\d+)\]/g;
  const clocks     = [...pgn.matchAll(clockRegex)].map(
    (m) => parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
  );

  // Warm up Stockfish
  startStockfish();
  await new Promise((r) => {
    const check = setInterval(() => { if (sfReady) { clearInterval(check); r(); } }, 100);
    setTimeout(() => { clearInterval(check); r(); }, 5000);
  });

  const mistakes    = [];
  const moveHistory = [];
  let playerAccSum  = 0;
  let playerAccCnt  = 0;

  // Evaluate starting position once — each move's "after" = next move's "before",
  // so we cache and reuse instead of calling Stockfish twice per move.
  let cachedResult;
  try {
    cachedResult = await evalWithBest(replay.fen());
  } catch {
    return { mistakes: [], accuracy: 0, moveHistory: [] };
  }

  for (let i = 0; i < history.length; i++) {
    const move      = history[i];
    const moveColor = i % 2 === 0 ? 'white' : 'black';
    const moveNum   = Math.floor(i / 2) + 1;
    const clockBefore = clocks[i] ?? null;
    const fenBefore = replay.fen();

    // ── Use cached eval for position BEFORE the move ────────────────────────
    const { cp: rawBefore, bestUci } = cachedResult;
    const evalBefore  = rawBefore;
    const bestMoveSan = uciToSan(fenBefore, bestUci);

    // Make the move
    replay.move(move);
    const fenAfter = replay.fen();

    // ── Evaluate position AFTER the move (cache for next iteration) ─────────
    // fenAfter is opponent's turn → cp is from opponent's perspective
    let rawAfter;
    try {
      cachedResult = await evalWithBest(fenAfter);
      rawAfter = cachedResult.cp;
    } catch {
      cachedResult = { cp: 0, bestUci: '0000' };
      continue;
    }

    const evalAfter      = -rawAfter; // convert to moving side's perspective
    const evalAfterWhite = replay.turn() === 'w' ? rawAfter : -rawAfter;

    // ── Win% math ───────────────────────────────────────────────────────────
    const winBefore      = cpToWinProb(evalBefore);
    const winAfterPlayed = cpToWinProb(evalAfter);
    const winDropPct     = Math.max(0, winBefore - winAfterPlayed) * 100;
    const moveAcc        = perMoveAccuracy(winBefore, winAfterPlayed);
    const classification = classifyByWinDrop(winDropPct);
    const isMistake      = classification === 'blunder' || classification === 'mistake' || classification === 'inaccuracy';

    if (moveColor === playerColor) {
      playerAccSum += moveAcc;
      playerAccCnt++;
    }

    const playedUci    = `${move.from}${move.to}${move.promotion || ''}`;
    const isBestPlayed = bestUci === playedUci || bestMoveSan === move.san;
    const showBest     = !isBestPlayed && bestMoveSan;

    moveHistory.push({
      moveNum,
      color: moveColor,
      san:   move.san,
      evalAfterWhite,
      winPct:         Math.round(winAfterPlayed * 100),
      delta:          Math.round(winDropPct * 10) / 10,
      classification,
      bestMove: showBest ? bestMoveSan : undefined,
    });

    // ── Record mistake/inaccuracy ────────────────────────────────────────────
    if (isMistake) {
      // Use evalBefore as proxy for evalBest — avoids a 3rd Stockfish call per mistake.
      // evalBefore is the position eval before the blunder, which approximates what
      // the best move would have maintained.
      const evalBest = evalBefore;

      const category = classifyMistakeCategory({
        chess: new Chess(fenBefore),
        winDropPct,
        moveNumber: moveNum,
        clockBefore,
      });

      mistakes.push({
        moveNumber:     moveNum,
        color:          moveColor,
        played:         move.san,
        best:           bestMoveSan ?? '—',
        playedFen:      fenBefore,
        evalBefore,
        evalAfter,
        evalBest,
        winBefore:      Math.round(winBefore * 100),
        winAfterPlayed: Math.round(winAfterPlayed * 100),
        winDropPct:     Math.round(winDropPct * 10) / 10,
        delta:          Math.abs(evalBest - evalAfter),
        type:           classification,
        category,
        clockBefore,
        explanation:    null,
      });
    }
  }

  const accuracy = playerAccCnt > 0
    ? Math.round(playerAccSum / playerAccCnt)
    : 0;

  return { mistakes, accuracy, moveHistory };
};
