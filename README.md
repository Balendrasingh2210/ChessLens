# ChessLens

**Live at: [https://chesslens2.duckdns.org](https://chesslens2.duckdns.org)**

A full-stack chess analysis platform. Import your games from Chess.com or Lichess, get move-by-move Stockfish analysis with AI coaching explanations, train your specific weaknesses with targeted puzzles, and watch your improvement over time.

---

## Features

| Feature | Description |
|---|---|
| **Game Import** | Connect Chess.com or Lichess — import up to 50 games at once. Paste raw PGN too. |
| **Stockfish Analysis** | Every move evaluated with Stockfish 16 at 300ms/position. Win%, eval bar, blunder/mistake/inaccuracy classification. |
| **AI Coaching** | Groq AI writes 2–3 sentence plain-English explanations for every mistake. |
| **Weakness Tracking** | 7 weakness categories (tactical, endgame, king safety, etc.) aggregated across all your games into a radar chart. |
| **Puzzle Trainer** | Puzzles from the Lichess database (4M+) matched to your top weaknesses. |
| **YouTube Recs** | Curated video recommendations per game and per weakness. Runs client-side. |
| **Dashboard** | Accuracy trends, win rate, opening stats, coaching tip. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, CSS Modules |
| State management | Zustand |
| Charts | Recharts |
| Chess board | react-chessboard + chess.js |
| Backend | Node.js, Express 4 |
| Database | MongoDB (Mongoose) |
| Job queue | BullMQ + Redis (optional) |
| Chess engine | Stockfish 16 (native process via `child_process`) |
| AI coaching | Groq API (`groq/compound-mini`) |
| Email | Brevo (transactional API) |

---

## Architecture

```
Browser
  │
  ├── React App (Vite, port 5173 in dev)
  │     ├── pages/GameReview     — move-by-move board, eval bar, explanations
  │     ├── pages/Dashboard       — accuracy trends, opening stats, radar chart
  │     ├── pages/Puzzles         — puzzle trainer
  │     ├── pages/Analysis        — breakdown charts
  │     ├── store/authStore.ts    — Zustand; JWT in localStorage ('cl_token')
  │     ├── utils/api.ts          — Axios instance; injects Bearer token header
  │     └── hooks/useYouTubeRecs  — YouTube Data API v3 calls (client-side only)
  │
  └── Express API (port 5001 in dev)
        ├── POST /api/games/import        → saves games to Mongo + enqueues
        ├── GET  /api/games               → paginated game list
        ├── GET  /api/games/:id           → full game detail (mistakes, moveHistory)
        ├── GET  /api/analysis/breakdown  → mistake counts for charts
        ├── GET  /api/puzzles/next        → next puzzle (local DB or Lichess fallback)
        ├── GET  /api/profile/dashboard   → all dashboard data in one call
        └── ...
              │
              ├── MongoDB
              │     ├── User            — auth + connectedAccounts
              │     ├── AnalyzedGame    — PGN, moveHistory, mistakes, accuracy
              │     ├── WeaknessProfile — aggregated category breakdown per user
              │     ├── Puzzle          — 4M Lichess puzzles (optional import)
              │     └── PuzzleAttempt   — per-user puzzle history
              │
              ├── Redis (optional)
              │     └── BullMQ queue — serialises game analysis jobs
              │
              └── Stockfish process (singleton)
                    └── analysisWorker.js orchestrates:
                          1. analyzeGame()        → Stockfish → mistakes + moveHistory
                          2. generateExplanations() → Groq AI → per-mistake text
                          3. detectOpening()      → ECO FEN lookup
                          4. rebuildProfile()     → recompute WeaknessProfile
```

---

## Data Flow

1. User links Chess.com or Lichess account → `gamesController.connectAccount` verifies it exists
2. User clicks Import → games fetched from platform API → saved to MongoDB as `analysisStatus: 'pending'`
3. Each game is enqueued via BullMQ (or in-memory queue if Redis is down)
4. `analysisWorker.js` processes the queue:
   - Runs Stockfish on every position (serialised singleton — one eval at a time)
   - Classifies each move: best / excellent / good / inaccuracy / mistake / blunder
   - Calls Groq API for plain-English explanations of player mistakes
   - Matches position FENs against Lichess ECO database to name the opening
   - Rebuilds the user's `WeaknessProfile` by aggregating all analyzed games
5. Frontend polls game status; once `done`, the review page renders the interactive board

---

## Project Structure

```
ChessLens/
├── client/                         # React frontend
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx       # aggregated stats page
│       │   ├── GameReview.tsx      # move-by-move review (most complex page)
│       │   ├── Games.tsx           # game list + import trigger
│       │   ├── Puzzles.tsx         # puzzle trainer
│       │   ├── Analysis.tsx        # breakdown charts
│       │   ├── ConnectAccount.tsx  # link chess.com / lichess
│       │   └── Settings.tsx        # profile settings
│       ├── store/
│       │   └── authStore.ts        # Zustand store (auth state + JWT)
│       ├── hooks/
│       │   └── useYouTubeRecs.ts   # YouTube Data API v3 (client-side)
│       ├── utils/
│       │   └── api.ts              # Axios instance with auth interceptor
│       └── components/
│           └── layout/Layout.tsx   # shared nav + outlet
│
└── server/                         # Express backend
    └── src/
        ├── index.js                # entry point — starts server, recovers stuck games
        ├── config/
        │   ├── db.js               # MongoDB connection
        │   └── redis.js            # Redis connection + cache helpers
        ├── middleware/
        │   └── auth.js             # JWT Bearer token middleware
        ├── models/
        │   ├── User.js             # bcrypt password, connectedAccounts
        │   ├── AnalyzedGame.js     # PGN, moveHistory, mistakes, accuracy
        │   ├── WeaknessProfile.js  # aggregated weakness categories
        │   ├── Puzzle.js           # Lichess puzzle CSV schema
        │   └── PuzzleAttempt.js    # per-user puzzle solve history
        ├── controllers/
        │   ├── authController.js   # register/login/verify/forgot/reset
        │   └── gamesController.js  # connect/import/list/review/retry
        ├── routes/
        │   ├── auth.js
        │   ├── games.js
        │   ├── analysis.js         # /profile, /status, /breakdown
        │   ├── puzzles.js          # /next, /attempt, /history, /stats
        │   └── profile.js          # /dashboard, /recommendations
        ├── services/
        │   ├── stockfishService.js # Stockfish process wrapper + game analysis
        │   ├── claudeService.js    # Groq AI: mistake explanations + coaching summary
        │   ├── weaknessService.js  # rebuilds WeaknessProfile from all games
        │   ├── openingService.js   # ECO FEN matching (3,608 openings)
        │   ├── chessComService.js  # Chess.com public API adapter
        │   ├── lichessService.js   # Lichess API adapter + puzzle pool
        │   ├── emailService.js     # Brevo transactional email
        │   └── youtubeService.js   # stub (real logic is client-side)
        └── workers/
            └── analysisWorker.js   # BullMQ worker — orchestrates analysis pipeline
```

---

## API Reference

All endpoints require `Authorization: Bearer <token>` unless marked public.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, email, password}` | Create account (sends verification email) |
| POST | `/api/auth/login` | `{email, password}` | Returns JWT + user object |
| GET | `/api/auth/me` | — | Returns current user |
| GET | `/api/auth/verify-email?token=` | — | Verifies email token (public) |
| POST | `/api/auth/forgot-password` | `{email}` | Sends password reset email |
| POST | `/api/auth/reset-password` | `{token, newPassword}` | Resets password |
| PUT | `/api/auth/profile` | `{username?, email?}` | Update profile |
| PUT | `/api/auth/change-password` | `{currentPassword, newPassword}` | Change password |
| POST | `/api/auth/resend-verification` | `{email}` | Resend verification email |

### Games

| Method | Path | Body / Query | Description |
|---|---|---|---|
| POST | `/api/games/connect` | `{platform, username}` | Link chess.com or lichess account |
| POST | `/api/games/import` | `{platform, username, count?}` | Import + queue games from platform |
| POST | `/api/games/import-raw` | `{games[], platform, username}` | Import pre-fetched game objects |
| POST | `/api/games/import-pgn` | `{pgn, platform, username}` | Import from raw PGN text |
| GET | `/api/games` | `?platform&status&page&limit` | Paginated game list |
| GET | `/api/games/:id` | — | Full game detail (mistakes, moveHistory) |
| DELETE | `/api/games` | — | Delete all user games |
| POST | `/api/games/:id/retry` | — | Re-queue a failed game |
| DELETE | `/api/games/accounts/:platform/:username` | — | Disconnect linked account |

### Analysis

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/api/analysis/profile` | — | Weakness profile + AI coaching tip |
| GET | `/api/analysis/status` | — | Count of games per analysis status |
| GET | `/api/analysis/breakdown` | `?limit=N` | Mistake counts by category + type |

