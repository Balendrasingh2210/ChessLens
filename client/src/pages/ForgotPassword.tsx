import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';

export default function ForgotPassword() {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [sent,    setSent]    = useState(false);

  const submit = async () => {
    setError('');
    if (!email.trim()) { setError('Email is required'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Request failed');
    } finally { setLoading(false); }
  };

  if (sent) return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Check your email</h1>
        <p className={s.sub}>
          If <strong>{email}</strong> has a ChessLens account, we've sent a password reset link.
          Check your inbox and click the link to set a new password.
        </p>
        <p className={s.footer}><Link to="/login">← Back to login</Link></p>
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Forgot Password</h1>
        <p className={s.sub}>Enter your account email and we'll send you a reset link.</p>
        {error && <div className={s.error}>{error}</div>}
        <div className={s.form}>
          <input
            className={s.input} type="email" placeholder="Your account email"
            value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          <button className={s.btn} onClick={submit} disabled={loading}>
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </div>
        <p className={s.footer}><Link to="/login">← Back to login</Link></p>
      </div>
    </div>
  );
}
