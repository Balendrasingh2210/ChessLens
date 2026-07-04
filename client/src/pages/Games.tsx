import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import s from './Games.module.css';

interface Game {
  _id: string;
  opponent: string;
  result: 'win' | 'loss' | 'draw';
  accuracy: number | null;
  platform: string;
  playedAt: string;
  opening: string | null;
  playerColor: string;
  playerRating: number | null;
  opponentRating: number | null;
  analysisStatus: string;
  timeControl: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '⏳ Queued',
  analyzing: '🔄 Analyzing',
  done: '✅ Done',
  error: '❌ Error',
};

export default function Games() {
  const [games, setGames] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const load = async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' });
      if (filter) params.set('platform', filter);
      const { data } = await api.get(`/games?${params}`);
      setGames(data.games);
      setTotal(data.total);
      setPage(p);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(1); }, [filter]);

  // Auto-refresh if any games are still analyzing
  useEffect(() => {
    const hasAnalyzing = games.some(g => g.analysisStatus === 'pending' || g.analysisStatus === 'analyzing');
    if (!hasAnalyzing) return;
    const timer = setTimeout(() => load(page), 5000);
    return () => clearTimeout(timer);
  }, [games]);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>My Games</h1>
        <div className={s.filters}>
          <button className={`${s.filterBtn} ${filter === '' ? s.active : ''}`} onClick={() => setFilter('')}>All</button>
          <button className={`${s.filterBtn} ${filter === 'chess.com' ? s.active : ''}`} onClick={() => setFilter('chess.com')}>Chess.com</button>
          <button className={`${s.filterBtn} ${filter === 'lichess' ? s.active : ''}`} onClick={() => setFilter('lichess')}>Lichess</button>
        </div>
        <Link to="/connect" className={s.importBtn}>+ Import Games</Link>
      </div>

      <div className={s.meta}>{total} games total</div>

      {loading ? (
        <div className={s.loading}>
          <div className={s.loadingSpinner} />
          Loading games...
        </div>
      ) : games.length === 0 ? (
        <div className={s.empty}>
          No games yet. <Link to="/connect">Connect an account to import games →</Link>
        </div>
      ) : (
        <>
          <div className={s.table}>
            <div className={s.thead}>
              <span>Result</span>
              <span>Opponent</span>
              <span>Opening</span>
              <span>Platform</span>
              <span>Accuracy</span>
              <span>Status</span>
              <span>Date</span>
            </div>
            {games.map(g => (
              <Link key={g._id} to={g.analysisStatus === 'done' ? `/games/${g._id}` : '#'} className={`${s.row} ${g.analysisStatus !== 'done' ? s.notDone : ''}`}>
                <span className={`${s.result} ${s[g.result]}`}>
                  {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                </span>
                <span className={s.opponent}>
                  <span className={s.color}>{g.playerColor === 'white' ? '♔' : '♚'}</span>
                  vs {g.opponent}
                  {g.opponentRating ? <span className={s.rating}> ({g.opponentRating})</span> : null}
                </span>
                <span className={s.opening}>{g.opening ?? '—'}</span>
                <span className={s.platform}>{g.platform}</span>
                <span className={s.accuracy}>{g.accuracy != null ? `${g.accuracy}%` : '—'}</span>
                <span className={s.status}>{STATUS_LABEL[g.analysisStatus] ?? g.analysisStatus}</span>
                <span className={s.date}>{new Date(g.playedAt).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>

          {total > 20 && (
            <div className={s.pagination}>
              <button className={s.pageBtn} onClick={() => load(page - 1)} disabled={page === 1}>← Prev</button>
              <span className={s.pageInfo}>Page {page} of {Math.ceil(total / 20)}</span>
              <button className={s.pageBtn} onClick={() => load(page + 1)} disabled={page >= Math.ceil(total / 20)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
