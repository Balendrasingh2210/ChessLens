/**
 * Puzzle.js — Mongoose model for Lichess puzzles
 *
 * Populated by `server/import-puzzles.js` from the Lichess puzzle CSV (~4M rows).
 * Without the import, the puzzle trainer falls back to a small hardcoded set
 * or fetches live from the Lichess API (rate-limited).
 *
 * The `moves` field uses Lichess CSV format: moves[0] is the opponent's last
 * game move (the "intro" that created the tactic). The puzzle route strips this
 * move and advances the FEN before sending to the client.
 *
 * Indexes:
 *   rating (single)           — for rating-band filtering
 *   themes (single)           — for theme filtering
 *   { themes, rating } (compound) — the hot query path for getLocalPuzzle()
 *
 * @module models/Puzzle
 */

const mongoose = require('mongoose');

// Matches Lichess puzzle CSV schema:
// PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
const puzzleSchema = new mongoose.Schema({
  puzzleId:        { type: String, required: true, unique: true },
  fen:             { type: String, required: true },
  moves:           { type: [String], required: true },   // UCI move list e.g. ['e2e4','d7d5']
  rating:          { type: Number, required: true, index: true },
  ratingDeviation: { type: Number, default: 0 },
  popularity:      { type: Number, default: 0 },
  nbPlays:         { type: Number, default: 0 },
  themes:          { type: [String], index: true },       // ['fork','pin','mateIn2', ...]
  gameUrl:         { type: String, default: null },
  openingTags:     { type: [String], default: [] },
}, { timestamps: false });

// Compound index for the most common query pattern: theme + rating range
puzzleSchema.index({ themes: 1, rating: 1 });

module.exports = mongoose.model('Puzzle', puzzleSchema);
