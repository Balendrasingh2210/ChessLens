/**
 * One-time backfill: parse [Opening "..."] from PGN headers for all games
 * that currently have opening = null.
 *
 * Run with: node backfill-openings.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AnalyzedGame = require('./src/models/AnalyzedGame');

function parsePgnTag(pgn, tag) {
  const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]+)"\\]`));
  return m ? m[1] : null;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const games = await AnalyzedGame.find({ opening: null }).select('_id pgn');
  console.log(`Found ${games.length} games with no opening`);

  let updated = 0;
  for (const game of games) {
    if (!game.pgn) continue;

    const opening =
      parsePgnTag(game.pgn, 'Opening') ||
      parsePgnTag(game.pgn, 'ECO') ||
      null;

    if (opening) {
      await AnalyzedGame.updateOne({ _id: game._id }, { $set: { opening } });
      updated++;
    }
  }

  console.log(`✅ Updated ${updated} / ${games.length} games`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
