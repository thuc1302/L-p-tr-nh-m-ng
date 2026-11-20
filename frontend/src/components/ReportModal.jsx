import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

export default function ReportModal({ conversation, message, onClose }) {
  const [reason, setReason] = useState('spam');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/reports', {
        method: 'POST',
        body: { conversationId: conversation.id, messageId: message?.id, reason, description },
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={`Báo cáo ${conversation.peer.displayName}`} onClose={onClose}>
      {done ? (
        <>
          <p className="alert ok">Đã gửi báo cáo. Quản trị viên sẽ xem xét.</p>
          <button className="btn" onClick={onClose}>Đóng</button>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          {error && <p className="alert">{error}</p>}
          {message && <blockquote>{message.content}</blockquote>}
          <label>
            Lý do
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="spam">Tin rác</option>
              <option value="harassment">Quấy rối</option>
              <option value="scam">Lừa đảo</option>
              <option value="other">Khác</option>
            </select>
          </label>
          <label>Mô tả thêm<textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <button className="btn danger">Gửi báo cáo</button>
        </form>
      )}
    </Modal>
  );
}
