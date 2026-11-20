// Bao hieu cho cuoc goi WebRTC 1-1. Am thanh/hinh anh di thang giua hai trinh duyet;
// server chi chuyen tiep SDP/ICE va ghi lai lich su cuoc goi.
import { randomUUID } from 'node:crypto';
import { query, tx } from './db.js';
import { emitToUser, isOnline } from './realtime.js';
import { fetchMessage, insertMessage, publishMessage, requireMember } from './services/conversations.js';

const RING_TIMEOUT_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const calls = new Map();
const activeCallOf = new Map();

async function finish(call, status) {
  if (call.finished) return;
  call.finished = true;
  clearTimeout(call.timer);
  calls.delete(call.id);
  for (const userId of [call.callerId, call.calleeId]) {
    if (activeCallOf.get(userId) === call.id) activeCallOf.delete(userId);
  }
  const finalStatus = call.answeredAt ? 'ended' : status;
  emitToUser(call.callerId, 'call:ended', { callId: call.id, status: finalStatus });
  emitToUser(call.calleeId, 'call:ended', { callId: call.id, status: finalStatus });
  try {
    const { id } = await tx(async (c) => {
      await c.query('UPDATE calls SET status = $2, ended_at = now() WHERE id = $1', [call.id, finalStatus]);
      return insertMessage(c, {
        conversationId: call.conversationId,
        senderId: call.callerId,
        clientMessageId: randomUUID(),
        content: '',
        type: 'call',
        callId: call.id,
      });
    });
    await publishMessage(await fetchMessage(id), call.calleeId);
  } catch (err) {
    console.error(err);
  }
}

export function registerCallHandlers(io, socket) {
  const me = socket.data.user;
  const reply = (ack, data) => typeof ack === 'function' && ack(data);

  socket.on('call:start', async (payload, ack) => {
    try {
      const conversationId = payload?.conversationId;
      const type = payload?.type === 'video' ? 'video' : 'audio';
      if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) {
        return reply(ack, { error: 'Hội thoại không hợp lệ' });
      }
      const member = await requireMember(conversationId, me.id).catch(() => null);
      if (!member) return reply(ack, { error: 'Không tìm thấy hội thoại' });
      if (member.peer_status === 'locked') return reply(ack, { error: 'Người này đã bị khóa tài khoản' });
      if (activeCallOf.has(me.id)) return reply(ack, { error: 'Bạn đang trong một cuộc gọi khác' });

      const { rows } = await query(
        'INSERT INTO calls(conversation_id, caller_id, callee_id, type) VALUES ($1, $2, $3, $4) RETURNING id',
        [conversationId, me.id, member.peer_id, type],
      );
      const call = { id: rows[0].id, conversationId, callerId: me.id, calleeId: member.peer_id, type, callerSocket: socket.id };

      // Kiem tra lai sau await: hai lenh goi gui cung luc chi mot lenh duoc chap nhan.
      if (activeCallOf.has(me.id)) {
        await finish(call, 'cancelled');
        return reply(ack, { error: 'Bạn đang trong một cuộc gọi khác' });
      }
      if (activeCallOf.has(call.calleeId)) {
        await finish(call, 'busy');
        return reply(ack, { error: 'Người nhận đang trong cuộc gọi khác' });
      }
      if (!isOnline(call.calleeId)) {
        await finish(call, 'missed');
        return reply(ack, { error: 'Người nhận hiện không trực tuyến' });
      }

      calls.set(call.id, call);
      activeCallOf.set(me.id, call.id);
      activeCallOf.set(call.calleeId, call.id);
      call.timer = setTimeout(() => finish(call, 'missed'), RING_TIMEOUT_MS);
      emitToUser(call.calleeId, 'call:incoming', {
        callId: call.id,
        conversationId,
        type,
        from: { id: me.id, displayName: me.display_name },
      });
      reply(ack, { callId: call.id });
    } catch (err) {
      console.error(err);
      reply(ack, { error: 'Không thể bắt đầu cuộc gọi' });
    }
  });

  socket.on('call:accept', (payload, ack) => {
    const call = calls.get(payload?.callId);
    if (!call || call.calleeId !== me.id || call.calleeSocket) return reply(ack, { error: 'Cuộc gọi đã kết thúc' });
    clearTimeout(call.timer);
    call.calleeSocket = socket.id;
    call.answeredAt = new Date();
    io.to(call.callerSocket).emit('call:accepted', { callId: call.id });
    // Cac tab khac cua nguoi nhan ngung do chuong.
    socket.to(`user:${me.id}`).emit('call:handled', { callId: call.id });
    reply(ack, { ok: true });
    query(`UPDATE calls SET status = 'accepted', answered_at = now() WHERE id = $1`, [call.id]).catch(console.error);
  });

  socket.on('call:reject', (payload) => {
    const call = calls.get(payload?.callId);
    if (call && call.calleeId === me.id && !call.calleeSocket) finish(call, 'rejected');
  });

  socket.on('call:end', (payload) => {
    const call = calls.get(payload?.callId);
    if (!call || (call.callerId !== me.id && call.calleeId !== me.id)) return;
    finish(call, me.id === call.callerId ? 'cancelled' : 'rejected');
  });

  // Chi chuyen tiep giua hai socket dang tham gia cuoc goi.
  socket.on('call:signal', (payload) => {
    const call = calls.get(payload?.callId);
    if (!call?.calleeSocket || payload.data == null) return;
    const target = socket.id === call.callerSocket ? call.calleeSocket
      : socket.id === call.calleeSocket ? call.callerSocket : null;
    if (target) io.to(target).emit('call:signal', { callId: call.id, data: payload.data });
  });

  socket.on('disconnect', () => {
    for (const call of calls.values()) {
      if (call.callerSocket === socket.id || call.calleeSocket === socket.id) finish(call, 'cancelled');
    }
  });
}
