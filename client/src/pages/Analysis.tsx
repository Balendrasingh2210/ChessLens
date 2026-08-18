import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ReferenceLine, CartesianGrid,
} from 'recharts';
import api from '../utils/api';
import s from './Analysis.module.css';

const COLORS = ['#f85149', '#d29922', '#388bfd', '#3fb950', '#bc8cff', '#e3b341', '#58a6ff', '#8b949e'];

const LABELS: Record<string, string> = {
  'tactical': 'Tactics',
  'hanging-piece': 'Hanging Pieces',
  'opening': 'Openings',
  'endgame': 'Endgames',
  'positional': 'Positional',
  'time-pressure': 'Time Pressure',
  'king-safety': 'King Safety',
  'other': 'Other',
};

const LIMITS = [
  { label: 'Last 10',  value: 10 },
  { label: 'Last 30',  value: 30 },
  { label: 'All Time', value: 0  },
];

interface TrendGame {
  accuracy: number;
  result: 'win' | 'loss' | 'draw';
  opponent: string;
  playedAt: string;
  opening: string | null;
}

interface TimeBucket {
  label: string;
  count: number;
  blunders: number;
  mistakes: number;
}

interface RatingBand {
  label: string;
  count: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgAccuracy: number | null;
}

interface EndgameTheme {
  name: string;
  count: number;
}

interface OpeningRep {
  opening: string;
  eco: string | null;
  count: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgAccuracy: number | null;
  openingMistakes: number;
}

interface Opponent {
  opponent: string;
  count: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgAccuracy: number | null;
  avgRating: number | null;
  lastPlayed: string;
}

