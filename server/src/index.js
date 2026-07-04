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

async function start() {
  await connectDB();
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`♟  ChessLens server running on port ${PORT}`);
  });
}

start();
