const { Worker, Queue } = require('bullmq');
const { getRedis } = require('../config/redis');
const AnalyzedGame = require('../models/AnalyzedGame');
const { analyzeGame } = require('../services/stockfishService');
const { generateExplanations } = require('../services/claudeService');
const { rebuildProfile } = require('../services/weaknessService');

const QUEUE_NAME = 'game-analysis';

let analysisQueue = null;
let analysisWorker = null;

const initQueue = () => {
  const redis = getRedis();
  if (!redis) {
    console.warn('⚠️  Redis not available — analysis queue disabled');
    return null;
  }

  analysisQueue = new Queue(QUEUE_NAME, { connection: redis });

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

        // 2. Generate Claude explanations for the top 5 mistakes (blunders + mistakes only)
        const topMistakes = mistakes
          .filter((m) => m.type === 'blunder' || m.type === 'mistake')
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

        // 3. Save results
        await AnalyzedGame.findByIdAndUpdate(gameId, {
          mistakes: finalMistakes,
          moveHistory,
          accuracy,
          analysisStatus: 'done',
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
    const topMistakes = mistakes.filter((m) => m.type === 'blunder' || m.type === 'mistake').slice(0, 5);
    const withExplanations = await generateExplanations(topMistakes, game.playerColor);
    const finalMistakes = mistakes.map((m) => {
      const explained = withExplanations.find((e) => e.moveNumber === m.moveNumber);
      return explained ? { ...m, explanation: explained.explanation } : m;
    });
    await AnalyzedGame.findByIdAndUpdate(gameDocId, { mistakes: finalMistakes, moveHistory, accuracy, analysisStatus: 'done' });
    await rebuildProfile(userId);
    console.log(`✅ Background analysis done: ${gameDocId}`);
  } catch (err) {
    await AnalyzedGame.findByIdAndUpdate(gameDocId, { analysisStatus: 'error' });
    console.error(`❌ Background analysis failed: ${gameDocId} — ${err.message}`);
  }
}

/**
 * Add games to the analysis queue.
 * Falls back to background analysis if Redis is unavailable — never blocks the HTTP request.
 */
const enqueueGame = async (gameDocId, userId) => {
  if (analysisQueue) {
    await analysisQueue.add('analyze', { gameId: gameDocId, userId }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
  } else {
    // Fire-and-forget: runs Stockfish in the background, import returns immediately
    setImmediate(() => runAnalysisInBackground(gameDocId, userId));
  }
};

module.exports = { initQueue, getQueue, enqueueGame };
