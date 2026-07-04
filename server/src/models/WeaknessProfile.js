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

  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('WeaknessProfile', weaknessProfileSchema);
