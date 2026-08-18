import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import s from './Openings.module.css';

interface OpeningStat {
  opening: string;
  eco: string | null;
  count: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgAccuracy: number | null;
  openingMistakes: number;
  totalMistakes: number;
}

type SortKey = 'count' | 'winRate' | 'avgAccuracy' | 'openingMistakes';

export default function Openings() {
  const navigate = useNavigate();
  const [openings, setOpenings] = useState<OpeningStat[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sortKey, setSortKey]   = useState<SortKey>('count');
  const [sortDir, setSortDir]   = useState<1 | -1>(-1);

  useEffect(() => {
    api.get('/analysis/openings')
      .then(({ data }) => setOpenings(data.openings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...openings].sort((a, b) => {
    const av = a[sortKey] ?? -1;
    const bv = b[sortKey] ?? -1;
    return sortDir * (bv - av);
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === -1 ? 1 : -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className={s.sortIcon}>{sortKey === k ? (sortDir === -1 ? ' ↓' : ' ↑') : ' ↕'}</span>
  );

  if (loading) return (
    <div className={s.page}>
      <div className={s.loading}><div className={s.spinner} />Loading openings...</div>
    </div>
  );

  if (!openings.length) return (
    <div className={s.page}>
      <div className={s.empty}>
        <div className={s.emptyIcon}>♟</div>
        <h2>No openings data yet</h2>
        <p>Import and analyze games to see your opening repertoire here.</p>
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Opening Repertoire</h1>
          <p className={s.sub}>{openings.length} openings across {openings.reduce((s, o) => s + o.count, 0)} games</p>
        </div>
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.thOpening}>Opening</th>
              <th className={s.th} onClick={() => toggleSort('count')}>Games <SortIcon k="count" /></th>
              <th className={s.th}>W / D / L</th>
              <th className={s.th} onClick={() => toggleSort('winRate')}>Win% <SortIcon k="winRate" /></th>
              <th className={s.th} onClick={() => toggleSort('avgAccuracy')}>Accuracy <SortIcon k="avgAccuracy" /></th>
              <th className={s.th} onClick={() => toggleSort('openingMistakes')}>Opening Errors <SortIcon k="openingMistakes" /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(o => (
              <tr
                key={o.opening}
                className={s.row}
                onClick={() => navigate(`/games?opening=${encodeURIComponent(o.opening)}`)}
                title="Click to view games"
              >
                <td className={s.tdOpening}>
                  {o.eco && <span className={s.eco}>{o.eco}</span>}
                  <span className={s.openingName}>{o.opening}</span>
                </td>
                <td className={s.td}>{o.count}</td>
                <td className={s.td}>
                  <span className={s.win}>{o.wins}</span>
                  <span className={s.sep}>/</span>
                  <span className={s.draw}>{o.draws}</span>
                  <span className={s.sep}>/</span>
                  <span className={s.loss}>{o.losses}</span>
                </td>
                <td className={s.td}>
                  <div className={s.winRateCell}>
                    <div className={s.winBar} style={{ width: `${o.winRate}%`, background: winRateColor(o.winRate) }} />
                    <span>{o.winRate}%</span>
                  </div>
                </td>
                <td className={s.td}>
                  {o.avgAccuracy != null ? (
                    <span style={{ color: accColor(o.avgAccuracy) }}>{o.avgAccuracy}%</span>
                  ) : '—'}
                </td>
                <td className={s.td}>
                  {o.openingMistakes > 0 ? (
                    <span className={s.mistakeBadge}>{o.openingMistakes}</span>
                  ) : <span className={s.ok}>✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function winRateColor(pct: number) {
  if (pct >= 60) return 'var(--green)';
  if (pct >= 40) return 'var(--orange)';
  return 'var(--red)';
}

function accColor(acc: number) {
  if (acc >= 85) return 'var(--green)';
  if (acc >= 70) return 'var(--orange)';
  return 'var(--red)';
}
