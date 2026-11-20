const sameDay = (a, b) => a.toDateString() === b.toDateString();

export function timeOf(value) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(value) {
  const d = new Date(value);
  const now = new Date();
  if (sameDay(d, now)) return 'Hôm nay';
  if (sameDay(d, new Date(now.getTime() - 86400000))) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN');
}

export function shortTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return sameDay(d, new Date()) ? timeOf(d) : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export function lastSeen(value) {
  if (!value) return 'Ngoại tuyến';
  const mins = Math.floor((Date.now() - new Date(value)) / 60000);
  if (mins < 1) return 'Vừa truy cập';
  if (mins < 60) return `Truy cập ${mins} phút trước`;
  if (mins < 1440) return `Truy cập ${Math.floor(mins / 60)} giờ trước`;
  return `Truy cập ngày ${new Date(value).toLocaleDateString('vi-VN')}`;
}

export const dateTime = (value) => (value ? new Date(value).toLocaleString('vi-VN') : '—');

export function duration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function callLabel(call, mine) {
  const kind = call.type === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
  switch (call.status) {
    case 'ended': return call.duration ? `${kind} · ${duration(call.duration)}` : kind;
    case 'rejected': return mine ? `${kind} bị từ chối` : `Bạn đã từ chối ${kind.toLowerCase()}`;
    case 'busy': return mine ? `${kind} · Người nhận đang bận` : `${kind} nhỡ`;
    case 'cancelled': return mine ? `${kind} · Đã hủy` : `${kind} nhỡ`;
    default: return mine ? `${kind} · Không trả lời` : `${kind} nhỡ`;
  }
}
