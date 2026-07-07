import { useEffect, useState, useMemo } from 'react';
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
  pending:   'Queued',
  analyzing: 'Analyzing',
  done:      'Done',
  error:     'Error',
};

const PAGE_SIZE = 20;

export default function Games() {
  const [allGames, setAllGames]   = useState<Game[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting]   = useState(false);

  // Filters
  const [platform,    setPlatform]    = useState('');
  const [result,      setResult]      = useState('');
  const [openingQ,    setOpeningQ]    = useState('');
  const [timeControl, setTimeControl] = useState('');

  // Load all games once (pagination happens client-side after filtering)
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/games?limit=500');
      setAllGames(data.games);
      setTotal(data.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Auto-refresh if any games are still analyzing
  useEffect(() => {
    const hasAnalyzing = allGames.some(g => g.analysisStatus === 'pending' || g.analysisStatus === 'analyzing');
    if (!hasAnalyzing) return;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [allGames]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [platform, result, openingQ, timeControl]);

  // Derive unique time controls for the dropdown
  const timeControls = useMemo(() => {
    const set = new Set(allGames.map(g => g.timeControl).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [allGames]);

  // Apply all filters
  const filtered = useMemo(() => {
    return allGames.filter(g => {
      if (platform    && g.platform !== platform)                                       return false;
      if (result      && g.result   !== result)                                          return false;
      if (openingQ    && !g.opening?.toLowerCase().includes(openingQ.toLowerCase()))     return false;
      if (timeControl && g.timeControl !== timeControl)                                  return false;
      return true;
    });
  }, [allGames, platform, result, openingQ, timeControl]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const analyzingCount = allGames.filter(g => g.analysisStatus === 'pending' || g.analysisStatus === 'analyzing').length;

  const hasFilters = platform || result || openingQ || timeControl;

  const clearFilters = () => {
    setPlatform('');
    setResult('');
    setOpeningQ('');
    setTimeControl('');
  };

  const handleDeleteAll = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    try {
      await api.delete('/games/all');
      setAllGames([]);
      setTotal(0);
    } catch { /* ignore */ }
    finally { setDeleting(false); setDeleteConfirm(false); }
  };

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>My Games</h1>
        {allGames.length > 0 && (
          deleteConfirm ? (
            <div className={s.deleteConfirmRow}>
              <span className={s.deleteConfirmText}>Delete all {allGames.length} games?</span>
              <button className={s.deleteConfirmYes} onClick={handleDeleteAll} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete all'}
              </button>
              <button className={s.deleteConfirmNo} onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </div>
          ) : (
            <button className={s.deleteBtn} onClick={handleDeleteAll}>🗑 Delete All</button>
          )
        )}
        <Link to="/connect" className={s.importBtn}>+ Import Games</Link>
      </div>

      {analyzingCount > 0 && (
        <div className={s.analyzingBanner}>
          <div className={s.analyzingSpinner} />
          <span>
            <strong>{analyzingCount}</strong> game{analyzingCount !== 1 ? 's' : ''} analyzing in background — refreshing automatically
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div className={s.filterBar}>
        {/* Platform */}
        <div className={s.filterGroup}>
          {['', 'chess.com', 'lichess'].map(p => (
            <button
              key={p || 'all'}
              className={`${s.filterBtn} ${platform === p ? s.active : ''}`}
              onClick={() => setPlatform(p)}
            >
              {p || 'All Platforms'}
            </button>
          ))}
        </div>

        {/* Result */}
        <div className={s.filterGroup}>
          {['', 'win', 'loss', 'draw'].map(r => (
            <button
              key={r || 'all-r'}
              className={`${s.filterBtn} ${result === r ? `${s.active} ${r ? s[`result_${r}`] : ''}` : ''}`}
              onClick={() => setResult(r)}
            >
              {r ? r.charAt(0).toUpperCase() + r.slice(1) : 'All Results'}
            </button>
          ))}
        </div>

        {/* Time control */}
        {timeControls.length > 0 && (
          <select
            className={s.filterSelect}
            value={timeControl}
            onChange={e => setTimeControl(e.target.value)}
          >
            <option value="">All Time Controls</option>
            {timeControls.map(tc => (
              <option key={tc} value={tc}>{tc}</option>
            ))}
          </select>
        )}

        {/* Opening search */}
        <input
          className={s.filterInput}
          placeholder="Search opening…"
          value={openingQ}
          onChange={e => setOpeningQ(e.target.value)}
        />

        {hasFilters && (
          <button className={s.clearBtn} onClick={clearFilters}>✕ Clear</button>
        )}
      </div>

      <div className={s.meta}>
        {hasFilters
          ? <><strong>{filtered.length}</strong> of {allGames.length} games</>
          : <><strong>{allGames.length}</strong> games total</>
        }
      </div>

      {loading ? (
        <div className={s.loading}>
          <div className={s.loadingSpinner} />
          Loading games...
        </div>
      ) : paginated.length === 0 ? (
        <div className={s.empty}>
          {hasFilters
            ? <>No games match your filters. <button className={s.clearBtn} onClick={clearFilters}>Clear filters</button></>
            : <>No games yet. <Link to="/connect">Connect an account to import games →</Link></>
          }
        </div>
      ) : (
        <>
          <div className={s.table}>
            <div className={s.thead}>
              <span>Result</span>
              <span>Opponent</span>
              <span>Opening</span>
              <span>Time</span>
              <span>Accuracy</span>
              <span>Status</span>
              <span>Date</span>
            </div>
            {paginated.map(g => (
              <Link
                key={g._id}
                to={g.analysisStatus === 'done' ? `/games/${g._id}` : '#'}
                className={`${s.row} ${g.analysisStatus !== 'done' ? s.notDone : ''}`}
              >
                <span className={`${s.result} ${s[g.result]}`}>
                  {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                </span>
                <span className={s.opponent}>
                  <span className={s.color}>{g.playerColor === 'white' ? '♔' : '♚'}</span>
                  vs {g.opponent}
                  {g.opponentRating ? <span className={s.rating}> ({g.opponentRating})</span> : null}
                </span>
                <span className={s.opening}>{g.opening ?? '—'}</span>
                <span className={s.timeCtrl}>{g.timeControl ?? '—'}</span>
                <span className={s.accuracy}>{g.accuracy != null ? `${g.accuracy}%` : '—'}</span>
                <span className={`${s.statusBadge} ${s[`status_${g.analysisStatus}`]}`}>
                  {STATUS_LABEL[g.analysisStatus] ?? g.analysisStatus}
                </span>
                <span className={s.date}>{new Date(g.playedAt).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className={s.pagination}>
              <button className={s.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Prev</button>
              <span className={s.pageInfo}>Page {page} of {totalPages}</span>
              <button className={s.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
