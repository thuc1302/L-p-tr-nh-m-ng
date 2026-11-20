import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import { LogoMark } from '../components/Brand.jsx';
import { dateTime } from '../format.js';

const REASONS = { spam: 'Tin rác', harassment: 'Quấy rối', scam: 'Lừa đảo', other: 'Khác' };
const ACTIONS = { 'user.lock': 'Khóa tài khoản', 'user.unlock': 'Mở khóa tài khoản', 'report.resolve': 'Xử lý báo cáo' };
const REPORT_STATUS = { open: 'Chờ xử lý', resolved: 'Đã xử lý', dismissed: 'Đã bỏ qua' };
const TABS = [['overview', 'Tổng quan'], ['users', 'Người dùng'], ['reports', 'Báo cáo'], ['logs', 'Nhật ký']];

function useLoad(fn) {
  const [state, setState] = useState({ data: null, error: '' });
  const reload = useCallback(() => {
    fn().then((data) => setState({ data, error: '' })).catch((err) => setState((s) => ({ ...s, error: err.message })));
  }, [fn]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('overview');
  return (
    <div className="admin">
      <aside className="admin-nav">
        <h1><LogoMark size={30} /> <span>Chatly<small>Quản trị</small></span></h1>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="admin-user">
          <small>{user.displayName}</small>
          <button className="btn small" onClick={logout}>Đăng xuất</button>
        </div>
      </aside>
      <main className="admin-main">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users />}
        {tab === 'reports' && <Reports />}
        {tab === 'logs' && <Logs />}
      </main>
    </div>
  );
}

const loadOverview = async () => {
  const [stats, { activity }] = await Promise.all([api('/admin/stats'), api('/admin/stats/activity?days=14')]);
  return { stats, activity };
};