export default function Analysis() {
  const [profile, setProfile]         = useState<any>(null);
  const [breakdown, setBreakdown]     = useState<any>(null);
  const [summary, setSummary]         = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [limit, setLimit]             = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const [trend, setTrend]             = useState<TrendGame[]>([]);
  const [timePressure, setTimePressure] = useState<TimeBucket[]>([]);
  const [ratingBands, setRatingBands] = useState<RatingBand[]>([]);
  const [endgameThemes, setEndgameThemes] = useState<EndgameTheme[]>([]);
  const [opponents, setOpponents]     = useState<Opponent[]>([]);
  const [openingRep, setOpeningRep]   = useState<OpeningRep[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/analysis/profile'),
      api.get('/analysis/breakdown'),
      api.get('/analysis/accuracy-trend?limit=30'),
      api.get('/analysis/time-pressure'),
      api.get('/analysis/rating-bands'),
      api.get('/analysis/endgame-themes'),
      api.get('/analysis/opponents'),
      api.get('/analysis/openings'),
    ]).then(([p, b, t, tp, rb, et, op, or_]) => {
      setProfile(p.data.profile);
      setSummary(p.data.coachingSummary);
      setBreakdown(b.data);
      setTrend(t.data.games ?? []);
      setTimePressure(tp.data.buckets ?? []);
      setRatingBands(rb.data.bands ?? []);
      setEndgameThemes(et.data.themes ?? []);
      setOpponents(op.data.opponents ?? []);
      setOpeningRep(or_.data.openings ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const applyLimit = async (newLimit: number) => {
    if (newLimit === limit) return;
    setLimit(newLimit);
    setChartLoading(true);
    try {
      const params = newLimit > 0 ? `?limit=${newLimit}` : '';
      const { data } = await api.get(`/analysis/breakdown${params}`);
      setBreakdown(data);
    } catch { /* ignore */ }
    finally { setChartLoading(false); }
  };

  if (loading) return <div className={s.loading}><div className={s.loadingSpinner} />Building your analysis...</div>;

  if (!profile) return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>📊</div>
      <h2>No analysis yet</h2>
      <p>Connect an account and import games to see your weakness breakdown here.</p>
    </div>
  );

  const categoryData = Object.entries(breakdown?.byCategory || {})
    .map(([cat, count]) => ({ name: LABELS[cat] || cat, value: count as number }))
    .sort((a, b) => b.value - a.value);

  const typeData = [
    { name: 'Blunders', value: breakdown?.byType?.blunder || 0, color: '#f85149' },
    { name: 'Mistakes', value: breakdown?.byType?.mistake || 0, color: '#d29922' },
    { name: 'Inaccuracies', value: breakdown?.byType?.inaccuracy || 0, color: '#388bfd' },
  ];

  return (
    <div className={s.page}>
      <div className={s.titleRow}>
        <h1 className={s.title}>Analysis</h1>
        <div className={s.limitBar}>
          {LIMITS.map(l => (
            <button
              key={l.value}
              className={`${s.limitBtn} ${limit === l.value ? s.limitActive : ''}`}
              onClick={() => applyLimit(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {summary && (
        <div className={s.coachCard}>
          <span className={s.coachIcon}>🤖</span>
          <p>{summary}</p>
        </div>
      )}

      <div className={s.statsRow}>
        <Stat label="Games Analyzed" value={String(profile.gamesAnalyzed)} />
        <Stat label="Avg. Accuracy" value={profile.averageAccuracy != null ? `${profile.averageAccuracy}%` : '—'} />
        <Stat label="Win Rate" value={`${Math.round((profile.results.wins / Math.max(profile.gamesAnalyzed, 1)) * 100)}%`} />
        <Stat label="Record" value={`${profile.results.wins}W / ${profile.results.losses}L / ${profile.results.draws}D`} />
      </div>

      <div className={`${s.charts} ${chartLoading ? s.chartsLoading : ''}`}>
        <div className={s.chartCard}>
          <h3 className={s.chartTitle}>Mistakes by Category</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={categoryData} layout="vertical">
              <XAxis type="number" tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={s.chartCard}>
          <h3 className={s.chartTitle}>Mistake Severity</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {typeData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ color: 'var(--text-sub)', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Accuracy Over Time ── */}
      {trend.length >= 2 && (() => {
        const avg = Math.round(trend.reduce((s, g) => s + g.accuracy, 0) / trend.length);
        const trendData = trend.map((g, i) => ({
          idx: i + 1,
          accuracy: g.accuracy,
          result: g.result,
          opponent: g.opponent,
          opening: g.opening,
          date: new Date(g.playedAt).toLocaleDateString(),
          dot: g.result === 'win' ? '#3fb950' : g.result === 'loss' ? '#f85149' : '#8b949e',
        }));

        return (
          <div className={s.chartCard} style={{ marginTop: 16 }}>
            <div className={s.trendHeader}>
              <h3 className={s.chartTitle}>Accuracy Over Time</h3>
              <span className={s.trendAvg}>avg {avg}%</span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="idx" tick={{ fill: 'var(--text-sub)', fontSize: 11 }} label={{ value: 'Game', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-sub)', fontSize: 11 }} unit="%" />
                <ReferenceLine y={avg} stroke="rgba(88,166,255,0.4)" strokeDasharray="4 3" label={{ value: `avg ${avg}%`, fill: 'var(--blue)', fontSize: 10, position: 'right' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(val: number, _name: string, props: any) => [
                    `${val}% — ${props.payload.result}`,
                    props.payload.opponent ? `vs ${props.payload.opponent}` : 'accuracy',
                  ]}
                  labelFormatter={(i: number) => trendData[i - 1] ? `Game ${i} · ${trendData[i - 1].date}` : `Game ${i}`}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="var(--green)"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const color = props.payload.dot;
                    return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={color} stroke="var(--bg-card)" strokeWidth={1.5} />;
                  }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className={s.trendLegend}>
              <span className={s.trendDot} style={{ background: '#3fb950' }} />Win
              <span className={s.trendDot} style={{ background: '#f85149' }} />Loss
              <span className={s.trendDot} style={{ background: '#8b949e' }} />Draw
            </div>
          </div>
        );
      })()}

      {/* ── Time Pressure Heatmap ── */}
      {timePressure.some(b => b.count > 0) && (
        <div className={s.chartCard} style={{ marginTop: 16 }}>
          <h3 className={s.chartTitle}>Mistakes by Clock Time</h3>
          <p className={s.chartSub}>When on the clock do you blunder most?</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timePressure} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <XAxis dataKey="label" tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                formatter={(val: number, name: string) => [val, name === 'blunders' ? 'Blunders' : name === 'mistakes' ? 'Mistakes' : 'Total']}
              />
              <Bar dataKey="blunders" stackId="a" fill="#f85149" name="blunders" radius={[0,0,0,0]} />
              <Bar dataKey="mistakes" stackId="a" fill="#d29922" name="mistakes" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className={s.trendLegend}>
            <span className={s.trendDot} style={{ background: '#f85149' }} />Blunders
            <span className={s.trendDot} style={{ background: '#d29922' }} />Mistakes
          </div>
        </div>
      )}

      {profile.topWeaknesses?.length > 0 && (
        <div className={s.weaknessCard}>
          <h3 className={s.chartTitle}>Your Top Weaknesses</h3>
          <div className={s.weaknessList}>
            {profile.topWeaknesses.map((w: string, i: number) => (
              <div key={w} className={s.weaknessItem}>
                <div className={s.weaknessRank}>{i + 1}</div>
                <div>
                  <div className={s.weaknessName}>{LABELS[w] || w}</div>
                  <div className={s.weaknessCount}>
                    {(profile.categoryBreakdown as Record<string, number>)[w] ?? 0} mistakes
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.openingMistakes?.length > 0 && (
        <div className={s.openingCard}>
          <h3 className={s.chartTitle}>Opening Mistakes</h3>
          {profile.openingMistakes.map((o: { opening: string; count: number }) => (
            <div key={o.opening} className={s.openingRow}>
              <span className={s.openingName}>{o.opening}</span>
              <span className={s.openingCount}>{o.count}×</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Rating Bands ── */}
      {ratingBands.length > 0 && (
        <div className={s.chartCard} style={{ marginTop: 16 }}>
          <h3 className={s.chartTitle}>Performance vs Rating Bands</h3>
          <p className={s.chartSub}>Win rate against opponents relative to your rating</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ratingBands} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--text-sub)', fontSize: 11 }} unit="%" />
              <YAxis dataKey="label" type="category" width={160} tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                formatter={(val: number, _: string, props: any) => [
                  `${val}% win rate (${props.payload.count} games)`,
                  props.payload.label,
                ]}
              />
              <Bar dataKey="winRate" radius={[0, 4, 4, 0]} label={{ position: 'right', formatter: (v: number) => `${v}%`, fill: 'var(--text-sub)', fontSize: 11 }}>
                {ratingBands.map((b, i) => (
                  <Cell key={i} fill={b.winRate >= 55 ? '#3fb950' : b.winRate >= 40 ? '#d29922' : '#f85149'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Endgame Themes ── */}
      {endgameThemes.length > 0 && (
        <div className={s.chartCard} style={{ marginTop: 16 }}>
          <h3 className={s.chartTitle}>Endgame Mistakes by Theme</h3>
          <p className={s.chartSub}>Which endgame types cause you the most trouble?</p>
          <div className={s.endgameList}>
            {endgameThemes.map((t, i) => (
              <div key={t.name} className={s.endgameRow}>
                <span className={s.endgameRank}>{i + 1}</span>
                <span className={s.endgameName}>{t.name}</span>
                <div className={s.endgameBarWrap}>
                  <div
                    className={s.endgameBar}
                    style={{ width: `${Math.min(100, (t.count / (endgameThemes[0]?.count || 1)) * 100)}%` }}
                  />
                </div>
                <span className={s.endgameCount}>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Opening Repertoire ── */}
      {openingRep.length > 0 && (
        <div className={s.chartCard} style={{ marginTop: 16 }}>
          <h3 className={s.chartTitle}>Opening Repertoire</h3>
          <p className={s.chartSub}>Win rate and accuracy breakdown per opening (min 1 game)</p>
          <div className={s.oppTableWrap}>
            <table className={s.oppTable}>
              <thead>
                <tr>
                  <th>Opening</th>
                  <th>Games</th>
                  <th>W / D / L</th>
                  <th>Win%</th>
                  <th>Accuracy</th>
                  <th>Opening Errors</th>
                </tr>
              </thead>
              <tbody>
                {openingRep.map(o => (
                  <tr key={o.opening}>
                    <td className={s.oppName}>
                      {o.eco && <span style={{ color: 'var(--text-muted)', marginRight: 6, fontSize: '0.75rem' }}>{o.eco}</span>}
                      {o.opening}
                    </td>
                    <td>{o.count}</td>
                    <td>
                      <span className={s.w}>{o.wins}</span>
                      <span className={s.sep}>/</span>
                      <span className={s.d}>{o.draws}</span>
                      <span className={s.sep}>/</span>
                      <span className={s.l}>{o.losses}</span>
                    </td>
                    <td style={{ color: o.winRate >= 55 ? 'var(--green)' : o.winRate >= 40 ? 'var(--orange)' : 'var(--red)', fontWeight: 700 }}>
                      {o.winRate}%
                    </td>
                    <td>{o.avgAccuracy != null ? `${o.avgAccuracy}%` : '—'}</td>
                    <td>{o.openingMistakes > 0 ? <span style={{ color: 'var(--red)' }}>{o.openingMistakes}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Opponent History ── */}
      {opponents.length > 0 && (
        <div className={s.chartCard} style={{ marginTop: 16 }}>
          <h3 className={s.chartTitle}>Opponent History</h3>
          <p className={s.chartSub}>Players you've faced multiple times</p>
          <div className={s.oppTableWrap}>
            <table className={s.oppTable}>
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th>Games</th>
                  <th>W / D / L</th>
                  <th>Win%</th>
                  <th>Accuracy</th>
                  <th>Avg Rating</th>
                </tr>
              </thead>
              <tbody>
                {opponents.map(o => (
                  <tr key={o.opponent}>
                    <td className={s.oppName}>{o.opponent}</td>
                    <td>{o.count}</td>
                    <td>
                      <span className={s.w}>{o.wins}</span>
                      <span className={s.sep}>/</span>
                      <span className={s.d}>{o.draws}</span>
                      <span className={s.sep}>/</span>
                      <span className={s.l}>{o.losses}</span>
                    </td>
                    <td style={{ color: o.winRate >= 55 ? 'var(--green)' : o.winRate >= 40 ? 'var(--orange)' : 'var(--red)', fontWeight: 700 }}>
                      {o.winRate}%
                    </td>
                    <td>{o.avgAccuracy != null ? `${o.avgAccuracy}%` : '—'}</td>
                    <td>{o.avgRating ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}
