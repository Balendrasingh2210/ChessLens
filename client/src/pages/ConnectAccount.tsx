import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import s from './ConnectAccount.module.css';

type Platform = 'chess.com' | 'lichess';
interface ImportState { platform: Platform; username: string; count: number; }

export default function ConnectAccount() {
  const { user, refreshUser } = useAuthStore();
  const navigate = useNavigate();

  const [platform, setPlatform] = useState<Platform>('chess.com');
  const [username, setUsername] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [importing, setImporting]   = useState<ImportState | null>(null);
  const [importLoading, setIL]      = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  // PGN paste import
  const [showPgn, setShowPgn]     = useState(false);
  const [pgnText, setPgnText]     = useState('');
  const [pgnUser, setPgnUser]     = useState('');
  const [pgnLoading, setPgnLoading] = useState(false);
  const [importStep, setImportStep] = useState<null | 'fetching' | 'queuing'>(null);

  const accounts = user?.connectedAccounts ?? [];

  const disconnectAccount = async (platform: Platform, username: string) => {
    try {
      await api.delete(`/games/account/${encodeURIComponent(platform)}/${encodeURIComponent(username)}`);
      await refreshUser();
    } catch { /* ignore */ }
  };

  const connectAccount = async () => {
    setError(''); setLoading(true);
    try {
      await api.post('/games/connect', { platform, username: username.trim() });
      await refreshUser();
      setImporting({ platform, username: username.trim(), count: 20 });
      setUsername('');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to connect');
    } finally { setLoading(false); }
  };

  const importGames = async () => {
    if (!importing) return;
    setError(''); setIL(true); setImportStep('fetching');
    try {
      const games = importing.platform === 'lichess'
        ? await fetchFromLichess(importing.username, importing.count)
        : await fetchFromChessCom(importing.username, importing.count);
      setImportStep('queuing');
      const { data } = await api.post('/games/import-raw', {
        games,
        platform: importing.platform,
        username: importing.username,
      });
      setImportResult({ imported: data.imported, skipped: data.skipped });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Import failed';
      setError(msg);
    } finally { setIL(false); setImportStep(null); }
  };

  /** Extract a PGN header tag value, e.g. parsePgnTag(pgn, 'Opening') → "Italian Game" */
  function parsePgnTag(pgn: string, tag: string): string | null {
    const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]+)"\\]`));
    return m ? m[1] : null;
  }

  /** Fetch games directly from chess.com API (browser has no IP block, CORS is allowed) */
  async function fetchFromChessCom(username: string, maxGames: number): Promise<object[]> {
    const BASE = 'https://api.chess.com/pub';
    const headers = { 'User-Agent': 'ChessLens/1.0' };

    // 1. Get archive list
    const archRes = await fetch(`${BASE}/player/${username}/games/archives`, { headers });
    if (!archRes.ok) throw new Error(`chess.com: ${archRes.status} fetching archives`);
    const archData = await archRes.json() as { archives: string[] };
    const archiveUrls = (archData.archives ?? []).slice().reverse(); // newest first

    if (!archiveUrls.length) throw new Error(`No game archives found for "${username}" on chess.com`);

    const games: object[] = [];

    // 2. Fetch each archive until we have enough games
    for (const url of archiveUrls) {
      if (games.length >= maxGames) break;
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const monthData = await res.json() as { games: Record<string, unknown>[] };
        const monthGames = (monthData.games ?? []).slice().reverse();

        for (const game of monthGames) {
          if (games.length >= maxGames) break;
          if (!game.pgn) continue;

          const white = (game.white as { username: string }).username;
          const black = (game.black as { username: string }).username;
          const playerColor = white.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
          const playerSide  = game[playerColor] as { result: string; rating: number };
          const oppSide     = game[playerColor === 'white' ? 'black' : 'white'] as { username: string; rating: number };

          const r = playerSide.result;
          const result = r === 'win' ? 'win'
            : ['resigned','timeout','checkmated','abandoned'].includes(r) ? 'loss'
            : 'draw';

          const pgnStr = game.pgn as string;
          // Parse opening name from PGN headers — chess.com always includes [Opening "..."]
          const opening = parsePgnTag(pgnStr, 'Opening')
            ?? parsePgnTag(pgnStr, 'ECOUrl')?.split('/').pop()?.replace(/-/g, ' ')
            ?? null;

          games.push({
            gameId:         (game.url as string).split('/').pop(),
            pgn:            pgnStr,
            playerColor,
            opponent:       oppSide.username,
            playerRating:   playerSide.rating,
            opponentRating: oppSide.rating,
            result,
            timeControl:    game.time_control,
            playedAt:       new Date((game.end_time as number) * 1000).toISOString(),
            opening,
          });
        }
      } catch { continue; }
    }

    if (!games.length) throw new Error('No games found. Check your username or try PGN import.');
    return games;
  }

  /** Fetch games directly from Lichess API (NDJSON stream) */
  async function fetchFromLichess(username: string, maxGames: number): Promise<object[]> {
    const response = await fetch(
      `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${maxGames}&rated=true&pgnInJson=true&clocks=true&opening=true`,
      { headers: { Accept: 'application/x-ndjson', 'User-Agent': 'ChessLens/1.0' } }
    );
    if (response.status === 404) throw new Error(`Lichess user "${username}" not found`);
    if (!response.ok) throw new Error(`Lichess API error: ${response.status}`);

    const text = await response.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (!lines.length) throw new Error('No games found. Check your Lichess username.');

    const games: object[] = [];
    for (const line of lines) {
      try {
        const g = JSON.parse(line);
        const playerColor =
          g.players?.white?.user?.id?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
        const playerSide = g.players?.[playerColor];
        const oppSide    = g.players?.[playerColor === 'white' ? 'black' : 'white'];

        games.push({
          gameId:         g.id,
          pgn:            g.pgn || '',
          playerColor,
          opponent:       oppSide?.user?.name ?? 'Anonymous',
          playerRating:   playerSide?.rating ?? null,
          opponentRating: oppSide?.rating ?? null,
          result:         g.winner ? (g.winner === playerColor ? 'win' : 'loss') : 'draw',
          timeControl:    g.clock ? `${g.clock.initial}+${g.clock.increment}` : null,
          playedAt:       new Date(g.createdAt).toISOString(),
          opening:        g.opening?.name ?? null,
        });
      } catch { continue; }
    }

    if (!games.length) throw new Error('No games found. Check your Lichess username.');
    return games;
  }

  const importPgn = async () => {
    if (!pgnText.trim() || !pgnUser.trim()) return;
    setError(''); setPgnLoading(true);
    try {
      const { data } = await api.post('/games/import-pgn', {
        pgn: pgnText.trim(),
        username: pgnUser.trim(),
        platform: importing?.platform ?? 'lichess',
      });
      setImportResult({ imported: data.imported, skipped: data.skipped });
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'PGN import failed');
    } finally { setPgnLoading(false); }
  };

  const isConnected = accounts.some(
    a => a.platform === platform && a.username.toLowerCase() === username.trim().toLowerCase()
  );

  // ── Done screen ───────────────────────────────────────────────────────────
  if (importResult) {
    return (
      <div className={s.page}><div className={s.card}>
        <div className={s.doneIcon}>🚀</div>
        <h2 className={s.doneTitle}>Analysis started!</h2>
        <p className={s.doneSub}>
          <strong>{importResult.imported}</strong> games queued
          {importResult.skipped > 0 && ` · ${importResult.skipped} already analyzed`}
        </p>
        <p className={s.hint}>Stockfish analysis runs in the background. Check your dashboard in a few minutes.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className={s.btn} onClick={() => { setImportResult(null); setImporting(null); setShowPgn(false); setPgnText(''); }}>Import More</button>
          <button className={s.btn} style={{ background: 'var(--green-dim)' }} onClick={() => navigate('/')}>Dashboard →</button>
        </div>
      </div></div>
    );
  }

  // ── Import panel (API) ────────────────────────────────────────────────────
  if (importing && !showPgn) {
    return (
      <div className={s.page}><div className={s.card}>
        <button className={s.backBtn} onClick={() => { setImporting(null); setError(''); }}>← Back</button>
        <h1 className={s.title}>Import Games</h1>
        <div className={s.importingFor}>
          <span className={s.platformBadge}>{importing.platform}</span>
          <strong className={s.accountName}>{importing.username}</strong>
        </div>
        <h3 className={s.sectionLabel}>How many games to analyze?</h3>
        <div className={s.countRow}>
          {[10, 20, 30, 50].map(n => (
            <button key={n} className={`${s.countBtn} ${importing.count === n ? s.active : ''}`}
              onClick={() => setImporting({ ...importing, count: n })}>{n}</button>
          ))}
        </div>
        <p className={s.hint}>Already-analyzed games are skipped automatically.</p>
        {importLoading && (
          <div className={s.stepIndicator}>
            {(['fetching', 'queuing'] as const).map((step, i) => {
              const labels = { fetching: `Fetching from ${importing.platform}`, queuing: 'Queuing analysis' };
              const done   = importStep === 'queuing' && step === 'fetching';
              const active = importStep === step;
              return (
                <div key={step} className={`${s.step} ${done ? s.stepDone : active ? s.stepActive : s.stepWaiting}`}>
                  <span className={s.stepNum}>{done ? '✓' : i + 1}</span>
                  <span>{labels[step]}</span>
                </div>
              );
            })}
          </div>
        )}
        {error && (
          <div className={s.error}>
            {error}
            <button className={s.pgnFallbackBtn} onClick={() => { setError(''); setShowPgn(true); setPgnUser(importing.username); }}>
              Try PGN import instead →
            </button>
          </div>
        )}
        <button className={s.btn} onClick={importGames} disabled={importLoading}>
          {importLoading ? 'Fetching & importing...' : `Analyze ${importing.count} Games`}
        </button>
      </div></div>
    );
  }

  // ── PGN paste panel ───────────────────────────────────────────────────────
  if (showPgn) {
    return (
      <div className={s.page}><div className={s.card}>
        <button className={s.backBtn} onClick={() => { setShowPgn(false); setError(''); }}>← Back</button>
        <h1 className={s.title}>Import from PGN</h1>
        <p className={s.sub}>Download your games from Chess.com or Lichess, then paste them here.</p>

        <div className={s.pgnSteps}>
          <span>Chess.com: <strong>My Games → Export PGN</strong></span>
          <span>Lichess: <strong>lichess.org/games/export</strong></span>
          <span>Paste all PGN text below ↓</span>
        </div>

        <input
          className={s.input}
          type="text"
          placeholder="Your username (for color detection)"
          value={pgnUser}
          onChange={e => setPgnUser(e.target.value)}
        />
        <textarea
          className={s.pgnTextarea}
          placeholder={'[Event "Live Chess"]\n[White "..."]\n[Black "..."]\n\n1. e4 e5 ...'}
          value={pgnText}
          onChange={e => { setPgnText(e.target.value); setError(''); }}
          rows={10}
        />
        {error && <div className={s.error}>{error}</div>}
        <button
          className={s.btn}
          onClick={importPgn}
          disabled={pgnLoading || !pgnText.trim() || !pgnUser.trim()}
        >
          {pgnLoading ? 'Importing...' : 'Analyze PGN Games'}
        </button>
      </div></div>
    );
  }

  // ── Main screen ───────────────────────────────────────────────────────────
  return (
    <div className={s.page}><div className={s.card}>
      <h1 className={s.title}>Chess Accounts</h1>
      <p className={s.sub}>Import your games and get AI-powered coaching</p>

      {/* Connected accounts — one click to import */}
      {accounts.length > 0 && (
        <div className={s.section}>
          <h3 className={s.sectionLabel}>Connected Accounts</h3>
          {accounts.map(a => (
            <div key={`${a.platform}-${a.username}`} className={s.accountRow}>
              <span className={s.platformBadge}>{a.platform}</span>
              <span className={s.accountName}>{a.username}</span>
              <span className={s.accountMeta}>{a.gamesAnalyzed ?? 0} analyzed</span>
              <button
                className={s.importBtn}
                onClick={() => setImporting({ platform: a.platform as Platform, username: a.username, count: 20 })}
              >Import →</button>
              <button
                className={s.disconnectBtn}
                title="Disconnect account"
                onClick={() => disconnectAccount(a.platform as Platform, a.username)}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add new account */}
      <div className={s.section}>
        <h3 className={s.sectionLabel}>Add New Account</h3>
        <div className={s.platformRow}>
          {(['chess.com', 'lichess'] as Platform[]).map(p => (
            <button key={p} className={`${s.platformBtn} ${platform === p ? s.active : ''}`}
              onClick={() => { setPlatform(p); setError(''); }}>
              {p === 'chess.com' ? '♛ Chess.com' : '♜ Lichess'}
            </button>
          ))}
        </div>
        <input className={s.input} type="text" placeholder={`Your ${platform} username`}
          value={username} onChange={e => { setUsername(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && username.trim() && (isConnected
            ? setImporting({ platform, username: username.trim(), count: 20 })
            : connectAccount())}
        />
        {error && <div className={s.error}>{error}</div>}
        {isConnected && <div className={s.warn}>Already connected — click below to import more games.</div>}
        <button className={s.btn} disabled={loading || !username.trim()}
          onClick={() => isConnected
            ? setImporting({ platform, username: username.trim(), count: 20 })
            : connectAccount()}>
          {loading ? 'Verifying...' : isConnected ? 'Import More Games' : 'Connect Account'}
        </button>
      </div>

      {/* PGN fallback */}
      <div className={s.pgnSection}>
        <button className={s.pgnBtn} onClick={() => setShowPgn(true)}>
          📋 Import from PGN instead
        </button>
        <span className={s.pgnHint}>Useful if the API is slow or unavailable</span>
      </div>
    </div></div>
  );
}
