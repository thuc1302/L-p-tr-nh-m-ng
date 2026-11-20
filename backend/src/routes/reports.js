import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { requireMember } from '../services/conversations.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const schema = z.object({
  conversationId: z.uuid('Hội thoại không hợp lệ'),
  messageId: z.number().int().positive().safe().optional(),
  reason: z.enum(['spam', 'harassment', 'scam', 'other'], { error: 'Vui lòng chọn lý do' }),
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự').default(''),
});

reportsRouter.post('/', async (req, res) => {
  const body = schema.parse(req.body);
  const member = await requireMember(body.conversationId, req.user.id);

  let snapshot = null;
  if (body.messageId) {
    const { rows } = await query(
      `SELECT content, type FROM messages WHERE id = $1 AND conversation_id = $2 AND sender_id = $3 AND type <> 'call'`,
      [body.messageId, body.conversationId, member.peer_id],
    );
    if (!rows[0]) throw new HttpError(404, 'Không tìm thấy tin nhắn');
    snapshot = rows[0].type === 'image' ? `[Hình ảnh] ${rows[0].content}`.trim() : rows[0].content;
  }

  const { rows } = await query(
    `INSERT INTO reports(reporter_id, reported_user_id, conversation_id, message_id, message_snapshot, reason, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.user.id, member.peer_id, body.conversationId, body.messageId ?? null, snapshot, body.reason, body.description],
  );
  res.status(201).json({ id: rows[0].id });
});
