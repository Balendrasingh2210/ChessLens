import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status,  setStatus]  = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No verification token found.'); return; }
    api.get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => { setStatus('success'); setMessage(data.message); })
      .catch((err)     => { setStatus('error');   setMessage(err?.response?.data?.message ?? 'Verification failed. The link may have expired.'); });
  }, [token]);

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>

        {status === 'loading' && (
          <>
            <h1 className={s.title}>Verifying…</h1>
            <p className={s.sub}>Please wait while we verify your email.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 className={s.title}>Email Verified!</h1>
            <p className={s.sub} style={{ color: 'var(--green)' }}>✓ {message}</p>
            <Link to="/login">
              <button className={s.btn} style={{ marginTop: 16 }}>Go to Login</button>
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className={s.title}>Verification Failed</h1>
            <p className={s.sub} style={{ color: 'var(--red)' }}>{message}</p>
            <p className={s.footer}>
              <Link to="/register">Create a new account</Link>
              {' · '}
              <Link to="/login">Login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
