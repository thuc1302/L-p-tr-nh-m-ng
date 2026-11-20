import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { emitToUser, isOnline } from '../realtime.js';
import {
  directKey, fetchMessage, insertMessage, MESSAGE_SQL, publishMessage, requireMember, toMessage,
} from '../services/conversations.js';
import { detectImage, idParam, uuidParam } from '../validation.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

const LIST_SQL = `
  SELECT c.id, c.created_at, c.last_message_at,
         peer.last_delivered_message_id AS peer_delivered, peer.last_read_message_id AS peer_read,
         u.id AS peer_id, u.username, u.display_name, u.bio, u.status, u.last_seen_at, lm.*,
         (SELECT count(*) FROM messages m
          WHERE m.conversation_id = c.id AND m.id > me.last_read_message_id
            AND m.sender_id <> $1 AND m.deleted_at IS NULL) AS unread
  FROM conversation_members me
  JOIN conversations c ON c.id = me.conversation_id
  JOIN conversation_members peer ON peer.conversation_id = c.id AND peer.user_id <> me.user_id
  JOIN users u ON u.id = peer.user_id
  LEFT JOIN LATERAL (
    SELECT x.id AS lm_id, x.sender_id AS lm_sender, x.content AS lm_content, x.type AS lm_type,
           x.created_at AS lm_created, x.deleted_at AS lm_deleted,
           x.call_type AS lm_call_type, x.call_status AS lm_call_status, x.call_duration AS lm_call_duration
    FROM (${MESSAGE_SQL} WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) x
  ) lm ON true
  WHERE me.user_id = $1 AND me.hidden_at IS NULL`;

const toConversation = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  lastMessageAt: r.last_message_at,
  peerDeliveredId: r.peer_delivered,
  peerReadId: r.peer_read,
  unread: r.unread,
  peer: {
    id: r.peer_id,
    username: r.username,
    displayName: r.display_name,
    bio: r.bio,
    locked: r.status === 'locked',
    online: isOnline(r.peer_id),
    lastSeenAt: r.last_seen_at,
  },
  lastMessage: r.lm_id
    ? {
        id: r.lm_id,
        senderId: r.lm_sender,
        type: r.lm_type,
        content: r.lm_deleted ? null : r.lm_content,
        createdAt: r.lm_created,
        deleted: Boolean(r.lm_deleted),
        call: r.lm_call_type ? { type: r.lm_call_type, status: r.lm_call_status, duration: r.lm_call_duration ?? 0 } : null,
      }
    : null,
});

conversationsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `${LIST_SQL} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200`,
    [req.user.id],
  );
  res.json({ conversations: rows.map(toConversation) });
});

