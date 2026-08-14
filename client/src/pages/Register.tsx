import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import s from './Auth.module.css';

export default function Register() {
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.post('/auth/register', { username, email, password });
      setDone(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Registration failed');
    } finally { setLoading(false); }
  };

  if (done) return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Check your email</h1>
        <p className={s.sub}>
          We sent a verification link to <strong>{email}</strong>.<br />
          Click it to activate your account, then come back to log in.
        </p>
        <p className={s.footer}><Link to="/login">Go to Login →</Link></p>
      </div>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>♟ ChessLens</div>
        <h1 className={s.title}>Create account</h1>
        <p className={s.sub}>Your personal AI chess coach</p>
        {error && <div className={s.error}>{error}</div>}
        <form onSubmit={submit} className={s.form}>
          <input className={s.input} type="text"     placeholder="Username"            value={username} onChange={e => setUsername(e.target.value)} required minLength={3} />
          <input className={s.input} type="email"    placeholder="Email"               value={email}    onChange={e => setEmail(e.target.value)}    required />
          <input className={s.input} type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          <button className={s.btn} disabled={loading}>{loading ? 'Creating...' : 'Get Started'}</button>
        </form>
        <p className={s.footer}>Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
