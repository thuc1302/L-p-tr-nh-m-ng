import { Server } from 'socket.io';
import { userFromCookieHeader } from './auth.js';
import { registerCallHandlers } from './calls.js';
import { query } from './db.js';

let io;
const userRoom = (id) => `user:${id}`;

export const isOnline = (userId) => (io?.sockets.adapter.rooms.get(userRoom(userId))?.size ?? 0) > 0;
export const emitToUser = (userId, event, payload) => io?.to(userRoom(userId)).emit(event, payload);
export const disconnectUser = (userId) => io?.in(userRoom(userId)).disconnectSockets(true);
export const disconnectSession = (sessionId) => io?.in(`session:${sessionId}`).disconnectSockets(true);
export const onlineCount = () =>
  [...(io?.sockets.adapter.rooms.keys() ?? [])].filter((r) => r.startsWith('user:')).length;

// Gui cho chinh nguoi do (cac tab khac) va moi nguoi dang co hoi thoai voi ho.
export async function notifyPeers(userId, event, payload) {
  const peers = await peersOf(userId);
  for (const id of new Set([userId, ...peers.map((p) => p.user_id)])) emitToUser(id, event, payload);
}

async function peersOf(userId) {
  const { rows } = await query(
    `SELECT peer.conversation_id, peer.user_id
     FROM conversation_members me
     JOIN conversation_members peer
       ON peer.conversation_id = me.conversation_id AND peer.user_id <> me.user_id
     WHERE me.user_id = $1`,
    [userId],
  );
  return rows;
}

// Khi nguoi nhan co mat, moi tin dang cho chuyen sang "da nhan" va bao cho nguoi gui.
export async function markDelivered(userId, conversationId = null) {
  const { rows } = await query(
    `UPDATE conversation_members me
     SET last_delivered_message_id = latest.id
     FROM (
       SELECT m.conversation_id, max(m.id) AS id
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
       WHERE ($2::uuid IS NULL OR m.conversation_id = $2)
       GROUP BY m.conversation_id
     ) latest
     WHERE me.user_id = $1 AND me.conversation_id = latest.conversation_id
       AND me.last_delivered_message_id < latest.id
     RETURNING me.conversation_id, me.last_delivered_message_id, me.last_read_message_id`,
    [userId, conversationId],
  );
  if (!rows.length) return;
  const peers = await peersOf(userId);
  for (const r of rows) {
    const peer = peers.find((p) => p.conversation_id === r.conversation_id);
    if (peer) {
      emitToUser(peer.user_id, 'message:status', {
        conversationId: r.conversation_id,
        lastDeliveredMessageId: r.last_delivered_message_id,
        lastReadMessageId: r.last_read_message_id,
      });
    }
  }
}

async function broadcastPresence(userId, online) {
  const lastSeenAt = new Date().toISOString();
  if (!online) await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
  const peers = await peersOf(userId);
  for (const id of new Set(peers.map((p) => p.user_id))) {
    emitToUser(id, 'presence', { userId, online, lastSeenAt });
  }
}

export function initRealtime(server) {
  io = new Server(server, {
    serveClient: false,
    // Socket.IO khong tu chan origin cua WebSocket nen phai kiem tra o day.
    allowRequest(req, done) {
      const { origin, host } = req.headers;
      done(null, !origin || new URL(origin).host === host);
    },
  });

  io.use(async (socket, next) => {
    try {
      const user = await userFromCookieHeader(socket.handshake.headers.cookie);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', async (socket) => {
    const { id: userId, session_id: sessionId } = socket.data.user;
    const wasOnline = isOnline(userId);
    socket.join([userRoom(userId), `session:${sessionId}`]);
    registerCallHandlers(io, socket);

    socket.on('typing', async (payload) => {
      try {
        const conversationId = payload?.conversationId;
        if (typeof conversationId !== 'string') return;
        const peers = await peersOf(userId);
        const peer = peers.find((p) => p.conversation_id === conversationId);
        if (peer) emitToUser(peer.user_id, 'typing', { conversationId, userId });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('disconnect', () => {
      if (!isOnline(userId)) broadcastPresence(userId, false).catch(console.error);
    });

    try {
      if (!wasOnline) await broadcastPresence(userId, true);
      await markDelivered(userId);
    } catch (err) {
      console.error(err);
    }
  });
  return io;
}
