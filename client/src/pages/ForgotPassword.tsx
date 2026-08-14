import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';
import fs from './ForgotPassword.module.css';

export default function ForgotPassword() {
  const navigate = useNavigate();

  // Step 1: enter email
  const [email,     setEmail]     = useState('');
  const [step1Busy, setStep1Busy] = useState(false);
  const [step1Err,  setStep1Err]  = useState('');
  const [devToken,  setDevToken]  = useState('');

  // Step 2: enter token + new password
  const [token,     setToken]     = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [step2Busy, setStep2Busy] = useState(false);
  const [step2Err,  setStep2Err]  = useState('');
  const [done,      setDone]      = useState(false);

  const step = devToken ? 2 : 1;

  const requestReset = async () => {
    setStep1Err('');
    if (!email.trim()) { setStep1Err('Email is required'); return; }
    setStep1Busy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setDevToken(data.devToken ?? '');
    } catch (err: unknown) {
      setStep1Err((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Request failed');
    } finally { setStep1Busy(false); }
  };

  const resetPassword = async () => {
    setStep2Err('');
    if (!token.trim())    { setStep2Err('Token is required'); return; }
    if (!newPw)           { setStep2Err('New password is required'); return; }
    if (newPw !== confirmPw) { setStep2Err('Passwords do not match'); return; }
    if (newPw.length < 6) { setStep2Err('Password must be at least 6 characters'); return; }
    setStep2Busy(true);
    try {
      await api.post('/auth/reset-password', { token: token.trim(), newPassword: newPw });
      setDone(true);
    } catch (err: unknown) {
      setStep2Err((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Reset failed');
    } finally { setStep2Busy(false); }
  };

  if (done) {
    return (
      <div className={s.page}>
        <div className={s.card}>
          <div className={s.brand}>♟ ChessLens</div>
          <h1 className={s.title}>Password Reset</h1>
          <p className={`${s.sub} ${fs.successMsg}`}>✓ Password updated successfully!</p>
          <button className={s.btn} onClick={() => navigate('/login')}>Back to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>{step === 1 ? 'Forgot Password' : 'Reset Password'}</h1>
        <p className={s.sub}>
          {step === 1 ? 'Enter your email to get a reset token' : 'Enter the token and your new password'}
        </p>

        {/* Step indicator */}
        <div className={fs.steps}>
          <div className={`${fs.stepDot} ${step >= 1 ? fs.stepDone : ''}`}>1</div>
          <div className={fs.stepLine} />
          <div className={`${fs.stepDot} ${step >= 2 ? fs.stepDone : ''}`}>2</div>
        </div>

        {step === 1 ? (
          <div className={s.form}>
            <input
              className={s.input}
              type="email"
              placeholder="Your account email"
              value={email}
              onChange={e => { setEmail(e.target.value); setStep1Err(''); }}
              onKeyDown={e => e.key === 'Enter' && requestReset()}
            />
            {step1Err && <div className={s.error}>{step1Err}</div>}
            <button className={s.btn} onClick={requestReset} disabled={step1Busy}>
              {step1Busy ? 'Sending…' : 'Get Reset Token'}
            </button>
          </div>
        ) : (
          <div className={s.form}>
            {/* Dev token callout */}
            <div className={fs.devBox}>
              <div className={fs.devLabel}>Dev mode — no email service</div>
              <div className={fs.devToken}>{devToken}</div>
              <button className={fs.copyBtn} onClick={() => { setToken(devToken); }}>
                Copy to field ↓
              </button>
            </div>

            <input
              className={s.input}
              placeholder="Paste reset token"
              value={token}
              onChange={e => { setToken(e.target.value); setStep2Err(''); }}
            />
            <input
              className={s.input}
              type="password"
              placeholder="New password (min 6 chars)"
              value={newPw}
              onChange={e => { setNewPw(e.target.value); setStep2Err(''); }}
            />
            <input
              className={s.input}
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={e => { setConfirmPw(e.target.value); setStep2Err(''); }}
            />
            {step2Err && <div className={s.error}>{step2Err}</div>}
            <button className={s.btn} onClick={resetPassword} disabled={step2Busy}>
              {step2Busy ? 'Resetting…' : 'Reset Password'}
            </button>
          </div>
        )}

        <p className={s.footer}><Link to="/login">← Back to login</Link></p>
      </div>
    </div>
  );
}
