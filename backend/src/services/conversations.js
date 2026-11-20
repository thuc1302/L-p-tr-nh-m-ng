import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { emitToUser, isOnline, markDelivered } from '../realtime.js';

export const directKey = (a, b) => [a, b].sort().join(':');

// Tra 404 thay vi 403 de nguoi ngoai khong biet hoi thoai co ton tai.
export async function requireMember(conversationId, userId) {
  const { rows } = await query(
    `SELECT me.last_read_message_id, peer.user_id AS peer_id, u.status AS peer_status
     FROM conversation_members me
     JOIN conversation_members peer
       ON peer.conversation_id = me.conversation_id AND peer.user_id <> me.user_id
     JOIN users u ON u.id = peer.user_id
     WHERE me.conversation_id = $1 AND me.user_id = $2`,
    [conversationId, userId],
  );
  if (!rows[0]) throw new HttpError(404, 'Không tìm thấy hội thoại');
  return rows[0];
}

// Tin nhan kem anh dinh kem va thong tin cuoc goi (neu co).
export const MESSAGE_SQL = `
  SELECT m.*, a.id AS attachment_id,
         cl.type AS call_type, cl.status AS call_status,
         EXTRACT(EPOCH FROM cl.ended_at - cl.answered_at)::int AS call_duration
  FROM messages m
  LEFT JOIN attachments a ON a.message_id = m.id
  LEFT JOIN calls cl ON cl.id = m.call_id`;

export function toMessage(m) {
  const deleted = Boolean(m.deleted_at);
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    clientMessageId: m.client_message_id,
    type: m.type,
    content: deleted ? null : m.content,
    createdAt: m.created_at,
    deleted,
    image: m.attachment_id && !deleted ? { url: `/api/attachments/${m.attachment_id}` } : null,
    call: m.call_type ? { type: m.call_type, status: m.call_status, duration: m.call_duration ?? 0 } : null,
  };
}

// Goi trong transaction. Gui lai cung clientMessageId thi tra ve tin cu, khong tao them.
export async function insertMessage(c, { conversationId, senderId, clientMessageId, content, type = 'text', callId = null }) {
  const inserted = await c.query(
    `INSERT INTO messages(conversation_id, sender_id, client_message_id, content, type, call_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sender_id, client_message_id) DO NOTHING RETURNING id, created_at`,
    [conversationId, senderId, clientMessageId, content, type, callId],
  );
  const row = inserted.rows[0];
  if (!row) {
    const existing = await c.query(
      `SELECT id FROM messages WHERE sender_id = $1 AND client_message_id = $2 AND conversation_id = $3`,
      [senderId, clientMessageId, conversationId],
    );
    if (!existing.rows[0]) throw new HttpError(409, 'Mã tin nhắn đã được sử dụng');
    return { id: existing.rows[0].id, created: false };
  }
  await c.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [conversationId, row.created_at]);
  await c.query('UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1', [conversationId]);
  await c.query(
    `UPDATE conversation_members
     SET last_read_message_id = GREATEST(last_read_message_id, $3),
         last_delivered_message_id = GREATEST(last_delivered_message_id, $3)
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, senderId, row.id],
  );
  return { id: row.id, created: true };
}

export async function fetchMessage(id) {
  const { rows } = await query(`${MESSAGE_SQL} WHERE m.id = $1`, [id]);
  return rows[0];
}

export async function publishMessage(row, peerId) {
  const payload = toMessage(row);
  emitToUser(row.sender_id, 'message:new', payload);
  emitToUser(peerId, 'message:new', payload);
  if (isOnline(peerId)) await markDelivered(peerId, row.conversation_id);
  return payload;
}
