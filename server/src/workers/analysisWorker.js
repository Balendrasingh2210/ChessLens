const { Worker, Queue } = require('bullmq');
const { getRedis } = require('../config/redis');
const AnalyzedGame = require('../models/AnalyzedGame');
const { analyzeGame } = require('../services/stockfishService');
const { generateExplanations } = require('../services/claudeService');
const { rebuildProfile } = require('../services/weaknessService');
const { detectOpening } = require('../services/openingService');

const QUEUE_NAME = 'game-analysis';

let analysisQueue = null;
let analysisWorker = null;

const initQueue = () => {
  const redis = getRedis();
  if (!redis) {
    console.warn('⚠️  Redis not available — analysis queue disabled');
    return null;
  }

  try {
    analysisQueue = new Queue(QUEUE_NAME, { connection: redis });
    // Swallow connection errors — we'll fall back to the local queue
    analysisQueue.on('error', (err) => {
      if (err.name === 'ConnectionClosedError' || err.code === 'ECONNREFUSED') {
        analysisQueue = null;
      } else {
        console.error('Queue error:', err.message);
      }
    });
  } catch (err) {
    console.warn('⚠️  Failed to create BullMQ queue:', err.message);
    return null;
  }

  try {
    analysisWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
      const { gameId, userId } = job.data;

      const game = await AnalyzedGame.findById(gameId);
      if (!game) throw new Error('Game not found');

      // Mark as analyzing
      await AnalyzedGame.findByIdAndUpdate(gameId, { analysisStatus: 'analyzing' });
      await job.updateProgress(10);

      try {
        // 1. Run Stockfish analysis
        const { mistakes, accuracy, moveHistory } = await analyzeGame(game.pgn, game.playerColor);
        await job.updateProgress(70);

        // 2. Generate Claude explanations for the top 5 player mistakes (blunders + mistakes only)
        const topMistakes = mistakes
          .filter((m) => (m.type === 'blunder' || m.type === 'mistake') && m.color === game.playerColor)
          .slice(0, 5);

        const withExplanations = await generateExplanations(topMistakes, game.playerColor);
        await job.updateProgress(90);

        // Merge explanations back
        const finalMistakes = mistakes.map((m) => {
          const explained = withExplanations.find(
            (e) => e.moveNumber === m.moveNumber
          );
          return explained ? { ...m, explanation: explained.explanation } : m;
        });

        // 3. Detect opening via ECO position matching (more specific than PGN header)
        const detectedOpening = detectOpening(game.pgn);

        // 4. Save results
        await AnalyzedGame.findByIdAndUpdate(gameId, {
          mistakes: finalMistakes,
          moveHistory,
          accuracy,
          analysisStatus: 'done',
          ...(detectedOpening && {
            opening: detectedOpening.name,
            eco:     detectedOpening.eco,
          }),
        });

        // 4. Rebuild weakness profile
        await rebuildProfile(userId);
        await job.updateProgress(100);

      } catch (err) {
        await AnalyzedGame.findByIdAndUpdate(gameId, { analysisStatus: 'error' });
        throw err;
      }
    },
    {
      connection: getRedis(),
      concurrency: 2, // analyze 2 games at a time
    }
  );

    analysisWorker.on('completed', (job) => {
      console.log(`✅ Analysis done: job ${job.id}`);
    });
    analysisWorker.on('failed', (job, err) => {
      console.error(`❌ Analysis failed: job ${job?.id} — ${err.message}`);
    });
    analysisWorker.on('error', (err) => {
      if (err.name !== 'ConnectionClosedError' && err.code !== 'ECONNREFUSED') {
        console.error('Worker error:', err.message);
      }
    });
  } catch (err) {
    console.warn('⚠️  Failed to create BullMQ worker:', err.message);
    analysisQueue = null;
    return null;
  }

  console.log('🔄 Analysis worker started');
  return analysisQueue;
};

const getQueue = () => analysisQueue;

/**
 * Run analysis for one game in the background (no Redis).
 */
async function runAnalysisInBackground(gameDocId, userId) {
  const game = await AnalyzedGame.findById(gameDocId);
  if (!game) return;
  await AnalyzedGame.findByIdAndUpdate(gameDocId, { analysisStatus: 'analyzing' });
  try {
    const { mistakes, accuracy, moveHistory } = await analyzeGame(game.pgn, game.playerColor);
    const topMistakes = mistakes
      .filter((m) => (m.type === 'blunder' || m.type === 'mistake') && m.color === game.playerColor)
      .slice(0, 5);
    const withExplanations = await generateExplanations(topMistakes, game.playerColor);
    const finalMistakes = mistakes.map((m) => {
      const explained = withExplanations.find((e) => e.moveNumber === m.moveNumber);
      return explained ? { ...m, explanation: explained.explanation } : m;
    });
    const { detectOpening } = require('../services/openingService');
    const detectedOpening = detectOpening(game.pgn);
    await AnalyzedGame.findByIdAndUpdate(gameDocId, {
      mistakes: finalMistakes,
      moveHistory,
      accuracy,
      analysisStatus: 'done',
      ...(detectedOpening && {
        opening: detectedOpening.name,
        eco:     detectedOpening.eco,
      }),
    });
    await rebuildProfile(userId);
    console.log(`✅ Background analysis done: ${gameDocId}`);
  } catch (err) {
    await AnalyzedGame.findByIdAndUpdate(gameDocId, { analysisStatus: 'error' });
    console.error(`❌ Background analysis failed: ${gameDocId} — ${err.message}`);
  }
}

// ── In-memory queue for no-Redis mode ────────────────────────────────────────
// Controlled concurrency (max 2 concurrent analyses) so the Stockfish singleton
// isn't overwhelmed and the HTTP server stays responsive.
const localQueue = [];
let localRunning = 0;
const LOCAL_CONCURRENCY = 2;

function drainLocalQueue() {
  while (localRunning < LOCAL_CONCURRENCY && localQueue.length > 0) {
    const { gameDocId, userId } = localQueue.shift();
    localRunning++;
    runAnalysisInBackground(gameDocId, userId).finally(() => {
      localRunning--;
      drainLocalQueue();
    });
  }
}

/**
 * Add games to the analysis queue.
 * Falls back to a controlled in-memory queue if Redis is unavailable.
 */
const enqueueGame = async (gameDocId, userId) => {
  if (analysisQueue) {
    await analysisQueue.add('analyze', { gameId: gameDocId, userId }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
  } else {
    localQueue.push({ gameDocId, userId });
    drainLocalQueue();
  }
};

module.exports = { initQueue, getQueue, enqueueGame };
