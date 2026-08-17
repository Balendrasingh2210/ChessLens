/**
 * weaknessService.js — WeaknessProfile aggregation
 *
 * After each game finishes analysis, this service scans ALL of the user's
 * analyzed games (status: 'done') and rebuilds a single WeaknessProfile
 * document from scratch. Using a full rebuild (rather than incremental updates)
 * keeps the logic simple and guarantees consistency.
 *
 * The profile stores:
 *   - categoryBreakdown  : { tactical: N, 'hanging-piece': N, ... }
 *   - topWeaknesses      : top-3 categories by mistake frequency
 *   - recommendedThemes  : Lichess puzzle themes mapped from topWeaknesses
 *   - openingMistakes    : top-5 openings where the user blunders most
 *   - averageAccuracy    : mean of per-game accuracy scores
 *   - results            : win/loss/draw counts
 *
 * @module services/weaknessService
 */

const WeaknessProfile = require('../models/WeaknessProfile');
const AnalyzedGame = require('../models/AnalyzedGame');
const { categoryToThemes } = require('./lichessService');

/**
 * Recompute a user's weakness profile from all their analyzed games.
 * Called after each analysis batch completes.
 */
exports.rebuildProfile = async (userId) => {
  const games = await AnalyzedGame.find({
    userId,
    analysisStatus: 'done',
  });

  if (games.length === 0) return null;

  const categoryBreakdown = {};
  const openingMistakesMap = {};
  let totalAccuracy = 0;
  let accuracyCount = 0;
  const results = { wins: 0, losses: 0, draws: 0 };

  for (const game of games) {
    results[`${game.result}s`]++;
    if (game.accuracy !== null) {
      totalAccuracy += game.accuracy;
      accuracyCount++;
    }

    for (const mistake of game.mistakes) {
      const cat = mistake.category || 'other';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;

      if (cat === 'opening' && game.opening) {
        openingMistakesMap[game.opening] = (openingMistakesMap[game.opening] || 0) + 1;
      }
    }
  }

  // Sort categories by frequency
  const sorted = Object.entries(categoryBreakdown)
    .sort((a, b) => b[1] - a[1]);

  const topWeaknesses = sorted.slice(0, 3).map(([cat]) => cat);

  // Map top weaknesses to Lichess puzzle themes
  const recommendedThemes = [
    ...new Set(
      topWeaknesses.flatMap((cat) => categoryToThemes[cat] || [])
    ),
  ].slice(0, 6);

  const openingMistakes = Object.entries(openingMistakesMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([opening, count]) => ({ opening, count }));

  const profile = await WeaknessProfile.findOneAndUpdate(
    { userId },
    {
      userId,
      gamesAnalyzed: games.length,
      categoryBreakdown,
      topWeaknesses,
      averageAccuracy: accuracyCount > 0 ? Math.round(totalAccuracy / accuracyCount) : null,
      results,
      openingMistakes,
      recommendedThemes,
      lastUpdated: new Date(),
    },
    { upsert: true, new: true }
  );

  return profile;
};
