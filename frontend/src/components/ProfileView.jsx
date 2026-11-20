import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Avatar from './Avatar.jsx';

const TABS = [['profile', 'Thông tin'], ['account', 'Tài khoản'], ['password', 'Mật khẩu']];

// Moi form co trang thai rieng: dang gui, thong bao thanh cong/loi.
function useSubmit() {
  const [state, setState] = useState({ busy: false, msg: null });
  const run = async (e, fn, success) => {
    e.preventDefault();
    setState({ busy: true, msg: null });
    try {
      await fn();
      setState({ busy: false, msg: { ok: true, text: success } });
    } catch (err) {
      setState({ busy: false, msg: { ok: false, text: err.message } });
    }
  };
  const fail = (text) => setState({ busy: false, msg: { ok: false, text } });
  return { ...state, run, fail };
}

const Status = ({ msg }) => msg && <p className={msg.ok ? 'alert ok' : 'alert'} role="status">{msg.text}</p>;

export default function ProfileView({ onBack }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('profile');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api('/users/me').then((d) => setStats(d.stats)).catch(() => {});
  }, []);

  return (
    <main className="profile-view">
      <header className="pv-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Quay lại tin nhắn">←</button>
        <h2>Hồ sơ của tôi</h2>
      </header>
      <div className="pv-body">
        <section className="pv-card" aria-label="Thông tin của tôi">
          <div className="pv-cover" />
          <Avatar name={user.displayName} size={104} />
          <h3>{user.displayName}</h3>
          <p className="muted">@{user.username}</p>
          {user.bio ? <p className="peer-bio">{user.bio}</p> : <p className="hint">Chưa có lời giới thiệu</p>}
          <dl className="pv-info">
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Ngày tham gia</dt><dd>{new Date(user.createdAt).toLocaleDateString('vi-VN')}</dd></div>
          </dl>
          <dl className="stat-row">
            <div><dt>Hội thoại</dt><dd>{stats?.conversations ?? '–'}</dd></div>
            <div><dt>Tin đã gửi</dt><dd>{stats?.messages ?? '–'}</dd></div>
            <div><dt>Cuộc gọi</dt><dd>{stats?.calls ?? '–'}</dd></div>
          </dl>
        </section>

        <section className="pv-settings">
          <div className="tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'account' && <AccountTab />}
          {tab === 'password' && <PasswordTab />}
        </section>
      </div>
    </main>
  );
}

function ProfileTab() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const form = useSubmit();

  const save = (e) => form.run(e, async () => {
    const d = await api('/users/me', { method: 'PATCH', body: { displayName, bio } });
    setUser(d.user);
  }, 'Đã lưu hồ sơ');

  return (
    <form className="form" onSubmit={save}>
      <Status msg={form.msg} />
      <label>Tên hiển thị<input value={displayName} maxLength={60} required onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label>
        Giới thiệu
        <textarea rows={3} value={bio} maxLength={200} onChange={(e) => setBio(e.target.value)} />
        <small className="hint">{bio.length}/200</small>
      </label>
      <button className="btn primary" disabled={form.busy}>Lưu hồ sơ</button>
    </form>
  );
}

function AccountTab() {
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const nameForm = useSubmit();
  const emailForm = useSubmit();

  const saveUsername = (e) => nameForm.run(e, async () => {
    const d = await api('/users/me/username', { method: 'PATCH', body: { username } });
    setUser(d.user);
  }, 'Đã đổi tên đăng nhập');

  const saveEmail = (e) => emailForm.run(e, async () => {
    const d = await api('/users/me/email', { method: 'PATCH', body: { email, currentPassword: password } });
    setUser(d.user);
    setEmail('');
    setPassword('');
  }, 'Đã đổi email. Các thiết bị khác đã được đăng xuất.');

  return (
    <>
      <form className="form" onSubmit={saveUsername}>
        <h3>Tên đăng nhập</h3>
        <Status msg={nameForm.msg} />
        <label>
          Tên đăng nhập mới
          <input value={username} autoComplete="username" required onChange={(e) => setUsername(e.target.value)} />
          <small className="hint">3-30 ký tự: chữ, số, dấu chấm hoặc gạch dưới. Dùng để đăng nhập và để người khác tìm bạn.</small>
        </label>
        <button className="btn primary" disabled={nameForm.busy || username.trim() === user.username}>Đổi tên đăng nhập</button>
      </form>
      <hr />
      <form className="form" onSubmit={saveEmail}>
        <h3>Email</h3>
        <Status msg={emailForm.msg} />
        <label>Email hiện tại<input value={user.email} disabled /></label>
        <label>Email mới<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn primary" disabled={emailForm.busy}>Đổi email</button>
      </form>
    </>
  );
}

function PasswordTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const form = useSubmit();
  const type = show ? 'text' : 'password';

  const save = (e) => {
    if (next !== confirm) {
      e.preventDefault();
      form.fail('Mật khẩu nhập lại không khớp');
      return;
    }
    form.run(e, async () => {
      await api('/users/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
    }, 'Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
  };

  return (
    <form className="form" onSubmit={save}>
      <Status msg={form.msg} />
      <label>Mật khẩu hiện tại<input type={type} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label>
        Mật khẩu mới
        <input type={type} autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} />
        <small className="hint">Ít nhất 8 ký tự.</small>
      </label>
      <label>Nhập lại mật khẩu mới<input type={type} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Hiện mật khẩu</label>
      <button className="btn primary" disabled={form.busy}>Đổi mật khẩu</button>
    </form>
  );
}
