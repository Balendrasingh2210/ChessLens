import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../utils/api';
import s from './Auth.module.css';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const unverified = error.toLowerCase().includes('verify your email');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setResendDone(false); setLoading(true);
    try {
      await login(identifier, password);
      navigate('/');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Login failed');
    } finally { setLoading(false); }
  };

  const resend = async () => {
    setResendLoading(true);
    try {
      // resend-verification requires an email; if user typed username, prompt them
      const emailVal = identifier.includes('@') ? identifier : '';
      await api.post('/auth/resend-verification', { email: emailVal });
      setResendDone(true);
    } finally { setResendLoading(false); }
  };

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Sign in</h1>
        {error && (
          <div className={s.error}>
            {error}
            {unverified && (
              <div style={{ marginTop: 8 }}>
                {resendDone
                  ? <span style={{ color: 'var(--green)' }}>✓ Verification email sent — check your inbox</span>
                  : <button
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontSize: 'inherit' }}
                      onClick={resend}
                      disabled={resendLoading}
                    >
                      {resendLoading ? 'Sending…' : 'Resend verification email'}
                    </button>
                }
              </div>
            )}
          </div>
        )}
        <form onSubmit={submit} className={s.form}>
          <input
            className={s.input}
            type="text"
            placeholder="Email or Username"
            value={identifier}
            onChange={e => { setIdentifier(e.target.value); setResendDone(false); }}
            autoComplete="username"
            required
          />
          <input className={s.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className={s.btn} disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <p className={s.footer}><Link to="/forgot-password">Forgot password?</Link></p>
        <p className={s.footer}>New here? <Link to="/register">Create an account</Link></p>
      </div>
    </div>
  );
}
