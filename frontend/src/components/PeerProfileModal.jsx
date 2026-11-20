import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { lastSeen } from '../format.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';

export default function PeerProfileModal({ userId, onClose }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/users/${userId}`).then((d) => setUser(d.user)).catch((err) => setError(err.message));
  }, [userId]);

  return (
    <Modal title="Thông tin người dùng" onClose={onClose}>
      {error && <p className="alert">{error}</p>}
      {!user && !error && <p className="muted">Đang tải…</p>}
      {user && (
        <div className="peer-profile">
          <Avatar name={user.displayName} size={88} online={user.online} />
          <h3>{user.displayName}</h3>
          <p className="muted">@{user.username}</p>
          <p className={user.locked ? 'fail' : 'muted'}>
            {user.locked ? 'Tài khoản đã bị khóa' : user.online ? 'Đang trực tuyến' : lastSeen(user.lastSeenAt)}
          </p>
          {user.bio && <p className="peer-bio">{user.bio}</p>}
          <dl className="details">
            <dt>Tham gia</dt><dd>{new Date(user.createdAt).toLocaleDateString('vi-VN')}</dd>
          </dl>
        </div>
      )}
    </Modal>
  );
}
