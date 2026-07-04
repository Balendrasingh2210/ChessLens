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
    const { data } = await api.post('/auth/register', { username, email, password });
    localStorage.setItem('cl_token', data.token);
    set({ token: data.token, user: data.user });
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
