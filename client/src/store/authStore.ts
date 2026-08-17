/**
 * authStore.ts — global authentication state (Zustand)
 *
 * The single source of truth for the logged-in user and JWT token.
 * Token is persisted in localStorage under the key 'cl_token'.
 *
 * State:
 *   user     — full user object (username, email, connectedAccounts) or null
 *   token    — raw JWT string or null
 *   loading  — true until loadUser() resolves; used to avoid flash-of-redirect
 *
 * Actions:
 *   login()       — POST /auth/login → stores token, sets user
 *   register()    — POST /auth/register (no auto-login; user must verify email first)
 *   logout()      — clears localStorage and resets state
 *   loadUser()    — called once on app mount; validates stored token with GET /auth/me
 *   refreshUser() — silently re-fetches user (after profile update, etc.)
 *
 * Import from any component:
 *   const { user, token, login, logout } = useAuthStore();
 */

import { create } from 'zustand';
import api from '../utils/api';

interface ConnectedAccount {
  platform: 'chess.com' | 'lichess';
  username: string;
  lastSynced: string | null;
  gamesAnalyzed: number;
}

interface User {
  _id: string;
  username: string;
  email: string;
  connectedAccounts: ConnectedAccount[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('cl_token'),
  loading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('cl_token', data.token);
    set({ token: data.token, user: data.user });
  },

  register: async (username, email, password) => {
    await api.post('/auth/register', { username, email, password });
  },

  logout: () => {
    localStorage.removeItem('cl_token');
    set({ token: null, user: null });
  },

  loadUser: async () => {
    const token = localStorage.getItem('cl_token');
    if (!token) { set({ loading: false }); return; }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user, loading: false });
    } catch {
      localStorage.removeItem('cl_token');
      set({ token: null, user: null, loading: false });
    }
  },

  refreshUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data.user });
    } catch { /* ignore */ }
  },
}));
