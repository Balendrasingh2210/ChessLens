import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { Chess, Square } from 'chess.js';
import api from '../utils/api';
import s from './Puzzles.module.css';

interface Puzzle {
  puzzleId: string;
  fen: string;
  solution: string[];
  themes: string[];
  rating: number;
  gameUrl: string | null;
}

type Arrow = [Square, Square, string?];

export default function Puzzles() {
  const [searchParams] = useSearchParams();
  const themeParam = searchParams.get('theme') || undefined;

  const [puzzle, setPuzzle]           = useState<Puzzle | null>(null);
  const [theme, setTheme]             = useState('');
  const [chess]                       = useState(new Chess());
  const [fen, setFen]                 = useState('start');
  const [solutionIdx, setSolutionIdx] = useState(0);
  const [status, setStatus]           = useState<'playing'|'correct'|'wrong'|'done'>('playing');
  const [loading, setLoading]         = useState(true);
  const [stats, setStats]             = useState({ total: 0, correct: 0 });
  const [startTime, setStartTime]     = useState(Date.now());
  const [boardWidth, setBoardWidth]   = useState(480);
  const roRef = useRef<ResizeObserver | null>(null);
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
  const [playerColor, setPlayerColor] = useState<'white'|'black'>('white');

  // Move hints
  const [selectedSq, setSelectedSq]       = useState<Square | null>(null);
  const [squareStyles, setSquareStyles]   = useState<Record<string, React.CSSProperties>>({});
  const [validMoves, setValidMoves]       = useState<Set<string>>(new Set());

  // Arrows (right-click analysis)
  const [arrows, setArrows]           = useState<Arrow[]>([]);
  const arrowStartRef                 = useRef<Square | null>(null);

  // Hint (0 = none shown, 1 = from-square shown, 2 = full arrow shown)
  const [hintLevel, setHintLevel]     = useState(0);

  // ── helpers ───────────────────────────────────────────────────────────────

  const clearSelection = () => {
    setSelectedSq(null);
    setSquareStyles({});
    setValidMoves(new Set());
  };

  const clearArrows = () => {
    setArrows([]);
    arrowStartRef.current = null;
  };

  const showHint = () => {
    if (!puzzle || status !== 'playing') return;
    const uci  = puzzle.solution[solutionIdx];
    const from = uci.slice(0, 2) as Square;
    const to   = uci.slice(2, 4) as Square;

    if (hintLevel === 0) {
      // Level 1: highlight the piece that needs to move
      clearSelection();
      setSquareStyles({ [from]: { background: 'rgba(255,165,0,0.6)', borderRadius: '4px', boxShadow: '0 0 0 3px rgba(255,165,0,0.8)' } });
      setHintLevel(1);
    } else {
      // Level 2: show full move arrow
      setArrows([[from, to, 'rgba(255,165,0,0.85)']]);
      setHintLevel(2);
    }
  };

  const showMoveHints = (sq: Square) => {
    const moves = chess.moves({ square: sq, verbose: true });
    if (!moves.length) return false;

    const styles: Record<string, React.CSSProperties> = {
      [sq]: { background: 'rgba(255,255,0,0.45)' },
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

  // ── puzzle loading ────────────────────────────────────────────────────────

  const loadPuzzle = useCallback(async () => {
    setLoading(true);
    clearSelection();
    clearArrows();
    setHintLevel(0);
    try {
      const params = themeParam ? `?theme=${themeParam}` : '';
      const { data } = await api.get(`/puzzles/next${params}`);
      const p: Puzzle = data.puzzle;
      setTheme(data.theme);
      setPuzzle(p);
      chess.load(p.fen);
      setFen(chess.fen());
      setSolutionIdx(0);
      setStatus('playing');
      setStartTime(Date.now());
      setPlayerColor(chess.turn() === 'w' ? 'white' : 'black');
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  }, [themeParam]);

  useEffect(() => { loadPuzzle(); }, [loadPuzzle]);

  // ── move execution ────────────────────────────────────────────────────────

  const executeMove = (from: Square, to: Square): boolean => {
    if (!puzzle || status !== 'playing') return false;

    const expectedUci = puzzle.solution[solutionIdx];
    const expFrom     = expectedUci.slice(0, 2) as Square;
    const expTo       = expectedUci.slice(2, 4) as Square;
    const promotion   = expectedUci[4] || 'q';

    // Wrong move
    if (from !== expFrom || to !== expTo) {
      setSquareStyles({
        [from]: { background: 'rgba(255,50,50,0.45)' },
        [to]:   { background: 'rgba(255,50,50,0.45)' },
      });
      setTimeout(clearSelection, 700);
      setStatus('wrong');
      return false;
    }

    const move = chess.move({ from, to, promotion });
    if (!move) return false;

    const greenFlash: Record<string, React.CSSProperties> = {
      [from]: { background: 'rgba(0,220,80,0.35)' },
      [to]:   { background: 'rgba(0,220,80,0.5)' },
    };
    setSquareStyles(greenFlash);
    setSelectedSq(null);
    setValidMoves(new Set());

    const nextIdx = solutionIdx + 1;

    if (nextIdx >= puzzle.solution.length) {
      setFen(chess.fen());
      setStatus('done');
      submitAttempt(true);
    } else {
      setFen(chess.fen());
      setStatus('correct');
      setTimeout(() => {
        const opp     = puzzle.solution[nextIdx];
        const oppFrom = opp.slice(0, 2) as Square;
        const oppTo   = opp.slice(2, 4) as Square;
        chess.move({ from: oppFrom, to: oppTo, promotion: opp[4] || 'q' });
        setFen(chess.fen());
        setSquareStyles({
          [oppFrom]: { background: 'rgba(255,165,0,0.35)' },
          [oppTo]:   { background: 'rgba(255,165,0,0.45)' },
        });
        setSolutionIdx(nextIdx + 1);
        setStatus('playing');
      }, 500);
      setSolutionIdx(nextIdx);
    }
    return true;
  };

  // ── click handler ─────────────────────────────────────────────────────────

  const onSquareClick = (sq: Square) => {
    if (status !== 'playing') return;
    clearArrows();

    // Nothing selected yet — try to select this piece
    if (!selectedSq) {
      showMoveHints(sq);
      return;
    }

    // Clicking same square → deselect
    if (selectedSq === sq) {
      clearSelection();
      return;
    }

    // Clicking a valid destination → try to move
    if (validMoves.has(sq)) {
      executeMove(selectedSq, sq);
      return;
    }

    // Clicking another own piece → switch selection
    const piece = chess.get(sq);
    const myColor = playerColor === 'white' ? 'w' : 'b';
    if (piece && piece.color === myColor) {
      showMoveHints(sq);
      return;
    }

    // Clicking any other invalid square → just deselect
    clearSelection();
  };

  // ── drag handler ──────────────────────────────────────────────────────────

  const onDrop = (from: string, to: string): boolean => {
    if (status !== 'playing') return false;
    clearSelection();
    clearArrows();
    return executeMove(from as Square, to as Square);
  };

  // ── right-click arrow drawing ─────────────────────────────────────────────

  const onSquareRightClick = (sq: Square) => {
    clearSelection();

    if (!arrowStartRef.current) {
      // First right-click: mark start
      arrowStartRef.current = sq;
      setSquareStyles({ [sq]: { background: 'rgba(255,170,0,0.5)', borderRadius: '50%' } });
    } else if (arrowStartRef.current === sq) {
      // Right-click same square → clear everything
      clearArrows();
      clearSelection();
    } else {
      // Second right-click: draw arrow
      const from = arrowStartRef.current;
      const to   = sq;
      setArrows(prev => {
        // Toggle: if this arrow already exists, remove it
        const exists = prev.findIndex(a => a[0] === from && a[1] === to);
        if (exists !== -1) return prev.filter((_, i) => i !== exists);
        return [...prev, [from, to, 'rgb(255,170,0)']];
      });
      arrowStartRef.current = null;
      setSquareStyles({});
    }
  };

  // Left-click on board background clears arrows
  const onBoardClick = () => {
    if (arrowStartRef.current) {
      clearArrows();
      clearSelection();
    }
  };

  // ── show correct answer ───────────────────────────────────────────────────

  const showCorrectAnswer = () => {
    if (!puzzle) return;
    submitAttempt(false);
    const uci  = puzzle.solution[solutionIdx];
    const from = uci.slice(0, 2) as Square;
    const to   = uci.slice(2, 4) as Square;
    setArrows([[from, to, 'rgb(0,200,100)']]);
    setSquareStyles({
      [from]: { background: 'rgba(0,200,100,0.35)' },
      [to]:   { background: 'rgba(0,200,100,0.5)' },
    });
    setStatus('wrong');
  };

  // ── submit ────────────────────────────────────────────────────────────────

  const submitAttempt = async (correct: boolean) => {
    if (!puzzle) return;
    try {
      const { data } = await api.post('/puzzles/attempt', {
        puzzleId: puzzle.puzzleId, theme, fen: puzzle.fen,
        solution: puzzle.solution, correct,
        timeTaken: Math.round((Date.now() - startTime) / 1000),
      });
      setStats(data.stats);
    } catch { /* ignore */ }
  };

  const handleTryAgain = () => {
    clearSelection();
    clearArrows();
    setHintLevel(0);
    setStatus('playing');
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) return <div className={s.loading}><div className={s.loadingSpinner} />Loading puzzle...</div>;
  if (!puzzle)  return <div className={s.loading}>No puzzles available</div>;

  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Puzzle Trainer</h1>
          <p className={s.sub}>Theme: <strong>{theme}</strong> · Rating: <strong>{puzzle.rating}</strong></p>
        </div>
        <div className={s.statsRow}>
          <div className={s.stat}><span>{stats.correct}</span>Correct</div>
          <div className={s.stat}><span>{stats.total - stats.correct}</span>Wrong</div>
          <div className={s.stat}><span>{accuracy}%</span>Accuracy</div>
        </div>
      </div>

      <div className={s.body}>
        <div className={s.boardWrap} ref={boardWrapRef} onClick={onBoardClick}>
          <Chessboard
            position={fen}
            boardWidth={boardWidth}
            onPieceDrop={onDrop}
            onSquareClick={onSquareClick}
            onSquareRightClick={onSquareRightClick}
            boardOrientation={playerColor}
            customDarkSquareStyle={{ backgroundColor: '#769656' }}
            customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
            customSquareStyles={squareStyles}
            customArrows={arrows}
            animationDuration={200}
            arePiecesDraggable={status === 'playing'}
          />
        </div>

        <div className={s.panel}>
          <div className={s.instruction}>
            {playerColor === 'white' ? '♔ Find the best move for White' : '♚ Find the best move for Black'}
          </div>

          <div className={`${s.feedback} ${status === 'done' ? s.done : status === 'correct' ? s.correct : status === 'wrong' ? s.wrong : ''}`}>
            {status === 'playing' && '🎯 Click a piece to see valid moves'}
            {status === 'correct' && '✅ Correct! Opponent is responding...'}
            {status === 'done'    && '🏆 Puzzle solved!'}
            {status === 'wrong'   && '❌ Incorrect move'}
          </div>

          {status === 'playing' && hintLevel < 2 && (
            <button className={s.tryAgainBtn} style={{ color: 'rgba(255,165,0,0.9)' }} onClick={showHint}>
              {hintLevel === 0 ? '💡 Hint (show piece)' : '💡 Hint (show move)'}
            </button>
          )}

          {status === 'wrong' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={s.tryAgainBtn} onClick={handleTryAgain}>Try Again</button>
              <button className={s.tryAgainBtn} style={{ color: 'var(--green)' }} onClick={showCorrectAnswer}>Show Answer</button>
            </div>
          )}

          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            💡 Right-click squares to draw arrows for analysis. Right-click start square to clear.
          </div>

          <div className={s.themes}>
            {puzzle.themes.slice(0, 4).map(t => (
              <span key={t} className={s.themeTag}>{t}</span>
            ))}
          </div>

          {puzzle.gameUrl && (
            <a href={puzzle.gameUrl} target="_blank" rel="noopener noreferrer" className={s.sourceLink}>
              View original game →
            </a>
          )}

          {(status === 'done' || status === 'wrong') && (
            <button className={s.nextBtn} onClick={loadPuzzle}>Next Puzzle →</button>
          )}
        </div>
      </div>
    </div>
  );
}
