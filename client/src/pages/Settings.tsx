import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import api from '../utils/api';
import s from './Settings.module.css';

export default function Settings() {
  const { user, refreshUser } = useAuthStore();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email,    setEmail]    = useState(user?.email ?? '');
  const [profileMsg,  setProfileMsg]  = useState('');
  const [profileErr,  setProfileErr]  = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg,  setPwMsg]  = useState('');
  const [pwErr,  setPwErr]  = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const saveProfile = async () => {
    setProfileMsg(''); setProfileErr('');
    if (!username.trim() || !email.trim()) { setProfileErr('Username and email are required'); return; }
    setProfileBusy(true);
    try {
      await api.put('/auth/update-profile', { username: username.trim(), email: email.trim() });
      await refreshUser();
      setProfileMsg('Profile updated successfully');
    } catch (err: unknown) {
      setProfileErr((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Update failed');
    } finally { setProfileBusy(false); }
  };

  const changePassword = async () => {
    setPwMsg(''); setPwErr('');
    if (!currentPw || !newPw || !confirmPw) { setPwErr('All fields are required'); return; }
    if (newPw !== confirmPw) { setPwErr('New passwords do not match'); return; }
    if (newPw.length < 6) { setPwErr('New password must be at least 6 characters'); return; }
    setPwBusy(true);
    try {
      await api.put('/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      setPwMsg('Password changed successfully');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: unknown) {
      setPwErr((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to change password');
    } finally { setPwBusy(false); }
  };

  return (
    <div className={s.page}>
      <h1 className={s.title}>Settings</h1>

      {/* Profile */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Profile</h2>

        <label className={s.label}>Username</label>
        <input
          className={s.input}
          value={username}
          onChange={e => { setUsername(e.target.value); setProfileMsg(''); setProfileErr(''); }}
        />

        <label className={s.label}>Email</label>
        <input
          className={s.input}
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setProfileMsg(''); setProfileErr(''); }}
        />

        {profileErr && <div className={s.error}>{profileErr}</div>}
        {profileMsg && <div className={s.success}>{profileMsg}</div>}

        <button className={s.btn} onClick={saveProfile} disabled={profileBusy}>
          {profileBusy ? 'Saving…' : 'Save Profile'}
        </button>
      </div>

      {/* Password */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>Change Password</h2>

        <label className={s.label}>Current Password</label>
        <input
          className={s.input}
          type="password"
          placeholder="Enter current password"
          value={currentPw}
          onChange={e => { setCurrentPw(e.target.value); setPwMsg(''); setPwErr(''); }}
        />

        <label className={s.label}>New Password</label>
        <input
          className={s.input}
          type="password"
          placeholder="At least 6 characters"
          value={newPw}
          onChange={e => { setNewPw(e.target.value); setPwMsg(''); setPwErr(''); }}
        />

        <label className={s.label}>Confirm New Password</label>
        <input
          className={s.input}
          type="password"
          placeholder="Repeat new password"
          value={confirmPw}
          onChange={e => { setConfirmPw(e.target.value); setPwMsg(''); setPwErr(''); }}
        />

        {pwErr && <div className={s.error}>{pwErr}</div>}
        {pwMsg && <div className={s.success}>{pwMsg}</div>}

        <button className={s.btn} onClick={changePassword} disabled={pwBusy}>
          {pwBusy ? 'Updating…' : 'Change Password'}
        </button>
      </div>
    </div>
  );
}
