import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { applyTheme, getTheme } from '../theme.js';
import Modal from './Modal.jsx';

const OPTIONS = [
  ['system', 'Theo hệ thống', 'Tự đổi theo máy'],
  ['light', 'Sáng', 'Nền sáng, kính trắng'],
  ['dark', 'Tối', 'Nền tối, kính khói'],
];

export default function SettingsModal({ onClose }) {
  const [theme, setTheme] = useState(getTheme);
  return (
    <Modal title="Cài đặt" onClose={onClose}>
      <div className="form">
        <h3>Giao diện</h3>
        <div className="theme-options" role="radiogroup" aria-label="Giao diện">
          {OPTIONS.map(([id, label, desc]) => (
            <button
              key={id}
              role="radio"
              aria-checked={theme === id}
              className={`theme-opt ${theme === id ? 'active' : ''}`}
              onClick={() => {
                setTheme(id);
                applyTheme(id);
              }}
            >
              <span className={`theme-swatch ${id}`} />
              <b>{label}</b>
              <small>{desc}</small>
            </button>
          ))}
        </div>
        <p className="hint">Lựa chọn được lưu trên trình duyệt này.</p>
        <hr />
        <h3>Truy cập từ máy khác</h3>
        <LanAddress />
      </div>
    </Modal>
  );
}

function LanAddress() {
  const [lan, setLan] = useState(null);
  const [copied, setCopied] = useState(false);

  // Hoi lai dinh ky: doi Wi-Fi thi dia chi tren man hinh cung doi theo.
  useEffect(() => {
    const load = () => api('/system/lan').then(setLan).catch(() => setLan({ url: null }));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lan.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Trinh duyet chan clipboard (HTTP tren may khac): nguoi dung tu chon va chep.
    }
  }

  if (!lan) return <p className="muted">Đang lấy địa chỉ…</p>;
  if (!lan.url) return <p className="muted">Máy chủ chưa kết nối mạng LAN.</p>;
  return (
    <>
      <div className="lan-box">
        <code>{lan.url}</code>
        <button className="btn small" onClick={copy}>{copied ? 'Đã chép' : 'Sao chép'}</button>
      </div>
      <p className="hint">
        Máy khác cùng Wi-Fi mở địa chỉ này. Khi đổi Wi-Fi, địa chỉ tự cập nhật trong vài giây.
        Lần đầu truy cập, chọn Nâng cao → Tiếp tục để bỏ qua cảnh báo chứng chỉ.
      </p>
    </>
  );
}
