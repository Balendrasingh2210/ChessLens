import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { Chess, Square } from 'chess.js';
import api from '../utils/api';
import { useGameRecommendations } from '../hooks/useYouTubeRecs';
import s from './GameReview.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mistake {
  moveNumber: number;
  color: string;
  played: string;
  best: string;
  playedFen: string;
  type: 'blunder' | 'mistake' | 'inaccuracy';
  category: string;
  delta: number;           // cp delta (legacy)
  winDropPct: number;      // win% points lost (new)
  winBefore: number;       // win% before move (0–100)
  winAfterPlayed: number;  // win% after played move (0–100)
  evalBefore: number;
  evalAfter: number;
  explanation: string | null;
}

interface MoveHistoryEntry {
  moveNum: number;
  color: string;
  san: string;
  evalAfterWhite: number;
  winPct: number;          // player's win% after this move (0–100)
  delta: number;           // win% points dropped
  classification: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  bestMove?: string;       // engine's best move SAN (shown when classification !== 'best')
}

interface GameData {
  _id: string;
  opponent: string;
  result: string;
  accuracy: number | null;
  platform: string;
  playerColor: string;
  opening: string | null;
  eco: string | null;
  mistakes: Mistake[];
  moveHistory: MoveHistoryEntry[];
  pgn: string;
  playedAt: string;
  timeControl: string | null;
}

interface MoveEntry {
  san: string;
  fen: string;
  from: Square;
  to: Square;
  moveNum: number;
  color: 'w' | 'b';
  mistake?: Mistake;
  // From moveHistory (populated for player moves in analyzed games)
  classification?: string;
  evalAfterWhite?: number;
  winPct?: number;
  delta?: number;       // win% points dropped
  bestMove?: string;    // engine best SAN (when not 'best' classification)
  fenBefore?: string;   // fen before this move (for best-move arrows on non-mistakes)
}

type CompareMode = 'played' | 'best';

