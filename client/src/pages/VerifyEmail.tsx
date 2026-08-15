import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [status,  setStatus]  = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone,    setResendDone]    = useState(false);
  const [resendEmail,   setResendEmail]   = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No verification token found.'); return; }
    api.get(`/auth/verify-email?token=${token}`)
      .then(({ data }) => { setStatus('success'); setMessage(data.message); })
      .catch((err)     => { setStatus('error');   setMessage(err?.response?.data?.message ?? 'Verification failed. The link may have expired.'); });
  }, [token]);

  const resend = async () => {
    if (!resendEmail.trim()) return;
    setResendLoading(true);
    try {
      await api.post('/auth/resend-verification', { email: resendEmail.trim() });
      setResendDone(true);
    } finally { setResendLoading(false); }
  };

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
            {resendDone ? (
              <p className={s.sub} style={{ color: 'var(--green)' }}>✓ New verification email sent — check your inbox</p>
            ) : (
              <div className={s.form} style={{ marginTop: 16 }}>
                <p style={{ color: 'var(--text-sub)', fontSize: '0.85rem', margin: '0 0 8px' }}>Enter your email to get a new link:</p>
                <input
                  className={s.input}
                  type="email"
                  placeholder="Your email address"
                  value={resendEmail}
                  onChange={e => setResendEmail(e.target.value)}
                />
                <button className={s.btn} onClick={resend} disabled={resendLoading || !resendEmail.trim()}>
                  {resendLoading ? 'Sending…' : 'Resend Verification Email'}
                </button>
              </div>
            )}
            <p className={s.footer} style={{ marginTop: 12 }}><Link to="/login">← Back to Login</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
