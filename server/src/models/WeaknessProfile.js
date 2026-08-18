/**
 * WeaknessProfile.js — Mongoose model for a user's aggregated weakness data
 *
 * One document per user (upserted by weaknessService.rebuildProfile).
 * Rebuilt from scratch after each game analysis completes, so it always
 * reflects the full history of analyzed games.
 *
 * Used by:
 *   - Dashboard page    : radar chart, coaching tip
 *   - Puzzles page      : recommendedThemes drives puzzle selection
 *   - Analysis page     : breakdown charts
 *
 * @module models/WeaknessProfile
 */

const mongoose = require('mongoose');

// Aggregated weakness profile per user — recomputed after each analysis batch
const weaknessProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Total games analyzed
  gamesAnalyzed: { type: Number, default: 0 },

  // Breakdown of mistakes by category
  // e.g. { tactical: 24, 'hanging-piece': 12, endgame: 8, ... }
  categoryBreakdown: {
    type: Map,
    of: Number,
    default: {},
  },

  // Top 3 weakness categories sorted by frequency
  topWeaknesses: [{ type: String }],

  // Average accuracy across all analyzed games
  averageAccuracy: { type: Number, default: null },

  // Win/loss/draw counts
  results: {
    wins:   { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws:  { type: Number, default: 0 },
  },

  // Opening mistakes by ECO code
  openingMistakes: [{
    opening: String,
    count: Number,
    _id: false,
  }],

  // Puzzles recommended based on weaknesses
  recommendedThemes: [{ type: String }],

  // Elo-style puzzle rating — starts at 1200, updated after each puzzle attempt
  puzzleRating: { type: Number, default: 1200 },

  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('WeaknessProfile', weaknessProfileSchema);
