import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
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

export default function Analysis() {
  const [profile, setProfile]     = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [summary, setSummary]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [limit, setLimit]         = useState(0);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/analysis/profile'),
      api.get('/analysis/breakdown'),
    ]).then(([p, b]) => {
      setProfile(p.data.profile);
      setSummary(p.data.coachingSummary);
      setBreakdown(b.data);
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
