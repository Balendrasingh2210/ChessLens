const { Chess } = require('chess.js');
const { spawn } = require('child_process');
const path = require('path');

const DEPTH = 12;
const BLUNDER_THRESHOLD   = 200;
const MISTAKE_THRESHOLD   = 100;
const INACCURACY_THRESHOLD = 50;

// ── Persistent Stockfish process with a serial request queue ──────────────────
let sfProcess = null;
let sfReady   = false;
const queue   = [];
let busy      = false;

function getStockfishPath() {
  // Use system stockfish binary (install via: brew install stockfish)
  return 'stockfish';
}

function startStockfish() {
  if (sfProcess) return;

  const sfPath = getStockfishPath();
  sfProcess = spawn(sfPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });

  sfProcess.on('error', () => { sfProcess = null; sfReady = false; });
  sfProcess.on('exit',  () => { sfProcess = null; sfReady = false; busy = false; });

  sfProcess.stdout.on('data', (data) => {
    const text = data.toString();
    if (!sfReady && text.includes('readyok')) {
      sfReady = true;
      processNext();
      return;
    }
    if (busy && queue.length > 0) {
      queue[0].buffer += text;
      queue[0].onData(text);
    }
  });

  sfProcess.stdin.write('uci\n');
  sfProcess.stdin.write('isready\n');
}

function processNext() {
  if (busy || queue.length === 0 || !sfReady) return;
  busy = true;
  const task = queue[0];
  task.run();
}

function evalPosition(fen, depth) {
  return new Promise((resolve) => {
    startStockfish();

    let resolved = false;
    let buffer = '';

    const task = {
      buffer,
      onData(text) {
        buffer += text;
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith(`info depth ${depth}`) && line.includes('score cp')) {
            const m = line.match(/score cp (-?\d+)/);
            if (m && !resolved) { resolved = true; finish(parseInt(m[1], 10)); }
          }
          if (line.startsWith(`info depth ${depth}`) && line.includes('score mate')) {
            const m = line.match(/score mate (-?\d+)/);
            if (m && !resolved) { resolved = true; finish(parseInt(m[1], 10) > 0 ? 10000 : -10000); }
          }
          if (line.startsWith('bestmove') && !resolved) {
            // depth not reached but got a bestmove — use last score seen
            const m = buffer.match(/score cp (-?\d+)/g);
            if (m && !resolved) {
              resolved = true;
              const last = m[m.length - 1].match(/-?\d+/)[0];
              finish(parseInt(last, 10));
            } else if (!resolved) { resolved = true; finish(0); }
          }
        }
      },
      run() {
        task.buffer = '';
        buffer = '';
        const timeout = setTimeout(() => {
          if (!resolved) { resolved = true; finish(0); }
        }, 6000);

        function finish(val) {
          clearTimeout(timeout);
          queue.shift();
          busy = false;
          resolve(val);
          processNext();
        }

        sfProcess.stdin.write('ucinewgame\n');
        sfProcess.stdin.write(`position fen ${fen}\n`);
        sfProcess.stdin.write(`go depth ${depth}\n`);
      },
    };

    // Patch finish into onData closure
    let finishFn;
    task.onData = (text) => {
      buffer += text;
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!resolved && line.startsWith(`info depth ${depth}`) && line.includes('score cp')) {
          const m = line.match(/score cp (-?\d+)/);
          if (m) { resolved = true; finishFn(parseInt(m[1], 10)); return; }
        }
        if (!resolved && line.startsWith(`info depth ${depth}`) && line.includes('score mate')) {
          const m = line.match(/score mate (-?\d+)/);
          if (m) { resolved = true; finishFn(parseInt(m[1], 10) > 0 ? 10000 : -10000); return; }
        }
        if (!resolved && line.startsWith('bestmove')) {
          const m = buffer.match(/score cp (-?\d+)/g);
          resolved = true;
          if (m) { const last = m[m.length-1].match(/-?\d+/)[0]; finishFn(parseInt(last,10)); }
          else finishFn(0);
          return;
        }
      }
    };
    task.run = () => {
      task.buffer = '';
      buffer = '';
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; finishFn(0); }
      }, 6000);

      finishFn = (val) => {
        clearTimeout(timeout);
        queue.shift();
        busy = false;
        resolve(val);
        processNext();
      };

      sfProcess.stdin.write('ucinewgame\n');
      sfProcess.stdin.write(`position fen ${fen}\n`);
      sfProcess.stdin.write(`go depth ${depth}\n`);
    };

    queue.push(task);
    if (sfReady) processNext();
  });
}

async function getBestMove(fen, depth) {
  return new Promise((resolve) => {
    startStockfish();
    let resolved = false;
    let buffer = '';

    const task = {
      buffer: '',
      onData() {},
      run() {
        buffer = '';
        const timeout = setTimeout(() => {
          if (!resolved) { resolved = true; finish('0000'); }
        }, 6000);

        const finish = (move) => {
          clearTimeout(timeout);
          queue.shift();
          busy = false;
          resolve(move);
          processNext();
        };

        task.onData = (text) => {
          buffer += text;
          if (!resolved) {
            const m = buffer.match(/bestmove (\S+)/);
            if (m) { resolved = true; finish(m[1]); }
          }
        };

        sfProcess.stdin.write('ucinewgame\n');
        sfProcess.stdin.write(`position fen ${fen}\n`);
        sfProcess.stdin.write(`go depth ${depth}\n`);
      },
    };

    queue.push(task);
    if (sfReady) processNext();
  });
}

