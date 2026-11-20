import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { LogoMark } from '../components/Brand.jsx';

export default function AuthPage({ mode }) {
  const isLogin = mode === 'login';
  const { setUser, notice, setNotice } = useAuth();
  const [form, setForm] = useState({ identifier: '', email: '', username: '', displayName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { identifier, password, email, username, displayName } = form;
      const d = isLogin
        ? await api('/auth/login', { method: 'POST', body: { identifier, password } })
        : await api('/auth/register', { method: 'POST', body: { email, username, displayName, password } });
      setUser(d.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-intro">
        <h1><LogoMark size={44} /> Chatly</h1>
        <p>Nhắn tin, gửi ảnh, gọi thoại và gọi video ngay trên trình duyệt, không cần cài đặt.</p>
      </section>
      <form className="auth-card form" onSubmit={submit}>
        <h2>{isLogin ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
        {notice && <p className="alert">{notice}</p>}
        {error && <p className="alert">{error}</p>}
        {isLogin ? (
          <label>Email hoặc tên đăng nhập<input autoFocus autoComplete="username" required {...field('identifier')} /></label>
        ) : (
          <>
            <label>Tên hiển thị<input autoFocus required maxLength={60} {...field('displayName')} /></label>
            <label>Tên đăng nhập<input autoComplete="username" required {...field('username')} /></label>
            <label>Email<input type="email" autoComplete="email" required {...field('email')} /></label>
          </>
        )}
        <label>
          Mật khẩu
          <input type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required {...field('password')} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? 'Đang xử lý…' : isLogin ? 'Đăng nhập' : 'Đăng ký'}</button>
        <p className="muted center">
          {isLogin ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
          <Link to={isLogin ? '/register' : '/login'}>{isLogin ? 'Đăng ký' : 'Đăng nhập'}</Link>
        </p>
      </form>
    </main>
  );
}
