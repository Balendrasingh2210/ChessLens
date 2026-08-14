require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const analysisRoutes = require('./routes/analysis');
const puzzlesRoutes = require('./routes/puzzles');
const profileRoutes = require('./routes/profile');
const AnalyzedGame = require('./models/AnalyzedGame');
const { initQueue, enqueueGame } = require('./workers/analysisWorker');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/puzzles', puzzlesRoutes);
app.use('/api/profile', profileRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ChessLens' }));


const PORT = process.env.PORT || 5001;

async function recoverStuckGames() {
  // Reset games that were mid-analysis when the server last crashed
  const stuck = await AnalyzedGame.find({ analysisStatus: 'analyzing' }).select('_id userId');
  if (stuck.length) {
    await AnalyzedGame.updateMany(
      { _id: { $in: stuck.map(g => g._id) } },
      { analysisStatus: 'pending' }
    );
    console.log(`♻️  Reset ${stuck.length} stuck game(s) to pending`);
  }

  // Also reset error games so they get another chance on restart
  const errored = await AnalyzedGame.find({ analysisStatus: 'error' }).select('_id userId');
  if (errored.length) {
    await AnalyzedGame.updateMany(
      { _id: { $in: errored.map(g => g._id) } },
      { analysisStatus: 'pending' }
    );
    console.log(`🔁 Reset ${errored.length} error game(s) to pending for retry`);
  }

  // Enqueue ALL pending games (covers stuck, errored, and previously pending)
  const pending = await AnalyzedGame.find({ analysisStatus: 'pending' }).select('_id userId');
  if (!pending.length) return;
  console.log(`📋 Queueing ${pending.length} pending game(s) for analysis`);
  for (const g of pending) {
    try { await enqueueGame(g._id.toString(), g.userId.toString()); }
    catch { /* Redis may have disconnected after startup — worker will retry */ }
  }
}

async function start() {
  await connectDB();
  await connectRedis();

  const server = app.listen(PORT, async () => {
    console.log(`♟  ChessLens server running on port ${PORT}`);
    await recoverStuckGames();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} already in use — kill it with: lsof -ti :${PORT} | xargs kill -9`);
      process.exit(1);
    }
    console.error('Server error:', err);
    process.exit(1);
  });
}

start();
