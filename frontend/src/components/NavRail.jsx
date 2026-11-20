import { useState } from 'react';
import Avatar from './Avatar.jsx';
import { LogoMark } from './Brand.jsx';
import { ChatIcon, ChevronIcon, LogoutIcon, PanelIcon, SettingsIcon, UserIcon, UserSearchIcon } from './Icons.jsx';

export const FILTERS = [['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['online', 'Đang trực tuyến']];

const TIPS = [
  ['Gọi video', 'Mở một cuộc trò chuyện và bấm biểu tượng camera ở góc trên.'],
  ['Gửi ảnh nhanh', 'Dán ảnh bằng Ctrl+V ngay trong ô nhập tin nhắn.'],
  ['Thu hồi tin nhắn', 'Rê chuột lên tin của bạn và chọn "Thu hồi".'],
];

export default function NavRail({
  user, connected, collapsed, onToggle, view, onView, filter, onFilter, counts, onProfile, onSettings, onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const subOpen = menuOpen && view === 'chats' && !collapsed;

  function openChats() {
    if (view === 'chats') setMenuOpen((o) => !o);
    else {
      onView('chats');
      setMenuOpen(true);
    }
  }

  return (
    <nav className={`rail ${collapsed ? 'collapsed' : ''}`} aria-label="Điều hướng chính">
      <div className="rail-top">
        <span className="brand"><LogoMark /><span className="brand-text">CHATLY</span></span>
        <button className="rail-toggle" onClick={onToggle} title={collapsed ? 'Mở rộng' : 'Thu gọn'} aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}>
          <PanelIcon />
        </button>
      </div>

      <button className={`rail-profile ${view === 'profile' ? 'active' : ''}`} onClick={onProfile} title="Hồ sơ của tôi">
        <Avatar name={user.displayName} online={connected} size={collapsed ? 40 : 46} />
        <span className="rail-profile-text">
          <b>{user.displayName}</b>
          <small>@{user.username}</small>
        </span>
      </button>

      <div className="rail-label">Menu</div>
      <ul className="rail-menu">
        <li>
          <button className={`rail-item ${view === 'chats' ? 'active' : ''}`} onClick={openChats} aria-expanded={subOpen} title="Tin nhắn">
            <ChatIcon />
            <span className="rail-text">Tin nhắn</span>
            {counts.unread > 0 && <em className="rail-badge">{counts.unread > 99 ? '99+' : counts.unread}</em>}
            <span className="chev"><ChevronIcon /></span>
          </button>
          {subOpen && (
            <ul className="rail-sub">
              {FILTERS.map(([id, label]) => (
                <li key={id}>
                  <button className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => onFilter(id)}>
                    <span>{label}</span>
                    <small>{counts[id]}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>
          <button className={`rail-item ${view === 'people' ? 'active' : ''}`} onClick={() => onView('people')} title="Tìm người">
            <UserSearchIcon />
            <span className="rail-text">Tìm người</span>
          </button>
        </li>
        <li>
          <button className={`rail-item ${view === 'profile' ? 'active' : ''}`} onClick={onProfile} title="Hồ sơ">
            <UserIcon />
            <span className="rail-text">Hồ sơ</span>
          </button>
        </li>
      </ul>

      <div className="rail-spacer" />

      <div className="rail-card">
        <div className="rail-card-text">
          <small>MẸO</small>
          <b>{tip[0]}</b>
          <p>{tip[1]}</p>
        </div>
      </div>

      <div className="rail-bottom">
        <button className="rail-item" onClick={onSettings} title="Cài đặt">
          <SettingsIcon />
          <span className="rail-text">Cài đặt</span>
        </button>
        <button className="rail-item logout" onClick={onLogout} title="Đăng xuất">
          <LogoutIcon />
          <span className="rail-text">Đăng xuất</span>
        </button>
      </div>
    </nav>
  );
}
