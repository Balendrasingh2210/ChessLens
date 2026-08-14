import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);

  useEffect(() => {
    if (!token) navigate('/forgot-password', { replace: true });
  }, [token, navigate]);

  const submit = async () => {
    setError('');
    if (!newPw)            { setError('Password is required'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    if (newPw.length < 6)  { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: newPw });
      setDone(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Reset failed');
    } finally { setLoading(false); }
  };

  if (done) return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Password Updated</h1>
        <p className={s.sub} style={{ color: 'var(--green)' }}>✓ Your password has been reset successfully.</p>
        <button className={s.btn} style={{ marginTop: 16 }} onClick={() => navigate('/login')}>
          Go to Login
        </button>
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Set New Password</h1>
        <p className={s.sub}>Choose a strong password for your account.</p>
        {error && <div className={s.error}>{error}</div>}
        <div className={s.form}>
          <input
            className={s.input} type="password" placeholder="New password (min 6 chars)"
            value={newPw} onChange={e => { setNewPw(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          <input
            className={s.input} type="password" placeholder="Confirm new password"
            value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          <button className={s.btn} onClick={submit} disabled={loading}>
            {loading ? 'Resetting…' : 'Set New Password'}
          </button>
        </div>
        <p className={s.footer}><Link to="/login">← Back to login</Link></p>
      </div>
    </div>
  );
}