function Overview() {
  const { data, error } = useLoad(loadOverview);
  if (error) return <p className="alert">{error}</p>;
  if (!data) return <p className="muted">Đang tải…</p>;
  const { stats: s, activity } = data;
  const tiles = [
    ['Người dùng', s.users], ['Đang trực tuyến', s.onlineUsers], ['Đã khóa', s.lockedUsers],
    ['Hội thoại', s.conversations], ['Tin nhắn', s.messages], ['Tin nhắn hôm nay', s.messagesToday], ['Cuộc gọi', s.calls],
    ['Báo cáo chờ xử lý', s.openReports],
  ];
  const max = Math.max(1, ...activity.map((a) => a.messages));
  return (
    <>
      <h2>Tổng quan</h2>
      <div className="tiles">
        {tiles.map(([label, value]) => <div className="tile" key={label}><small>{label}</small><b>{value.toLocaleString('vi-VN')}</b></div>)}
      </div>
      <section className="card">
        <h3>Tin nhắn 14 ngày gần đây</h3>
        <div className="bars">
          {activity.map((a) => (
            <div className="bar" key={a.day} title={`${a.day}: ${a.messages} tin nhắn, ${a.newUsers} người dùng mới`}>
              <span className="bar-value">{a.messages || ''}</span>
              <i style={{ height: `${(a.messages / max) * 100}%` }} />
              <small>{a.day.slice(8)}/{a.day.slice(5, 7)}</small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [locking, setLocking] = useState(null);
  const [detail, setDetail] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setTerm(q); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const fetchUsers = useCallback(
    () => api(`/admin/users?q=${encodeURIComponent(term)}&status=${status}&page=${page}`),
    [term, status, page],
  );
  const { data, error, reload } = useLoad(fetchUsers);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function unlock(u) {
    setActionError('');
    try {
      await api(`/admin/users/${u.id}/unlock`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <>
      <h2>Người dùng</h2>
      <div className="toolbar">
        <input type="search" placeholder="Tìm theo tên, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">Tất cả</option>
          <option value="active">Đang hoạt động</option>
          <option value="locked">Đã khóa</option>
        </select>
      </div>
      {(error || actionError) && <p className="alert">{error || actionError}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Người dùng</th><th>Email</th><th>Tin nhắn</th><th>Bị báo cáo</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td><button className="link" onClick={() => setDetail(u)}>{u.displayName}</button><br /><small>@{u.username}</small></td>
                <td>{u.email}</td>
                <td>{u.messageCount}</td>
                <td>{u.reportCount}</td>
                <td><span className={`pill ${u.status}`}>{u.status === 'locked' ? 'Đã khóa' : u.online ? 'Trực tuyến' : 'Hoạt động'}</span></td>
                <td className="right">
                  {u.status === 'locked'
                    ? <button className="btn small" onClick={() => unlock(u)}>Mở khóa</button>
                    : <button className="btn small danger" onClick={() => setLocking(u)}>Khóa</button>}
                </td>
              </tr>
            ))}
            {data?.users.length === 0 && <tr><td colSpan={6} className="empty">Không có người dùng phù hợp</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
        <span>Trang {page}/{pages}</span>
        <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
      </div>
      {locking && <LockModal user={locking} onClose={() => setLocking(null)} onDone={() => { setLocking(null); reload(); }} />}
      {detail && (
        <Modal title={detail.displayName} onClose={() => setDetail(null)}>
          <dl className="details">
            <dt>Tên đăng nhập</dt><dd>@{detail.username}</dd>
            <dt>Email</dt><dd>{detail.email}</dd>
            <dt>Ngày tạo</dt><dd>{dateTime(detail.createdAt)}</dd>
            <dt>Truy cập gần nhất</dt><dd>{detail.online ? 'Đang trực tuyến' : dateTime(detail.lastSeenAt)}</dd>
            <dt>Hội thoại</dt><dd>{detail.conversationCount}</dd>
            <dt>Tin nhắn đã gửi</dt><dd>{detail.messageCount}</dd>
            <dt>Số lần bị báo cáo</dt><dd>{detail.reportCount}</dd>
            {detail.lockedReason && <><dt>Lý do khóa</dt><dd>{detail.lockedReason}</dd></>}
          </dl>
        </Modal>
      )}
    </>
  );
}

function LockModal({ user, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      await api(`/admin/users/${user.id}/lock`, { method: 'POST', body: { reason } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal title={`Khóa ${user.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {error && <p className="alert">{error}</p>}
        <p className="muted">Người dùng sẽ bị đăng xuất ngay trên mọi thiết bị.</p>
        <label>Lý do<textarea rows={3} required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="btn danger">Khóa tài khoản</button>
      </form>
    </Modal>
  );
}

function Reports() {
  const [status, setStatus] = useState('open');
  const [resolving, setResolving] = useState(null);
  const fetchReports = useCallback(() => api(`/admin/reports?status=${status}`), [status]);
  const { data, error, reload } = useLoad(fetchReports);
  return (
    <>
      <h2>Báo cáo vi phạm</h2>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Chờ xử lý</option>
          <option value="resolved">Đã xử lý</option>
          <option value="dismissed">Đã bỏ qua</option>
          <option value="all">Tất cả</option>
        </select>
      </div>
      {error && <p className="alert">{error}</p>}
      {data?.reports.length === 0 && <p className="muted">Không có báo cáo nào.</p>}
      {data?.reports.map((r) => (
        <article className="card report" key={r.id}>
          <header>
            <b>{REASONS[r.reason]}</b>
            <span className={`pill ${r.status}`}>{REPORT_STATUS[r.status]}</span>
            <small>{dateTime(r.createdAt)}</small>
          </header>
          <p>@{r.reporter.username} báo cáo <b>@{r.reported.username}</b>{r.reported.status === 'locked' && ' (đã khóa)'}</p>
          {r.messageSnapshot && <blockquote>{r.messageSnapshot}</blockquote>}
          {r.description && <p className="muted">{r.description}</p>}
          {r.resolutionNote && <p className="muted">Ghi chú xử lý: {r.resolutionNote}</p>}
          {r.status === 'open' && <button className="btn small" onClick={() => setResolving(r)}>Xử lý</button>}
        </article>
      ))}
      {resolving && <ResolveModal report={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); reload(); }} />}
    </>
  );
}

function ResolveModal({ report, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [lockUser, setLockUser] = useState(false);
  const [error, setError] = useState('');
  async function resolve(status) {
    try {
      await api(`/admin/reports/${report.id}/resolve`, { method: 'POST', body: { status, note, lockUser: status === 'resolved' && lockUser } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal title="Xử lý báo cáo" onClose={onClose}>
      <div className="form">
        {error && <p className="alert">{error}</p>}
        <label>Ghi chú<textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={lockUser} onChange={(e) => setLockUser(e.target.checked)} /> Khóa tài khoản @{report.reported.username}</label>
        <div className="actions">
          <button className="btn primary" onClick={() => resolve('resolved')}>Xác nhận vi phạm</button>
          <button className="btn" onClick={() => resolve('dismissed')}>Bỏ qua</button>
        </div>
      </div>
    </Modal>
  );
}

const fetchLogs = () => api('/admin/audit-logs');

function Logs() {
  const { data, error } = useLoad(fetchLogs);
  return (
    <>
      <h2>Nhật ký quản trị</h2>
      {error && <p className="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Thời gian</th><th>Quản trị viên</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id}>
                <td>{dateTime(l.createdAt)}</td>
                <td>@{l.admin}</td>
                <td>{ACTIONS[l.action] ?? l.action}</td>
                <td>{l.target ? `@${l.target}` : '—'}</td>
                <td>{l.detail.reason ?? l.detail.note ?? ''}</td>
              </tr>
            ))}
            {data?.logs.length === 0 && <tr><td colSpan={5} className="empty">Chưa có nhật ký</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
