import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ConnectAccount from './pages/ConnectAccount';
import Games from './pages/Games';
import GameReview from './pages/GameReview';
import Puzzles from './pages/Puzzles';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import ForgotPassword from './pages/ForgotPassword';
import VerifyEmail from './pages/VerifyEmail';
import ResetPassword from './pages/ResetPassword';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuthStore();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-sub)' }}>
      Loading...
    </div>
  );
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const { loadUser } = useAuthStore();
  useEffect(() => { loadUser(); }, [loadUser]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"           element={<Login />} />
        <Route path="/register"        element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-email"    element={<VerifyEmail />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/connect"        element={<ConnectAccount />} />
          <Route path="/games"          element={<Games />} />
          <Route path="/games/:id"      element={<GameReview />} />
          <Route path="/analysis"       element={<Analysis />} />
          <Route path="/puzzles"        element={<Puzzles />} />
          <Route path="/settings"       element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