### Puzzles

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/api/puzzles/next` | `?theme=` | Next puzzle (local DB → Lichess fallback) |
| POST | `/api/puzzles/attempt` | `{puzzleId, theme, fen, solution, correct, timeTaken}` | Record attempt |
| GET | `/api/puzzles/history` | — | Last 50 attempts with per-theme stats |
| GET | `/api/puzzles/stats` | — | Local puzzle DB count |

### Profile / Dashboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/profile/dashboard` | User + weakness profile + recent games + puzzle stats + opening stats |
| GET | `/api/profile/recommendations` | YouTube recs (requires `YOUTUBE_API_KEY`) |
| DELETE | `/api/profile/accounts/:platform` | Remove linked platform account |

---

## Weakness Categories

Mistakes are classified into one of seven categories during Stockfish analysis:

| Category | Detection heuristic |
|---|---|
| `tactical` | Best move was a capture that the player missed |
| `hanging-piece` | Large win-% drop, no other context |
| `opening` | Mistake in first 10 moves |
| `endgame` | Position with ≤7 total pieces |
| `time-pressure` | Clock < 30 seconds when the move was made |
| `king-safety` | King exposed (heuristic) |
| `positional` | Everything else |

These map to Lichess puzzle themes for targeted training (see `lichessService.js → categoryToThemes`).

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Redis (optional — app works without it, uses in-memory queue)
- Stockfish: `brew install stockfish` (macOS) or `apt install stockfish` (Linux)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/ChessLens.git
cd ChessLens
npm run install:all      # installs root + client + server deps
```

### Environment Variables

Create `server/.env`:

```env
MONGO_URI=mongodb://localhost:27017/chesslens
JWT_SECRET=your_random_secret_here
JWT_EXPIRES_IN=7d
PORT=5001
CLIENT_URL=http://localhost:5173
REDIS_URL=redis://localhost:6379     # optional

