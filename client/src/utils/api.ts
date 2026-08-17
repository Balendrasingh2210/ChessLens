/**
 * api.ts — shared Axios instance for all backend requests
 *
 * Configuration:
 *   baseURL  — /api in production (Nginx proxies to Express); full URL when
 *              VITE_API_URL is set (dev cross-origin or direct backend URL)
 *   timeout  — 60 seconds (game import can take a while fetching from external APIs)
 *
 * Request interceptor: injects `Authorization: Bearer <token>` from localStorage.
 *
 * Response interceptor: on 401, clears the stored token and redirects to /login.
 * This handles expired JWTs without requiring per-component error handling.
 */

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  withCredentials: true,
  timeout: 60000, // 60s — import can take a moment fetching from chess.com/lichess
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cl_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cl_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
