import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import Backdrop from './components/Backdrop.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import './styles.css';
import { applyTheme, getTheme } from './theme.js';

applyTheme(getTheme());

const home = (user) => (user.role === 'admin' ? '/admin' : '/');

function Guard({ role, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="splash">Đang tải…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={home(user)} replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="splash">Đang tải…</div>;
  if (user) return <Navigate to={home(user)} replace />;
  return children;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Backdrop />
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><AuthPage mode="register" /></GuestOnly>} />
          <Route path="/admin" element={<Guard role="admin"><AdminPage /></Guard>} />
          <Route path="/" element={<Guard role="user"><ChatPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
