# ♟ ChessLens

Chess analysis platform — import games from Chess.com & Lichess, analyze with Stockfish, train weaknesses with puzzles.

## Features

- **Game Import** — connect Chess.com or Lichess account and import your games in one click
- **AI Analysis** — Stockfish engine analyzes every move, detects blunders, mistakes, and inaccuracies
- **Move-by-move Review** — interactive board with eval bar, best move suggestions, and Claude AI explanations
- **Weakness Tracking** — identifies your recurring problem areas (tactics, endgames, king safety, etc.)
- **Puzzle Trainer** — puzzles matched to your weaknesses from the Lichess database (4M+ puzzles)
- **YouTube Recommendations** — curated video suggestions based on your specific weaknesses
- **Dashboard** — accuracy trends, win rate, opening stats

## Tech Stack

**Frontend:** React, TypeScript, Vite, CSS Modules  
**Backend:** Node.js, Express  
**Database:** MongoDB  
**Engine:** Stockfish 16  
**AI:** Anthropic Claude API  
**Queue:** BullMQ + Redis  

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB
- Redis (optional — app works without it)
- Stockfish (`brew install stockfish` on macOS)

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/ChessLens.git
cd ChessLens

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### Environment Variables

Create `server/.env`:
```
MONGO_URI=mongodb://localhost:27017/chesslens
JWT_SECRET=your_random_secret_here
JWT_EXPIRES_IN=7d
PORT=5001
CLIENT_URL=http://localhost:5173
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=your_anthropic_key
```

Create `client/.env`:
```
VITE_YOUTUBE_API_KEY=your_youtube_api_key
```

### Run

```bash
# Terminal 1 — start the server
cd server && npm run dev

# Terminal 2 — start the client
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Import Puzzles (optional)

```bash
cd server
node import-puzzles.js
```

Downloads the full Lichess puzzle database (~400MB) and imports it locally. Requires `zstd` (`brew install zstd`).

## License

MIT
