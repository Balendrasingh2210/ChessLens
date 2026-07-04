/**
 * Run with: node clear-games.js
 * Deletes ALL analyzed games from the database so you can re-import with fresh analysis.
 */
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const AnalyzedGame = require('./src/models/AnalyzedGame');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const { deletedCount } = await AnalyzedGame.deleteMany({});
  console.log(`✅ Deleted ${deletedCount} games. Re-import from the app to get fresh analysis with move history.`);
  await mongoose.disconnect();
})();