conversationsRouter.post('/', async (req, res) => {
  const { userId } = z.object({ userId: z.uuid('Người dùng không hợp lệ') }).parse(req.body);
  if (userId === req.user.id) throw new HttpError(400, 'Không thể tạo hội thoại với chính mình');

  const { rows: peers } = await query(
    `SELECT id FROM users WHERE id = $1 AND role = 'user' AND status = 'active'`,
    [userId],
  );
  if (!peers[0]) throw new HttpError(404, 'Không tìm thấy người dùng');

  const key = directKey(req.user.id, userId);
  const conversationId = await tx(async (c) => {
    // DO UPDATE de luon co id ca khi hai nguoi cung tao hoi thoai mot luc.
    const { rows } = await c.query(
      `INSERT INTO conversations(direct_key, created_by) VALUES ($1, $2)
       ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
       RETURNING id`,
      [key, req.user.id],
    );
    const id = rows[0].id;
    // Nguoi kia chua thay hoi thoai trong cho den khi co tin dau tien.
    await c.query(
      `INSERT INTO conversation_members(conversation_id, user_id, hidden_at)
       VALUES ($1, $2, NULL), ($1, $3, now()) ON CONFLICT DO NOTHING`,
      [id, req.user.id, userId],
    );
    await c.query(
      `UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    return id;
  });

  const { rows } = await query(`${LIST_SQL} AND c.id = $2`, [req.user.id, conversationId]);
  res.status(201).json({ conversation: toConversation(rows[0]) });
});

// An khoi danh sach cua minh; hoi thoai tu hien lai khi co tin nhan moi.
conversationsRouter.delete('/:id', async (req, res) => {
  const id = uuidParam(req.params.id);
  await requireMember(id, req.user.id);
  await query(
    `UPDATE conversation_members SET hidden_at = now() WHERE conversation_id = $1 AND user_id = $2`,
    [id, req.user.id],
  );
  res.status(204).end();
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  const id = uuidParam(req.params.id);
  await requireMember(id, req.user.id);
  const { before, limit } = z
    .object({
      before: z.coerce.number().int().positive().safe().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    })
    .parse(req.query);

  const { rows } = await query(
    `${MESSAGE_SQL} WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.id < $2)
     ORDER BY m.id DESC LIMIT $3`,
    [id, before ?? null, limit + 1],
  );
  const hasMore = rows.length > limit;
  res.json({ messages: rows.slice(0, limit).reverse().map(toMessage), hasMore });
});

const sendSchema = z.object({
  clientMessageId: z.uuid('Mã tin nhắn không hợp lệ'),
  content: z
    .string({ error: 'Tin nhắn không được để trống' })
    .trim()
    .min(1, 'Tin nhắn không được để trống')
    .max(4000, 'Tin nhắn tối đa 4000 ký tự'),
});

conversationsRouter.post('/:id/messages', async (req, res) => {
  const id = uuidParam(req.params.id);
  const member = await requireMember(id, req.user.id);
  const { clientMessageId, content } = sendSchema.parse(req.body);
  if (member.peer_status === 'locked') {
    throw new HttpError(403, 'Người này đã bị khóa tài khoản, không thể gửi tin nhắn');
  }

  const { id: messageId, created } = await tx((c) => insertMessage(c, {
    conversationId: id, senderId: req.user.id, clientMessageId, content,
  }));
  const row = await fetchMessage(messageId);
  const payload = created ? await publishMessage(row, member.peer_id) : toMessage(row);
  res.status(created ? 201 : 200).json({ message: payload });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageBytes, files: 1, fields: 5 },
});
const imageSchema = z.object({
  clientMessageId: z.uuid('Mã tin nhắn không hợp lệ'),
  caption: z.string().trim().max(4000, 'Chú thích tối đa 4000 ký tự').default(''),
});

conversationsRouter.post('/:id/images', upload.single('image'), async (req, res) => {
  const id = uuidParam(req.params.id);
  const member = await requireMember(id, req.user.id);
  if (member.peer_status === 'locked') {
    throw new HttpError(403, 'Người này đã bị khóa tài khoản, không thể gửi tin nhắn');
  }
  const { clientMessageId, caption } = imageSchema.parse(req.body ?? {});
  if (!req.file) throw new HttpError(400, 'Vui lòng chọn ảnh');
  const kind = detectImage(req.file.buffer);
  if (!kind) throw new HttpError(400, 'Chỉ hỗ trợ ảnh JPG, PNG, GIF hoặc WEBP');

  const key = `${randomUUID()}.${kind.ext}`;
  const filePath = path.join(config.uploadDir, key);
  await writeFile(filePath, req.file.buffer, { flag: 'wx' });
  let result;
  try {
    result = await tx(async (c) => {
      const r = await insertMessage(c, { conversationId: id, senderId: req.user.id, clientMessageId, content: caption, type: 'image' });
      if (r.created) {
        await c.query(
          `INSERT INTO attachments(message_id, storage_key, original_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5)`,
          [r.id, key, req.file.originalname.slice(0, 255), kind.mime, req.file.size],
        );
      }
      return r;
    });
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
  // Gui lai (trung clientMessageId): giu anh cu, bo file vua nhan.
  if (!result.created) await unlink(filePath).catch(() => {});

  const row = await fetchMessage(result.id);
  const payload = result.created ? await publishMessage(row, member.peer_id) : toMessage(row);
  res.status(result.created ? 201 : 200).json({ message: payload });
});

conversationsRouter.post('/:id/read', async (req, res) => {
  const id = uuidParam(req.params.id);
  const member = await requireMember(id, req.user.id);
  const { messageId } = z.object({ messageId: z.number().int().positive().safe() }).parse(req.body);

  // Chi chap nhan id co that trong hoi thoai nay, khong cho danh dau vuot qua tin moi nhat.
  const { rows } = await query(
    `UPDATE conversation_members me
     SET last_read_message_id = GREATEST(me.last_read_message_id, x.id),
         last_delivered_message_id = GREATEST(me.last_delivered_message_id, x.id)
     FROM (SELECT max(id) AS id FROM messages WHERE conversation_id = $1 AND id <= $3) x
     WHERE me.conversation_id = $1 AND me.user_id = $2 AND x.id IS NOT NULL
     RETURNING me.last_read_message_id, me.last_delivered_message_id`,
    [id, req.user.id, messageId],
  );
  if (rows[0]) {
    emitToUser(member.peer_id, 'message:status', {
      conversationId: id,
      lastDeliveredMessageId: rows[0].last_delivered_message_id,
      lastReadMessageId: rows[0].last_read_message_id,
    });
    emitToUser(req.user.id, 'conversation:read', { conversationId: id });
  }
  res.status(204).end();
});

conversationsRouter.delete('/:id/messages/:messageId', async (req, res) => {
  const id = uuidParam(req.params.id);
  const messageId = idParam(req.params.messageId);
  const member = await requireMember(id, req.user.id);
  const { rowCount } = await query(
    `UPDATE messages SET deleted_at = now()
     WHERE id = $1 AND conversation_id = $2 AND sender_id = $3 AND deleted_at IS NULL AND type <> 'call'`,
    [messageId, id, req.user.id],
  );
  if (!rowCount) throw new HttpError(404, 'Không tìm thấy tin nhắn');
  const payload = { conversationId: id, messageId };
  emitToUser(req.user.id, 'message:deleted', payload);
  emitToUser(member.peer_id, 'message:deleted', payload);
  res.status(204).end();
});