// ── Constants ─────────────────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const QUALITY: Record<string, { icon: string; color: string; label: string; bg: string }> = {
  blunder:    { icon: '??', color: '#f85149', label: 'Blunder',     bg: 'rgba(248,81,73,0.12)'  },
  mistake:    { icon: '?',  color: '#d29922', label: 'Mistake',     bg: 'rgba(210,153,34,0.12)' },
  inaccuracy: { icon: '?!', color: '#388bfd', label: 'Inaccuracy',  bg: 'rgba(56,139,253,0.12)' },
  good:       { icon: '',   color: '#3fb950', label: 'Good move',   bg: 'rgba(63,185,80,0.08)'  },
  excellent:  { icon: '!',  color: '#3fb950', label: 'Excellent!',  bg: 'rgba(63,185,80,0.12)'  },
  best:       { icon: '!!', color: '#00d0b4', label: 'Best move',   bg: 'rgba(0,208,180,0.12)'  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format centipawns for display: "+1.2", "-0.5", "#3", etc. */
function fmtEval(cp: number): string {
  if (Math.abs(cp) >= 9000) return cp > 0 ? '#' : '-#';
  const pawns = cp / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

/** Clamp eval to ±500cp and convert to white bar fraction (0=all black, 1=all white). */
function evalToFraction(evalWhite: number): number {
  const clamped = Math.max(-500, Math.min(500, evalWhite));
  return (clamped + 500) / 1000;
}

/** Get from/to squares for the best move by replaying SAN on the before-position. */
function bestMoveSquares(playedFen: string, bestSan: string): { from: Square; to: Square } | null {
  try {
    const chess = new Chess(playedFen);
    const mv = chess.move(bestSan);
    if (!mv) return null;
    return { from: mv.from as Square, to: mv.to as Square };
  } catch { return null; }
}

function buildMoveList(
  pgn: string,
  mistakes: Mistake[],
  moveHistory: MoveHistoryEntry[],
): MoveEntry[] {
  const chess = new Chess();
  try { chess.loadPgn(pgn); } catch { return []; }
  const history = chess.history({ verbose: true });
  const replay  = new Chess();

  const mistakeMap = new Map<string, Mistake>();
  mistakes.forEach(m => mistakeMap.set(`${m.moveNumber}-${m.color}`, m));

  const histMap = new Map<string, MoveHistoryEntry>();
  moveHistory?.forEach(h => histMap.set(`${h.moveNum}-${h.color}`, h));

  const fenBefores: string[] = [];
  const temp = new Chess();
  history.forEach(mv => { fenBefores.push(temp.fen()); temp.move(mv); });

  return history.map((mv, i) => {
    replay.move(mv);
    const moveNum  = Math.floor(i / 2) + 1;
    const color    = mv.color as 'w' | 'b';
    const colorStr = color === 'w' ? 'white' : 'black';
    const mistake  = mistakeMap.get(`${moveNum}-${colorStr}`);
    const hist     = histMap.get(`${moveNum}-${colorStr}`);
    return {
      san: mv.san,
      fen: replay.fen(),
      fenBefore: fenBefores[i],
      from: mv.from as Square,
      to:   mv.to as Square,
      moveNum,
      color,
      mistake,
      classification: hist?.classification ?? (mistake ? mistake.type : undefined),
      evalAfterWhite: hist?.evalAfterWhite,
      winPct:   hist?.winPct,
      delta:    hist?.delta,
      bestMove: hist?.bestMove,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GameReview() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [game, setGame]               = useState<GameData | null>(null);
  const [moves, setMoves]             = useState<MoveEntry[]>([]);
  const [cursor, setCursor]           = useState(-1);
  const [loading, setLoading]         = useState(true);
  const [compareMode, setCompareMode] = useState<CompareMode>('played');
  const [boardWidth, setBoardWidth]   = useState(480);
  const [gameIds, setGameIds]         = useState<string[]>([]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const roRef     = useRef<ResizeObserver | null>(null);
  const boardWrapRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!node) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setBoardWidth(w);
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

  // YouTube recommendations — fetched in the browser (no server IP block)
  // gameId seeds query rotation so each game gets different video suggestions
  const videos = useGameRecommendations(game ? {
    gameId:    game._id,
    opening:   game.opening,
    accuracy:  game.accuracy,
    mistakes:  game.mistakes,
  } : null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor]);

  useEffect(() => {
    api.get('/games?limit=500')
      .then(res => setGameIds(
        (res.data.games as { _id: string; analysisStatus: string }[])
          .filter(g => g.analysisStatus === 'done')
          .map(g => g._id)
      ))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get(`/games/${id}`)
      .then(res => {
        const g: GameData = res.data.game;
        setGame(g);
        const list = buildMoveList(g.pgn, g.mistakes, g.moveHistory ?? []);
        setMoves(list);
        setCursor(list.length - 1);
      })
      .catch(() => navigate('/games'))
      .finally(() => setLoading(false));
  }, [id]);

  const goTo = useCallback((idx: number) => {
    setCursor(Math.max(-1, Math.min(idx, moves.length - 1)));
    setCompareMode('played');
  }, [moves.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(cursor - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cursor + 1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); goTo(-1); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); goTo(moves.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, goTo, moves.length]);

  if (loading) return <div className={s.loading}>Loading game review...</div>;
  if (!game)   return null;

  const current = cursor >= 0 ? moves[cursor] : null;
  const mistake = current?.mistake ?? null;
  const quality = current?.classification;

  // ── Eval bar ──────────────────────────────────────────────────────────────
  const evalWhite    = current?.evalAfterWhite ?? 0;
  const evalFraction = evalToFraction(evalWhite);
  const evalDisplay  = current?.evalAfterWhite != null ? fmtEval(current.evalAfterWhite) : null;

  // ── Board position & arrows ───────────────────────────────────────────────
  type Arrow = [Square, Square, string];

  let displayFen = current?.fen ?? START_FEN;
  let squareStyles: Record<string, React.CSSProperties> = {};
  let arrows: Arrow[] = [];

  // Determine best-move context for the current move (mistakes OR suboptimal moves)
  const hasBestMove = !!(mistake || (current?.bestMove && current?.fenBefore));
  const bestFen     = mistake ? mistake.playedFen : current?.fenBefore;
  const bestSan     = mistake ? mistake.best : current?.bestMove;

  if (compareMode === 'best' && hasBestMove && bestFen && bestSan) {
    displayFen = bestFen;
    const best = bestMoveSquares(bestFen, bestSan);
    if (best) {
      const badColor = mistake ? 'rgba(248,81,73,0.7)' : 'rgba(210,153,34,0.7)';
      arrows = [
        [best.from, best.to, '#3fb950'],
        [current!.from, current!.to, badColor],
      ];
      squareStyles = {
        [best.from]: { background: 'rgba(63,185,80,0.35)' },
        [best.to]:   { background: 'rgba(63,185,80,0.5)' },
      };
    }
  } else if (current) {
    squareStyles = {
      [current.from]: { background: 'rgba(255,255,100,0.35)' },
      [current.to]:   { background: mistake
        ? `${QUALITY[mistake.type]?.color ?? '#f85149'}33`
        : 'rgba(255,255,100,0.5)' },
    };
  }

  // ── Counts (player's moves only) ─────────────────────────────────────────
  const blunderCount    = game.mistakes.filter(m => m.type === 'blunder'    && m.color === game.playerColor).length;
  const mistakeCount    = game.mistakes.filter(m => m.type === 'mistake'    && m.color === game.playerColor).length;
  const inaccuracyCount = game.mistakes.filter(m => m.type === 'inaccuracy' && m.color === game.playerColor).length;

  // ── Move pairs ────────────────────────────────────────────────────────────
  type Pair = { num: number; white?: MoveEntry; wIdx: number; black?: MoveEntry; bIdx: number };
  const pairs: Pair[] = [];
  moves.forEach((mv, i) => {
    if (mv.color === 'w') {
      pairs.push({ num: mv.moveNum, white: mv, wIdx: i, bIdx: -1 });
    } else {
      const last = pairs[pairs.length - 1];
      if (last && last.num === mv.moveNum) { last.black = mv; last.bIdx = i; }
      else pairs.push({ num: mv.moveNum, bIdx: i, black: mv, wIdx: -1 });
    }
  });

  // ── Annotation content ────────────────────────────────────────────────────
  const renderAnnotation = () => {
    if (!current) {
      return <div className={s.annotationEmpty}>Navigate moves to review your game</div>;
    }

    const q = quality ? QUALITY[quality] : null;

    if (mistake) {
      const canToggle = !!(mistake.playedFen && mistake.best);
      const winLost   = mistake.winDropPct != null
        ? `−${mistake.winDropPct.toFixed(1)}%`
        : `−${mistake.delta}cp`;
      return (
        <div className={s.annotation} style={{ borderLeftColor: QUALITY[mistake.type].color, background: QUALITY[mistake.type].bg }}>
          <div className={s.annotationHead} style={{ color: QUALITY[mistake.type].color }}>
            <span>{QUALITY[mistake.type].icon} {QUALITY[mistake.type].label}</span>
            <span className={s.annCategory}>{mistake.category}</span>
          </div>

          {canToggle && (
            <div className={s.compareRow}>
              <button
                className={`${s.compareBtn} ${compareMode === 'played' ? s.compareBtnActive : ''}`}
                style={compareMode === 'played' ? { borderColor: QUALITY[mistake.type].color, color: QUALITY[mistake.type].color } : {}}
                onClick={() => setCompareMode('played')}
              >
                {mistake.color === game.playerColor ? 'Your move: ' : 'Played: '}<strong>{mistake.played}</strong>
              </button>
              <button
                className={`${s.compareBtn} ${compareMode === 'best' ? s.compareBtnActive : ''}`}
                style={compareMode === 'best' ? { borderColor: '#3fb950', color: '#3fb950' } : {}}
                onClick={() => setCompareMode('best')}
              >
                Best: <strong>{mistake.best}</strong> ✓
              </button>
            </div>
          )}

          {/* Win% stats row */}
          <div className={s.winStatsRow}>
            {mistake.winBefore != null && (
              <div className={s.winStat}>
                <span className={s.winStatLabel}>Before</span>
                <span className={s.winStatVal}>{mistake.winBefore}%</span>
              </div>
            )}
            <div className={s.winStatArrow} style={{ color: QUALITY[mistake.type].color }}>
              {winLost} win chance
            </div>
            {mistake.winAfterPlayed != null && (
              <div className={s.winStat}>
                <span className={s.winStatLabel}>After</span>
                <span className={s.winStatVal}>{mistake.winAfterPlayed}%</span>
              </div>
            )}
          </div>

          {mistake.explanation
            ? <p className={s.annExpl}>🤖 {mistake.explanation}</p>
            : null
          }

          {compareMode === 'best' && (
            <p className={s.annHint}>Showing best move on board ↑</p>
          )}
        </div>
      );
    }

    // Non-mistake move
    if (q) {
      const canToggle = !!(current.bestMove && current.fenBefore);
      const isPlayerMove = current.color === (game.playerColor === 'white' ? 'w' : 'b');
      return (
        <div className={s.annotation} style={{ borderLeftColor: q.color, background: q.bg }}>
          <div className={s.annotationHead} style={{ color: q.color }}>
            <span>{q.icon ? `${q.icon} ` : ''}{q.label}</span>
            {current.winPct != null && (
              <span className={s.annCategory}>{current.winPct}% win chance</span>
            )}
          </div>

          {canToggle && (
            <div className={s.compareRow}>
              <button
                className={`${s.compareBtn} ${compareMode === 'played' ? s.compareBtnActive : ''}`}
                style={compareMode === 'played' ? { borderColor: q.color, color: q.color } : {}}
                onClick={() => setCompareMode('played')}
              >
                {isPlayerMove ? 'Your move: ' : 'Played: '}<strong>{current.san}</strong>
              </button>
              <button
                className={`${s.compareBtn} ${compareMode === 'best' ? s.compareBtnActive : ''}`}
                style={compareMode === 'best' ? { borderColor: '#3fb950', color: '#3fb950' } : {}}
                onClick={() => setCompareMode('best')}
              >
                Best: <strong>{current.bestMove}</strong> ✓
              </button>
            </div>
          )}

          {current.evalAfterWhite != null && (
            <div className={s.annDeltaRow}>
              <span className={s.annDeltaLabel}>Position eval</span>
              <span className={s.annDeltaVal}>
                {fmtEval(current.evalAfterWhite)}
              </span>
            </div>
          )}

          {compareMode === 'best' && canToggle && (
            <p className={s.annHint}>Showing best move on board ↑</p>
          )}
        </div>
      );
    }

    return <div className={s.annotationEmpty}>✓ Move played</div>;
  };

  const currentIdx = gameIds.indexOf(id ?? '');
  const prevId = currentIdx > 0 ? gameIds[currentIdx - 1] : null;
  const nextId = currentIdx >= 0 && currentIdx < gameIds.length - 1 ? gameIds[currentIdx + 1] : null;

  return (
    <div className={s.page}>
      {/* Top bar */}
      <div className={s.topBar}>
        <button className={s.back} onClick={() => navigate('/games')}>← Back</button>
        {gameIds.length > 1 && (
          <div className={s.gameNav}>
            <button className={s.gameNavBtn} onClick={() => prevId && navigate(`/games/${prevId}`)} disabled={!prevId}>◀ Prev</button>
            <span className={s.gameNavPos}>{currentIdx + 1} / {gameIds.length}</span>
            <button className={s.gameNavBtn} onClick={() => nextId && navigate(`/games/${nextId}`)} disabled={!nextId}>Next ▶</button>
          </div>
        )}
        <div className={s.gameTitle}>
          <span className={`${s.resultBadge} ${s[game.result]}`}>
            {game.result === 'win' ? 'Won' : game.result === 'loss' ? 'Lost' : 'Draw'}
          </span>
          <span className={s.vs}>
            {game.playerColor === 'white' ? '♔' : '♚'} vs <strong>{game.opponent}</strong>
          </span>
          {game.eco     && <span className={s.ecoBadge}>{game.eco}</span>}
          {game.opening && <span className={s.opening}>{game.opening}</span>}
        </div>
        <div className={s.accuracy}>
          Accuracy: <strong>{game.accuracy != null ? `${game.accuracy}%` : '—'}</strong>
        </div>
      </div>

      {/* Body */}
      <div className={s.body}>

        {/* Left: eval bar + board + controls */}
        <div className={s.boardCol}>
          <div className={s.playerTag}>
            {game.playerColor === 'white' ? '⬛' : '⬜'} {game.opponent}
          </div>

          {/* Board row: eval bar + chessboard */}
          <div className={s.boardRow}>
            {/* Eval bar */}
            <div className={s.evalBar}>
              <div
                className={s.evalBarBlack}
                style={{ height: `${(1 - evalFraction) * 100}%` }}
              />
              <div
                className={s.evalBarWhite}
                style={{ height: `${evalFraction * 100}%` }}
              />
              {evalDisplay && (
                <div
                  className={s.evalScore}
                  style={{
                    top: evalFraction > 0.55 ? '4px' : undefined,
                    bottom: evalFraction <= 0.55 ? '4px' : undefined,
                    color: evalFraction > 0.55 ? '#1a1a1a' : '#eee',
                  }}
                >
                  {evalDisplay}
                </div>
              )}
            </div>

            <div className={s.boardWrap} ref={boardWrapRef}>
              <Chessboard
                position={displayFen}
                boardWidth={boardWidth}
                boardOrientation={game.playerColor as 'white' | 'black'}
                arePiecesDraggable={false}
                customDarkSquareStyle={{ backgroundColor: '#769656' }}
                customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
                customSquareStyles={squareStyles}
                customArrows={arrows}
                animationDuration={100}
              />
            </div>
          </div>

          <div className={s.playerTag}>
            {game.playerColor === 'white' ? '⬜' : '⬛'} You
          </div>

          {/* Nav buttons */}
          <div className={s.controls}>
            <button className={s.navBtn} onClick={() => goTo(-1)} title="Start">⏮</button>
            <button className={s.navBtn} onClick={() => goTo(cursor - 1)} disabled={cursor < 0}>◀</button>
            <span className={s.moveLabel}>
              {cursor < 0
                ? 'Starting position'
                : `${moves[cursor].moveNum}${moves[cursor].color === 'w' ? '.' : '...'} ${moves[cursor].san}`
              }
            </span>
            <button className={s.navBtn} onClick={() => goTo(cursor + 1)} disabled={cursor >= moves.length - 1}>▶</button>
            <button className={s.navBtn} onClick={() => goTo(moves.length - 1)} title="End">⏭</button>
          </div>
          <div className={s.keyHint}>Use ← → arrow keys to navigate</div>

          {/* Summary */}
          <div className={s.summary}>
            <div className={s.sumItem}><span style={{ color: QUALITY.blunder.color }}>{blunderCount}</span>Blunders</div>
            <div className={s.sumItem}><span style={{ color: QUALITY.mistake.color }}>{mistakeCount}</span>Mistakes</div>
            <div className={s.sumItem}><span style={{ color: QUALITY.inaccuracy.color }}>{inaccuracyCount}</span>Inaccuracies</div>
          </div>
        </div>

        {/* Right: annotation + move list + video recs */}
        <div className={s.movePanel}>
          {/* Annotation box — sits above the move list */}
          <div className={s.annotationWrap}>
            {renderAnnotation()}
          </div>
          <div className={s.movePanelHead}>
            <span className={s.movePanelTitle}>Move List</span>
            <span className={s.movePanelCount}>{moves.length} moves</span>
          </div>

          <div className={s.moveList}>
            {pairs.map(pair => (
              <div key={pair.num} className={s.pairRow}>
                <span className={s.pairNum}>{pair.num}.</span>

                {pair.white ? (
                  <button
                    ref={cursor === pair.wIdx ? activeRef : null}
                    className={`${s.moveChip} ${cursor === pair.wIdx ? s.activeMove : ''}`}
                    style={pair.white.classification && cursor !== pair.wIdx
                      ? { color: QUALITY[pair.white.classification]?.color ?? 'inherit' }
                      : {}}
                    onClick={() => goTo(pair.wIdx)}
                  >
                    {pair.white.san}
                    {pair.white.classification && QUALITY[pair.white.classification]?.icon && (
                      <sup className={s.qualityIcon}>{QUALITY[pair.white.classification].icon}</sup>
                    )}
                  </button>
                ) : <span className={s.moveChipEmpty} />}

                {pair.black ? (
                  <button
                    ref={cursor === pair.bIdx ? activeRef : null}
                    className={`${s.moveChip} ${cursor === pair.bIdx ? s.activeMove : ''}`}
                    style={pair.black.classification && cursor !== pair.bIdx
                      ? { color: QUALITY[pair.black.classification]?.color ?? 'inherit' }
                      : {}}
                    onClick={() => goTo(pair.bIdx)}
                  >
                    {pair.black.san}
                    {pair.black.classification && QUALITY[pair.black.classification]?.icon && (
                      <sup className={s.qualityIcon}>{QUALITY[pair.black.classification].icon}</sup>
                    )}
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {/* Jump to mistakes */}
          {game.mistakes.length > 0 && (
            <div className={s.jumpSection}>
              <div className={s.jumpTitle}>Jump to mistake</div>
              <div className={s.jumpList}>
                {game.mistakes.map((m, i) => {
                  const idx = moves.findIndex(
                    mv => mv.moveNum === m.moveNumber && (mv.color === 'w' ? 'white' : 'black') === m.color
                  );
                  return (
                    <button
                      key={i}
                      className={`${s.jumpBtn} ${cursor === idx ? s.activeJump : ''}`}
                      style={{ borderColor: QUALITY[m.type]?.color }}
                      onClick={() => goTo(idx)}
                    >
                      <span style={{ color: QUALITY[m.type]?.color }}>{QUALITY[m.type]?.icon}</span>
                      {' '}M{m.moveNumber} {m.color === 'white' ? '' : '...'}{m.played}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* YouTube Recommendations */}
          {videos.length > 0 && (
            <div className={s.videoSection}>
              <div className={s.videoSectionTitle}>
                <span>▶ Recommended Videos</span>
                <span className={s.videoSectionSub}>based on this game</span>
              </div>
              <div className={s.videoList}>
                {videos.map(v => (
                  <a
                    key={v.videoId}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.videoCard}
                  >
                    <img src={v.thumbnail} alt={v.title} className={s.videoThumb} />
                    <div className={s.videoInfo}>
                      <span className={s.videoReason}>{v.reason}</span>
                      <span className={s.videoTitle}>{v.title}</span>
                      <span className={s.videoChannel}>{v.channel}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