function classifyMistake({ chess, move, evalBefore, evalAfter, evalBest, moveNumber, clockBefore }) {
  const pieceCount = chess.board().flat().filter(Boolean).length;
  const isEndgame  = pieceCount <= 7;
  const isOpening  = moveNumber <= 10;
  const isTimePressure = clockBefore !== null && clockBefore < 30;
  const delta = Math.abs(evalBest - evalAfter);

  if (isTimePressure) return 'time-pressure';
  if (isOpening)      return 'opening';
  if (isEndgame)      return 'endgame';
  if (delta > BLUNDER_THRESHOLD) return 'hanging-piece';

  const bestMoveIsCapture = move.best && move.best.includes('x');
  if (bestMoveIsCapture && delta > MISTAKE_THRESHOLD) return 'tactical';

  const kingFile = chess.board().flat().findIndex(
    (sq) => sq && sq.type === 'k' && sq.color === (chess.turn() === 'w' ? 'b' : 'w')
  );
  if (kingFile !== -1 && delta > MISTAKE_THRESHOLD) return 'king-safety';

  return 'positional';
}

exports.analyzeGame = async (pgn, playerColor) => {
  const chess = new Chess();
  try { chess.loadPgn(pgn); } catch { throw new Error('Invalid PGN'); }

  const history = chess.history({ verbose: true });
  const freshChess = new Chess();

  const clockRegex = /\[%clk (\d+):(\d+):(\d+)\]/g;
  const clocks = [...pgn.matchAll(clockRegex)].map(
    (m) => parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
  );

  // Pre-start Stockfish so it's warm before the loop
  startStockfish();
  await new Promise((r) => {
    const check = setInterval(() => { if (sfReady) { clearInterval(check); r(); } }, 100);
    setTimeout(() => { clearInterval(check); r(); }, 5000);
  });

  const mistakes    = [];
  const moveHistory = [];
  let totalDelta = 0;
  let moveCount  = 0;

  for (let i = 0; i < history.length; i++) {
    const move      = history[i];
    const moveColor = i % 2 === 0 ? 'white' : 'black';

    if (moveColor !== playerColor) { freshChess.move(move); continue; }

    const fenBefore   = freshChess.fen();
    const clockBefore = clocks[i] ?? null;
    const moveNum     = Math.floor(i / 2) + 1;

    let evalBefore;
    try {
      const raw = await evalPosition(fenBefore, DEPTH);
      evalBefore = playerColor === 'white' ? raw : -raw;
    } catch { freshChess.move(move); continue; }

    freshChess.move(move);
    const fenAfter = freshChess.fen();

    let evalAfter;
    try {
      const raw = await evalPosition(fenAfter, DEPTH);
      evalAfter = playerColor === 'white' ? -raw : raw;
    } catch { continue; }

    let bestMove, evalBest;
    try {
      const bestUci   = await getBestMove(fenBefore, DEPTH);
      const tempChess = new Chess(fenBefore);
      const from = bestUci.slice(0, 2), to = bestUci.slice(2, 4), promo = bestUci[4];
      const bm   = tempChess.move({ from, to, promotion: promo || undefined });
      bestMove   = bm ? bm.san : bestUci;
      const rawBest = await evalPosition(tempChess.fen(), DEPTH);
      evalBest = playerColor === 'white' ? -rawBest : rawBest;
    } catch { continue; }

    const delta = evalBest - evalAfter;
    moveCount++;
    totalDelta += Math.max(0, delta);

    let type = null;
    if      (delta >= BLUNDER_THRESHOLD)    type = 'blunder';
    else if (delta >= MISTAKE_THRESHOLD)    type = 'mistake';
    else if (delta >= INACCURACY_THRESHOLD) type = 'inaccuracy';

    // Classification for ALL player moves (not just mistakes)
    const classification = type ?? (
      delta < 10 ? 'best' :
      delta < 25 ? 'excellent' :
      'good'
    );

    // evalAfterWhite: positive = white winning, for the eval bar
    const evalAfterWhite = playerColor === 'white' ? evalAfter : -evalAfter;

    moveHistory.push({
      moveNum,
      color: moveColor,
      san:   move.san,
      evalAfterWhite,
      delta: Math.max(0, delta),
      classification,
    });

    if (type) {
      const category = classifyMistake({
        chess: new Chess(fenBefore),
        move: { played: move.san, best: bestMove },
        evalBefore, evalAfter, evalBest,
        moveNumber: moveNum,
        clockBefore,
      });
      mistakes.push({
        moveNumber: moveNum,
        color: moveColor,
        played: move.san,
        best: bestMove,
        playedFen: fenBefore,
        evalBefore, evalAfter, evalBest, delta,
        type, category, clockBefore,
        explanation: null,
      });
    }
  }

  const avgLoss  = moveCount > 0 ? totalDelta / moveCount : 0;
  const accuracy = Math.max(0, Math.min(100, Math.round(100 - avgLoss / 3)));

  return { mistakes, accuracy, moveHistory };
};