# AI coaching explanations (Groq)
GROQ_API_KEY=your_groq_api_key

# Transactional email (Brevo)
BREVO_API_KEY=your_brevo_api_key
BREVO_FROM_EMAIL=noreply@yourdomain.com
BREVO_FROM_NAME=ChessLens
```

Create `client/.env`:

```env
VITE_YOUTUBE_API_KEY=your_youtube_data_api_key
# For production, also set:
VITE_API_URL=https://your-backend-url.com
```

### Run (Development)

```bash
npm run dev       # starts both server (5001) and client (5173) concurrently
```

Or separately:

```bash
cd server && npm run dev    # Express + nodemon
cd client && npm run dev    # Vite HMR
```

Open [http://localhost:5173](http://localhost:5173)

### Import Puzzles (Optional)

Download the full Lichess puzzle database (~400MB) for offline puzzle training:

```bash
cd server
node import-puzzles.js
```

Requires `zstd`: `brew install zstd` (macOS).  
Without this step, the puzzle trainer falls back to a small hardcoded set or the Lichess live API.

---

## Deployment Notes

The live instance runs on an **Oracle Cloud ARM VM** (Mumbai region) behind Nginx as a reverse proxy. The frontend is built with `npm run build` and served as static files by Nginx; the backend runs as a systemd service.

Key production considerations:
- Set `CLIENT_URL` to the production frontend origin (CORS)
- Set `VITE_API_URL` to the production backend URL in the client build
- Redis is optional but recommended for reliable job queuing
- Stockfish must be installed on the server (`apt install stockfish`)
- The Groq API key is required for AI coaching; without it, explanations are silently skipped

---

## License

MIT
