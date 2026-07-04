# ChessLens — Setup Guide

## What this is
AI-powered chess coach. Connect your Chess.com or Lichess account → import games → Stockfish analyzes every move → Claude explains your mistakes in plain English → personalized puzzle recommendations fix your weaknesses.

---

## Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Redis (local or Upstash — optional but recommended)
- Anthropic API key → https://console.anthropic.com

---

## 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

---

## 2. Configure environment

```bash
cd server
cp .env.example .env
# Edit .env — fill in MONGO_URI, JWT_SECRET, ANTHROPIC_API_KEY
# Redis is optional — app works without it (slower, no job queue)
```

---

## 3. Run

```bash
# From root — starts both client (5173) and server (5000)
npm install       # installs concurrently
npm run dev
```

Open http://localhost:5173

---

## Architecture

```
ChessLens/
├── client/                    React + Vite + TypeScript (port 5173)
│   └── src/
│       ├── pages/
│       │   ├── Dashboard      — stats, weakness radar, recent games, coaching tip
│       │   ├── ConnectAccount — connect chess.com/lichess + import games
│       │   ├── Games          — all analyzed games with status
│       │   ├── GameReview     — annotated board + Claude explanations per mistake
│       │   ├── Analysis       — charts: mistakes by category/severity, openings
│       │   └── Puzzles        — puzzle trainer filtered to your weaknesses
│       ├── store/             Zustand auth store
│       └── utils/             Axios (with auth interceptor)
│
└── server/                    Express + Node.js (port 5000)
    └── src/
        ├── models/
        │   ├── User           — auth + connected chess accounts
        │   ├── AnalyzedGame   — per-game analysis results + mistakes
        │   ├── WeaknessProfile — aggregated weakness stats per user
        │   └── PuzzleAttempt  — puzzle history
        ├── services/
        │   ├── chessComService  — Chess.com public API
        │   ├── lichessService   — Lichess API + puzzle fetcher
        │   ├── stockfishService — Stockfish analysis + mistake classifier
        │   ├── claudeService    — Claude Haiku for move explanations + coaching summary
        │   └── weaknessService  — recomputes weakness profile after each batch
        ├── workers/
        │   └── analysisWorker — BullMQ job queue (background Stockfish analysis)
        └── routes/
            ├── /api/auth      — register, login, me
            ├── /api/games     — connect account, import, list, get single
            ├── /api/analysis  — weakness profile, breakdown charts, status
            ├── /api/puzzles   — next puzzle, submit attempt, history
            └── /api/profile   — dashboard data, disconnect account
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Login |
| GET  | /api/auth/me | Get current user |
| POST | /api/games/connect | Connect chess.com/lichess account |
| POST | /api/games/import | Fetch + queue N games for analysis |
| GET  | /api/games | List analyzed games (paginated) |
| GET  | /api/games/:id | Full game with mistakes + explanations |
| GET  | /api/analysis/profile | Weakness profile + Claude coaching summary |
| GET  | /api/analysis/breakdown | Mistake counts by category/type (for charts) |
| GET  | /api/analysis/status | Count of pending/analyzing/done/error games |
| GET  | /api/puzzles/next | Next puzzle matched to user's weaknesses |
| POST | /api/puzzles/attempt | Submit puzzle result |
| GET  | /api/puzzles/history | Puzzle history by theme |
| GET  | /api/profile/dashboard | All dashboard data in one call |

---

## Weakness Categories

| Category | How detected |
|---|---|
| `tactical` | Best move was a capture player missed |
| `hanging-piece` | Large eval drop with no endgame/opening context |
| `opening` | Mistake in first 10 moves |
| `endgame` | Position with ≤7 pieces |
| `time-pressure` | Clock < 30 seconds at time of mistake |
| `king-safety` | King exposed heuristic |
| `positional` | Everything else strategic |

---

## Deployment notes
- Frontend: Vercel (drag & drop client/dist folder)
- Backend: Railway or Render (set env vars from .env.example)
- MongoDB: MongoDB Atlas free tier
- Redis: Upstash free tier (serverless Redis — perfect for this)
- Analysis will be slower without Redis (synchronous instead of queued)
