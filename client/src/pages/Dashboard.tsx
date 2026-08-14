import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useWeaknessRecommendations } from '../hooks/useYouTubeRecs';
import s from './Dashboard.module.css';

interface DashboardData {
  weaknessProfile: {
    topWeaknesses: string[];
    averageAccuracy: number | null;
    gamesAnalyzed: number;
    results: { wins: number; losses: number; draws: number };
    categoryBreakdown: Record<string, number>;
    recommendedThemes: string[];
  } | null;
  recentGames: Array<{
    _id: string;
    opponent: string;
    result: 'win' | 'loss' | 'draw';
    accuracy: number | null;
    platform: string;
    playedAt: string;
    opening: string | null;
  }>;
  puzzleStats: { total: number; correct: number };
  coachingSummary: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  'tactical': 'Tactics',
  'hanging-piece': 'Hanging Pieces',
  'opening': 'Openings',
  'endgame': 'Endgames',
  'positional': 'Positional',
  'time-pressure': 'Time Pressure',
  'king-safety': 'King Safety',
  'other': 'Other',
};

export default function Dashboard() {
  const { user } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const profile = data?.weaknessProfile;

  // YouTube recommendations — fetched in the browser (no server IP block)
  const videos = useWeaknessRecommendations(profile ? {
    topWeaknesses:   profile.topWeaknesses,
    averageAccuracy: profile.averageAccuracy,
  } : null);

  useEffect(() => {
    api.get('/profile/dashboard')
      .then(res => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const hasAccount = user?.connectedAccounts && user.connectedAccounts.length > 0;

  const radarData = profile
    ? Object.entries(profile.categoryBreakdown || {}).map(([cat, val]) => ({
        subject: CATEGORY_LABELS[cat] || cat,
        value: val,
      }))
    : [];

  // Accuracy trend: oldest → newest, only games with accuracy data
  const trendData = (data?.recentGames ?? [])
    .filter(g => g.accuracy != null)
    .slice()
    .reverse()
    .map((g, i) => ({
      game: `#${i + 1}`,
      accuracy: g.accuracy,
      result: g.result,
      opponent: g.opponent,
    }));

  if (loading) return (
    <div className={s.page}>
      <div className={s.loading}>
        <div className={s.loadingSpinner} />
        Loading your dashboard...
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Dashboard</h1>
          <p className={s.sub}>Welcome back, <strong>{user?.username}</strong></p>
        </div>
        {!hasAccount && (
          <Link to="/connect" className={s.connectBtn}>
            + Connect Chess Account
          </Link>
        )}
      </div>

      {/* Coaching Summary */}
      {data?.coachingSummary && (
        <div className={s.coachCard}>
          <div className={s.coachIcon}>🤖</div>
          <div className={s.coachText}>{data.coachingSummary}</div>
        </div>
      )}

      {!hasAccount ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>♟</div>
          <h2>Connect your chess account to get started</h2>
          <p>ChessLens will analyze your games, find your weaknesses, and give you personalized lessons.</p>
          <Link to="/connect" className={s.connectBtn}>Connect Chess.com or Lichess</Link>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div className={s.statsRow}>
            <StatCard color="green"  icon="🎯" label="Avg. Accuracy"  value={profile?.averageAccuracy != null ? `${profile.averageAccuracy}%` : '—'} />
            <StatCard color="blue"   icon="♟" label="Games Analyzed" value={String(profile?.gamesAnalyzed ?? 0)} />
            <StatCard color="purple" icon="🧩" label="Puzzles Solved" value={String(data?.puzzleStats?.correct ?? 0)} sub={`of ${data?.puzzleStats?.total ?? 0} attempted`} />
            <StatCard
              color="orange"
              icon="📈"
              label="Win Rate"
              value={profile ? `${Math.round((profile.results.wins / Math.max(profile.gamesAnalyzed, 1)) * 100)}%` : '—'}
              sub={profile ? `${profile.results.wins}W · ${profile.results.losses}L · ${profile.results.draws}D` : ''}
            />
          </div>

          {/* Accuracy Trend Chart */}
          {trendData.length > 1 && (
            <div className={s.trendCard}>
              <div className={s.cardHeader}>
                <h3 className={s.cardTitle}>Accuracy Trend</h3>
                <span className={s.trendAvg}>avg {profile?.averageAccuracy ?? '—'}%</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="game" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(val: number, _: string, props: any) => [
                      `${val}%`,
                      `vs ${props.payload.opponent} (${props.payload.result})`,
                    ]}
                    labelFormatter={(label) => `Game ${label}`}
                  />
                  <ReferenceLine y={profile?.averageAccuracy ?? 0} stroke="var(--green-dim)" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="var(--green)"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const colors = { win: 'var(--green)', loss: 'var(--red)', draw: 'var(--orange)' };
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={colors[props.payload.result as keyof typeof colors] ?? 'var(--green)'} stroke="var(--bg)" strokeWidth={1.5} />;
                    }}
                    activeDot={{ r: 6, fill: 'var(--green)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className={s.trendLegend}>
                <span className={s.legendDot} style={{ background: 'var(--green)' }} />Win
                <span className={s.legendDot} style={{ background: 'var(--red)' }} />Loss
                <span className={s.legendDot} style={{ background: 'var(--orange)' }} />Draw
                <span className={s.legendLine} />Avg accuracy
              </div>
            </div>
          )}

          <div className={s.cols}>
            {/* Weakness radar chart */}
            {radarData.length > 0 && (
              <div className={s.chartCard}>
                <h3 className={s.cardTitle}>Weakness Breakdown</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-sub)', fontSize: 11 }} />
                    <Radar dataKey="value" stroke="var(--green)" fill="var(--green)" fillOpacity={0.25} />
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  </RadarChart>
                </ResponsiveContainer>

                <div className={s.weaknessList}>
                  {(profile?.topWeaknesses ?? []).map((w, i) => (
                    <div key={w} className={s.weaknessTag}>
                      <span className={s.weaknessRank}>#{i + 1}</span>
                      {CATEGORY_LABELS[w] || w}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent games */}
            <div className={s.gamesCard}>
              <div className={s.cardHeader}>
                <h3 className={s.cardTitle}>Recent Games</h3>
                <Link to="/games" className={s.viewAll}>View all →</Link>
              </div>
              {data?.recentGames?.length ? (
                <div className={s.gamesList}>
                  {data.recentGames.map((g) => (
                    <Link key={g._id} to={`/games/${g._id}`} className={s.gameRow}>
                      <span className={`${s.result} ${s[g.result]}`}>
                        {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                      </span>
                      <div className={s.gameInfo}>
                        <span className={s.opponent}>vs {g.opponent}</span>
                        <span className={s.gameMeta}>
                        {g.opening
                          ? <Link to={`/games?opening=${encodeURIComponent(g.opening)}`} className={s.openingLink} onClick={e => e.stopPropagation()}>{g.opening}</Link>
                          : 'Unknown opening'
                        } · {g.platform}
                      </span>
                      </div>
                      <span className={s.accuracy}>
                        {g.accuracy != null ? `${g.accuracy}%` : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className={s.noGames}>No analyzed games yet. <Link to="/games">Import games →</Link></div>
              )}
            </div>
          </div>

          {/* Recommended puzzles */}
          {profile?.recommendedThemes?.length ? (
            <div className={s.puzzleCard}>
              <h3 className={s.cardTitle}>Recommended Practice</h3>
              <p className={s.puzzleSub}>Based on your weaknesses, focus on these puzzle types:</p>
              <div className={s.themeChips}>
                {profile.recommendedThemes.map((t) => (
                  <Link key={t} to={`/puzzles?theme=${t}`} className={s.themeChip}>{t}</Link>
                ))}
              </div>
              <Link to="/puzzles" className={s.practiceBtn}>Start Practicing →</Link>
            </div>
          ) : null}

          {/* YouTube Recommendations */}
          {videos.length > 0 && (
            <div className={s.videoCard}>
              <div className={s.videoCardHeader}>
                <h3 className={s.cardTitle}>▶ Watch &amp; Improve</h3>
                <span className={s.videoCardSub}>tailored to your weaknesses</span>
              </div>
              <div className={s.videoGrid}>
                {videos.map(v => (
                  <a
                    key={v.videoId}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.videoItem}
                  >
                    <div className={s.videoThumbWrap}>
                      <img src={v.thumbnail} alt={v.title} className={s.videoThumb} />
                      <span className={s.playBadge}>▶</span>
                    </div>
                    <div className={s.videoMeta}>
                      <span className={s.videoReason}>{v.reason}</span>
                      <span className={s.videoTitle}>{v.title}</span>
                      <span className={s.videoChannel}>{v.channel}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, color = 'green' }: { icon: string; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={`${s.statCard} ${s[color]}`}>
      <span className={s.statIcon}>{icon}</span>
      <div className={s.statValue}>{value}</div>
      <div className={s.statLabel}>{label}</div>
      {sub && <div className={s.statSub}>{sub}</div>}
    </div>
  );
}
