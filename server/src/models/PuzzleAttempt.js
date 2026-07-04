const mongoose = require('mongoose');

const puzzleAttemptSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  puzzleId:  { type: String, required: true },  // Lichess puzzle ID
  theme:     { type: String, required: true },
  fen:       { type: String, required: true },
  solution:  [{ type: String }],                // UCI moves
  correct:   { type: Boolean, required: true },
  timeTaken: { type: Number, default: null },   // seconds
}, { timestamps: true });

puzzleAttemptSchema.index({ userId: 1, puzzleId: 1 });

module.exports = mongoose.model('PuzzleAttempt', puzzleAttemptSchema);
