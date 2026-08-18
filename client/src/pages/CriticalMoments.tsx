import { useEffect, useState, useCallback, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, Square } from 'chess.js';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import s from './CriticalMoments.module.css';

interface Moment {
  id: string;
  fen: string;
  best: string;
  played: string;
  type: 'blunder' | 'mistake';
  category: string;
  moveNumber: number;
  color: 'white' | 'black';
  winDropPct: number;
  opponent: string;
  opening: string | null;
  gameId: string;
}

type PhaseStatus = 'thinking' | 'correct' | 'wrong';

const CATEGORY_LABEL: Record<string, string> = {
  tactical: 'Tactics', 'hanging-piece': 'Hanging Piece', opening: 'Opening',
  endgame: 'Endgame', positional: 'Positional', 'time-pressure': 'Time Pressure',
  'king-safety': 'King Safety', other: 'Other',
};

export default function CriticalMoments() {
  const [moments, setMoments]       = useState<Moment[]>([]);
  const [idx, setIdx]               = useState(0);
  const [loading, setLoading]       = useState(true);
  const [phase, setPhase]           = useState<PhaseStatus>('thinking');
  const [fen, setFen]               = useState('start');
  const [chess]                     = useState(new Chess());
  const [boardWidth, setBoardWidth] = useState(480);
  const [squareStyles, setSquareStyles] = useState<Record<string, React.CSSProperties>>({});
  const [selectedSq, setSelectedSq]    = useState<Square | null>(null);
  const [validMoves, setValidMoves]    = useState<Set<string>>(new Set());
  const [solvedCount, setSolvedCount]  = useState(0);
  const [attemptedCount, setAttemptedCount] = useState(0);

  const boardWrapRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setBoardWidth(w);
    });
    ro.observe(node);
  }, []);

  // ── load positions ────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/games/critical-moments?limit=25')
      .then(({ data }) => {
        setMoments(data.moments ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── set up board when idx changes ─────────────────────────────────────────
  useEffect(() => {
    const m = moments[idx];
    if (!m) return;
    chess.load(m.fen);
    setFen(chess.fen());
    setPhase('thinking');
    setSquareStyles({});
    setSelectedSq(null);
    setValidMoves(new Set());
  }, [idx, moments]);

  // ── move hint dots ────────────────────────────────────────────────────────
  const showMoveHints = (sq: Square) => {
    const moves = chess.moves({ square: sq, verbose: true });
    if (!moves.length) return false;
    const styles: Record<string, React.CSSProperties> = {
      [sq]: { background: 'rgba(255,255,0,0.4)' },
    };
    const targets = new Set<string>();
    moves.forEach(m => {
      targets.add(m.to);
      const isCapture = !!chess.get(m.to as Square);
      styles[m.to] = isCapture
        ? { background: 'radial-gradient(circle, rgba(0,0,0,0) 54%, rgba(20,85,30,0.6) 54%)', borderRadius: '50%' }
        : { background: 'radial-gradient(circle, rgba(20,85,30,0.55) 30%, transparent 30%)' };
    });
    setSelectedSq(sq);
    setSquareStyles(styles);
    setValidMoves(targets);
    return true;
  };

  // ── attempt a move ────────────────────────────────────────────────────────
  const tryMove = (from: Square, to: Square): boolean => {
    const m = moments[idx];
    if (!m || phase !== 'thinking') return false;

    const move = chess.move({ from, to, promotion: 'q' });
    if (!move) return false;

    const correct = move.san === m.best;
    setFen(chess.fen());
    setAttemptedCount(c => c + 1);

    if (correct) {
      setSolvedCount(c => c + 1);
      setPhase('correct');
      setSquareStyles({
        [from]: { background: 'rgba(63,185,80,0.35)' },
        [to]:   { background: 'rgba(63,185,80,0.5)' },
      });
    } else {
      setPhase('wrong');
      setSquareStyles({
        [from]: { background: 'rgba(248,81,73,0.35)' },
        [to]:   { background: 'rgba(248,81,73,0.5)' },
      });
    }

    setSelectedSq(null);
    setValidMoves(new Set());
    return true;
  };

  const onSquareClick = (sq: Square) => {
    if (phase !== 'thinking') return;
    if (!selectedSq) { showMoveHints(sq); return; }
    if (selectedSq === sq) { setSelectedSq(null); setSquareStyles({}); setValidMoves(new Set()); return; }
    if (validMoves.has(sq)) { tryMove(selectedSq, sq); return; }
    const piece = chess.get(sq);
    const myColor = moments[idx]?.color === 'white' ? 'w' : 'b';
    if (piece && piece.color === myColor) { showMoveHints(sq); return; }
    setSelectedSq(null); setSquareStyles({}); setValidMoves(new Set());
  };

  const onDrop = (from: string, to: string): boolean => {
    if (phase !== 'thinking') return false;
    setSelectedSq(null); setSquareStyles({}); setValidMoves(new Set());
    return tryMove(from as Square, to as Square);
  };

  const goNext = () => {
    if (idx + 1 < moments.length) {
      setIdx(i => i + 1);
    } else {
      // Reload for more positions
      setLoading(true);
      api.get('/games/critical-moments?limit=25')
        .then(({ data }) => { setMoments(data.moments ?? []); setIdx(0); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  };

  const resetBoard = () => {
    const m = moments[idx];
    if (!m) return;
    chess.load(m.fen);
    setFen(chess.fen());
    setPhase('thinking');
    setSquareStyles({});
    setSelectedSq(null);
    setValidMoves(new Set());
  };

  // ── render ────────────────────────────────────────────────────────────────
  const moment = moments[idx];
  const accuracy = attemptedCount > 0 ? Math.round((solvedCount / attemptedCount) * 100) : null;

  if (loading) return (
    <div className={s.page}>
      <div className={s.loading}><div className={s.spinner} />Loading your critical positions...</div>
    </div>
  );

  if (!moments.length) return (
    <div className={s.page}>
      <div className={s.empty}>
        <div className={s.emptyIcon}>🎯</div>
        <h2>No critical moments yet</h2>
        <p>Import and analyze some games first — your blunder positions will appear here for practice.</p>
        <Link to="/connect" className={s.emptyBtn}>Import Games →</Link>
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Critical Moments</h1>
          <p className={s.sub}>Train your own blunders · {idx + 1} of {moments.length}</p>
        </div>
        <div className={s.headerStats}>
          <div className={s.stat}><span>{solvedCount}</span>Solved</div>
          <div className={s.stat}><span>{attemptedCount - solvedCount}</span>Missed</div>
          {accuracy !== null && <div className={s.stat}><span>{accuracy}%</span>Accuracy</div>}
        </div>
      </div>

      {moment && (
        <div className={s.body}>
          <div className={s.boardWrap} ref={boardWrapRef}>
            <Chessboard
              position={fen}
              boardWidth={boardWidth}
              onPieceDrop={onDrop}
              onSquareClick={onSquareClick}
              boardOrientation={moment.color}
              customDarkSquareStyle={{ backgroundColor: '#769656' }}
              customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
              customSquareStyles={squareStyles}
              animationDuration={150}
              arePiecesDraggable={phase === 'thinking'}
            />
          </div>

          <div className={s.panel}>
            {/* Context */}
            <div className={s.context}>
              <div className={s.contextRow}>
                <span className={s.contextLabel}>Position</span>
                <span className={s.contextVal}>Move {moment.moveNumber} · {moment.color === 'white' ? 'White' : 'Black'} to move</span>
              </div>
              {moment.opponent && (
                <div className={s.contextRow}>
                  <span className={s.contextLabel}>vs</span>
                  <span className={s.contextVal}>{moment.opponent}</span>
                </div>
              )}
              {moment.opening && (
                <div className={s.contextRow}>
                  <span className={s.contextLabel}>Opening</span>
                  <span className={s.contextVal}>{moment.opening}</span>
                </div>
              )}
              <div className={s.contextRow}>
                <span className={s.contextLabel}>Category</span>
                <span className={`${s.badge} ${s[`badge_${moment.type}`]}`}>
                  {moment.type} · {CATEGORY_LABEL[moment.category] ?? moment.category}
                </span>
              </div>
              <div className={s.contextRow}>
                <span className={s.contextLabel}>Win% lost</span>
                <span className={s.contextVal} style={{ color: 'var(--red)', fontWeight: 700 }}>
                  −{moment.winDropPct?.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Instruction */}
            <div className={s.instruction}>
              {phase === 'thinking' && `Find the best move for ${moment.color}`}
              {phase === 'correct' && `✅ Correct! Best move was ${moment.best}`}
              {phase === 'wrong' && `❌ You played wrong`}
            </div>

            {/* Feedback */}
            {phase !== 'thinking' && (
              <div className={phase === 'correct' ? s.feedbackCorrect : s.feedbackWrong}>
                <div className={s.moveRow}>
                  <span className={s.moveLabel}>Best move</span>
                  <span className={s.moveSan}>{moment.best}</span>
                </div>
                <div className={s.moveRow}>
                  <span className={s.moveLabel}>You played</span>
                  <span className={s.moveSan} style={{ color: phase === 'correct' ? 'var(--green)' : 'var(--red)' }}>
                    {phase === 'correct' ? moment.best : moment.played}
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className={s.actions}>
              {phase === 'thinking' && (
                <button className={s.skipBtn} onClick={goNext}>Skip →</button>
              )}
              {phase === 'wrong' && (
                <>
                  <button className={s.retryBtn} onClick={resetBoard}>↩ Retry</button>
                  <button className={s.nextBtn} onClick={goNext}>Next →</button>
                </>
              )}
              {phase === 'correct' && (
                <button className={s.nextBtn} onClick={goNext}>Next Position →</button>
              )}
            </div>

            {/* Progress bar */}
            <div className={s.progressWrap}>
              <div className={s.progressBar} style={{ width: `${((idx + 1) / moments.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
