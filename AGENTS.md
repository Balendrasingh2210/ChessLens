# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies (root + client + server)
npm run install:all

# Run both client and server concurrently (from root)
npm run dev

# Run individually
cd server && npm run dev      # Express server on port 5000
cd client && npm run dev      # Vite dev server on port 5173

# Build client for production
cd client && npm run build

# Import Lichess puzzle database (~400MB, requires zstd)
cd server && node import-puzzles.js
```

No test suite is configured. There is no lint script defined.

## Architecture

ChessLens is a full-stack chess analysis platform with a React/TypeScript frontend and a Node.js/Express backend.

### Data flow

1. User connects a Chess.com or Lichess account → games are fetched via public platform APIs
2. Each game is queued in BullMQ (backed by Redis) for background Stockfish analysis
3. `analysisWorker.js` processes jobs: runs Stockfish → classifies mistakes → calls Codex for explanations → calls `weaknessService.rebuildProfile()`
4. Frontend fetches analyzed games, move-by-move history, and weakness data to render boards, eval bars, and charts
5. YouTube recommendations are generated **client-side** via `client/src/hooks/useYouTubeRecs.ts` (the server stub in `youtubeService.js` is inert)

### Backend (`server/src/`)

- **`services/stockfishService.js`** — manages a **single persistent Stockfish process** (singleton pattern with an internal queue). Calls are serialized through `evalWithBest()`. Stockfish must be on PATH (`brew install stockfish`).
- **`services/claudeService.js`** — calls Codex Haiku to generate per-mistake explanations and a coaching summary
- **`services/openingService.js`** — detects opening names by matching position FENs against the Lichess ECO database (bundled via the `chess-openings` npm package, 3,608 entries)
- **`services/weaknessService.js`** — aggregates mistake categories across all of a user's games and writes to the `WeaknessProfile` model
- **`workers/analysisWorker.js`** — BullMQ worker that orchestrates the full analysis pipeline; falls back to synchronous analysis if Redis is unavailable
- **`config/redis.js`** — Redis is optional; if `REDIS_URL` is unset, the queue is disabled and analysis runs synchronously in the request
- **`models/`** — Mongoose models: `User`, `AnalyzedGame`, `WeaknessProfile`, `PuzzleAttempt`

### Frontend (`client/src/`)

- **`store/authStore.ts`** — single Zustand store; JWT token stored in `localStorage` under key `cl_token`
- **`utils/api.ts`** — Axios instance with auth interceptor that injects the `cl_token` header
- **`pages/GameReview`** — most complex page; renders move-by-move board using `react-chessboard`, eval bar, and Codex explanations per mistake
- **`pages/Dashboard`** — aggregates data from `/api/profile/dashboard` (accuracy trends, openings, weakness radar, coaching tip)
- **`pages/Analysis`** — charts from `/api/analysis/breakdown` using Recharts
- **`pages/Puzzles`** — puzzle trainer using `/api/puzzles/next` filtered to user's top weaknesses

### Weakness classification

Mistakes are categorized in `stockfishService.js` during analysis:

| Category | Detection heuristic |
|---|---|
| `tactical` | Best move was a capture the player missed |
| `hanging-piece` | Large eval drop, no endgame/opening context |
| `opening` | Mistake in first 10 moves |
| `endgame` | Position with ≤7 pieces |
| `time-pressure` | Clock < 30 seconds |
| `king-safety` | King exposed heuristic |
| `positional` | Everything else |

### Environment variables

`server/.env`:
```
MONGO_URI=mongodb://localhost:27017/chesslens
JWT_SECRET=...
JWT_EXPIRES_IN=7d
PORT=5001
CLIENT_URL=http://localhost:5173
REDIS_URL=redis://localhost:6379   # optional
ANTHROPIC_API_KEY=...
```

`client/.env`:
```
VITE_YOUTUBE_API_KEY=...
```
