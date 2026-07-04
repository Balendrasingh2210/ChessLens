/**
 * Lichess Puzzle Database Importer
 * ─────────────────────────────────
 * Downloads the full Lichess puzzle CSV (~400MB compressed, ~6M puzzles)
 * and bulk-inserts into MongoDB. Run once from the server directory:
 *
 *   node import-puzzles.js
 *
 * Requires: zstd CLI  →  brew install zstd
 *
 * Options (env vars):
 *   MONGO_URI   — default: mongodb://localhost:27017/chesslens
 *   BATCH_SIZE  — rows per bulk insert (default 2000)
 *   LIMIT       — max puzzles to import, 0 = all (default 0)
 */

require('dotenv').config();
const readline  = require('readline');
const { spawn } = require('child_process');
const mongoose  = require('mongoose');
const Puzzle    = require('./src/models/Puzzle');

const MONGO_URI  = process.env.MONGO_URI   || 'mongodb://localhost:27017/chesslens';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '2000', 10);
const LIMIT      = parseInt(process.env.LIMIT      || '0',    10);
const CSV_URL    = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n) { return Number(n).toLocaleString(); }

function checkZstd() {
  return new Promise((resolve) => {
    const check = spawn('zstd', ['--version']);
    check.on('error', () => resolve(false));
    check.on('close', (code) => resolve(code === 0));
  });
}

function parseLine(line) {
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  const cols = line.split(',');
  if (cols.length < 9) return null;
  const [puzzleId, fen, movesRaw, rating, ratingDeviation, popularity, nbPlays, themesRaw, gameUrl, ...openingRest] = cols;
  if (!puzzleId || puzzleId === 'PuzzleId' || !fen || !movesRaw) return null;
  return {
    puzzleId,
    fen,
    moves:           movesRaw.split(' ').filter(Boolean),
    rating:          parseInt(rating, 10)          || 1500,
    ratingDeviation: parseInt(ratingDeviation, 10) || 0,
    popularity:      parseInt(popularity, 10)      || 0,
    nbPlays:         parseInt(nbPlays, 10)         || 0,
    themes:          themesRaw ? themesRaw.split(' ').filter(Boolean) : [],
    gameUrl:         gameUrl   || null,
    openingTags:     openingRest.join(',').split(' ').filter(Boolean),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('♟  ChessLens — Lichess Puzzle Importer');
  console.log(`   MongoDB  : ${MONGO_URI}`);
  console.log(`   Batch    : ${fmt(BATCH_SIZE)} rows`);
  console.log(`   Limit    : ${LIMIT > 0 ? fmt(LIMIT) : 'all'} puzzles\n`);

  // Check zstd is available
  const hasZstd = await checkZstd();
  if (!hasZstd) {
    console.error('❌ zstd not found. Install it first:');
    console.error('   brew install zstd');
    process.exit(1);
  }
  console.log('✅ zstd found');

  // Connect to MongoDB
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Check for existing data
  const existing = await Puzzle.estimatedDocumentCount();
  if (existing > 0) {
    console.log(`\n   ⚠️  Found ${fmt(existing)} existing puzzles.`);
    console.log('   Upsert mode: duplicates will be skipped.\n');
  }

  // Support local file OR remote download
  // Usage:  node import-puzzles.js                          ← downloads from Lichess
  //         LOCAL_FILE=./lichess_puzzles.csv.zst node import-puzzles.js  ← uses local file
  const LOCAL_FILE = process.env.LOCAL_FILE || null;

  let zstdProc;

  if (LOCAL_FILE) {
    console.log(`📂 Using local file: ${LOCAL_FILE}\n`);
    const fs = require('fs');
    if (!fs.existsSync(LOCAL_FILE)) {
      console.error(`❌ File not found: ${LOCAL_FILE}`);
      process.exit(1);
    }
    const fileStream = fs.createReadStream(LOCAL_FILE);
    zstdProc = spawn('zstd', ['-d', '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
    fileStream.pipe(zstdProc.stdin);
    fileStream.on('error', (e) => { console.error('❌ File read error:', e.message); process.exit(1); });
  } else {
    console.log(`⬇️  Downloading from Lichess (~400 MB)…`);
    console.log(`   ${CSV_URL}\n`);
    console.log(`   Tip: if this times out (e.g. behind a proxy), download the file manually`);
    console.log(`   and run: LOCAL_FILE=./lichess_puzzles.csv.zst node import-puzzles.js\n`);

    const curlProc = spawn('curl', [
      '--location', '--retry', '3', '--retry-delay', '5',
      '--speed-limit', '1', '--speed-time', '30',
      '--progress-bar', CSV_URL,
    ], { stdio: ['ignore', 'pipe', 'inherit'] });

    zstdProc = spawn('zstd', ['-d', '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
    curlProc.stdout.pipe(zstdProc.stdin);

    await new Promise((resolve, reject) => {
      curlProc.on('close', code => code !== 0 ? reject(new Error(`curl exited with code ${code}`)) : resolve());
      curlProc.on('error', reject);
    });
    console.log('\n');
  }

  // Stream decompressed CSV → parse → batch upsert
  const rl = readline.createInterface({ input: zstdProc.stdout, crlfDelay: Infinity });

  let batch    = [];
  let total    = 0;
  let imported = 0;
  let skipped  = 0;
  let done     = false;
  const start  = Date.now();

  const flush = async () => {
    if (batch.length === 0) return;
    const ops = batch.map(p => ({
      updateOne: {
        filter: { puzzleId: p.puzzleId },
        update: { $setOnInsert: p },
        upsert: true,
      },
    }));
    try {
      const result = await Puzzle.bulkWrite(ops, { ordered: false });
      imported += result.upsertedCount;
      skipped  += result.matchedCount;
    } catch (e) {
      // Ignore duplicate key errors from parallel upserts
      if (e.code !== 11000) throw e;
    }
    batch = [];

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const rate    = total > 0 ? fmt(Math.round(total / Math.max(1, elapsed))) : '…';
    process.stdout.write(
      `\r   Processed: ${fmt(total).padStart(9)} | Inserted: ${fmt(imported).padStart(9)} | ${rate}/s   `
    );
  };

  console.log('📥 Parsing and importing puzzles…\n');

  for await (const line of rl) {
    if (done) break;
    const puzzle = parseLine(line);
    if (!puzzle) continue;

    batch.push(puzzle);
    total++;

    if (batch.length >= BATCH_SIZE) await flush();
    if (LIMIT > 0 && total >= LIMIT) { done = true; break; }
  }

  await flush();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n\n✅ Import complete in ${elapsed}s`);
  console.log(`   Total processed  : ${fmt(total)}`);
  console.log(`   Newly inserted   : ${fmt(imported)}`);
  console.log(`   Already existed  : ${fmt(skipped)}`);

  // Build indexes
  console.log('\n🔧 Building indexes (may take a minute)…');
  await Puzzle.ensureIndexes();
  console.log('✅ Indexes ready\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Import failed:', err.message);
  process.exit(1);
});
