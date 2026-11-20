import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.js';
import { query, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { disconnectUser, emitToUser, isOnline, onlineCount } from '../realtime.js';
import { likePattern, uuidParam } from '../validation.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/stats', async (_req, res) => {
  const { rows } = await query(`
    SELECT
      (SELECT count(*) FROM users WHERE role = 'user') AS users,
      (SELECT count(*) FROM users WHERE role = 'user' AND status = 'locked') AS locked_users,
      (SELECT count(*) FROM conversations) AS conversations,
      (SELECT count(*) FROM messages) AS messages,
      (SELECT count(*) FROM messages WHERE created_at >= date_trunc('day', now())) AS messages_today,
      (SELECT count(*) FROM calls) AS calls,
      (SELECT count(*) FROM reports WHERE status = 'open') AS open_reports`);
  const s = rows[0];
  res.json({
    users: s.users,
    lockedUsers: s.locked_users,
    onlineUsers: onlineCount(),
    conversations: s.conversations,
    messages: s.messages,
    messagesToday: s.messages_today,
    calls: s.calls,
    openReports: s.open_reports,
  });
});

adminRouter.get('/stats/activity', async (req, res) => {
  const days = z.coerce.number().int().min(7).max(90).default(14).parse(req.query.days ?? undefined);
  const { rows } = await query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
       (SELECT count(*) FROM messages m WHERE m.created_at >= d AND m.created_at < d + interval '1 day') AS messages,
       (SELECT count(*) FROM users u WHERE u.role = 'user' AND u.created_at >= d AND u.created_at < d + interval '1 day') AS new_users
     FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') d
     ORDER BY d`,
    [days],
  );
  res.json({ activity: rows.map((r) => ({ day: r.day, messages: r.messages, newUsers: r.new_users })) });
});

const listSchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(['all', 'active', 'locked']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
});
const PAGE_SIZE = 20;

adminRouter.get('/users', async (req, res) => {
  const { q, status, page } = listSchema.parse(req.query);
  const { rows } = await query(
    `SELECT u.id, u.email, u.username, u.display_name, u.status, u.locked_reason, u.created_at, u.last_seen_at,
       (SELECT count(*) FROM messages m WHERE m.sender_id = u.id) AS message_count,
       (SELECT count(*) FROM conversation_members cm WHERE cm.user_id = u.id) AS conversation_count,
       (SELECT count(*) FROM reports r WHERE r.reported_user_id = u.id) AS report_count,
       count(*) OVER() AS total
     FROM users u
     WHERE u.role = 'user' AND ($1 = 'all' OR u.status = $1)
       AND ($2 = '' OR u.username ILIKE $3 OR u.display_name ILIKE $3 OR u.email ILIKE $3)
     ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
    [status, q, likePattern(q), PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  res.json({
    total: rows[0]?.total ?? 0,
    pageSize: PAGE_SIZE,
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.display_name,
      status: u.status,
      lockedReason: u.locked_reason,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      online: isOnline(u.id),
      messageCount: u.message_count,
      conversationCount: u.conversation_count,
      reportCount: u.report_count,
    })),
  });
});

async function lockUser(c, adminId, userId, reason, reportId = null) {
  const { rowCount } = await c.query(
    `UPDATE users SET status = 'locked', locked_reason = $2, locked_at = now(), updated_at = now()
     WHERE id = $1 AND role = 'user' AND status = 'active'`,
    [userId, reason],
  );
  if (!rowCount) return false;
  await c.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  await c.query(
    `INSERT INTO admin_audit_logs(admin_id, action, target_user_id, report_id, detail) VALUES ($1, 'user.lock', $2, $3, $4)`,
    [adminId, userId, reportId, { reason }],
  );
  return true;
}

function kickUser(userId, reason) {
  emitToUser(userId, 'account:locked', { reason });
  disconnectUser(userId);
}

adminRouter.post('/users/:id/lock', async (req, res) => {
  const id = uuidParam(req.params.id);
  const { reason } = z
    .object({ reason: z.string({ error: 'Vui lòng nhập lý do khóa' }).trim().min(1, 'Vui lòng nhập lý do khóa').max(300) })
    .parse(req.body);
  const locked = await tx((c) => lockUser(c, req.user.id, id, reason));
  if (!locked) throw new HttpError(404, 'Không tìm thấy người dùng đang hoạt động');
  kickUser(id, reason);
  res.status(204).end();
});

adminRouter.post('/users/:id/unlock', async (req, res) => {
  const id = uuidParam(req.params.id);
  await tx(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE users SET status = 'active', locked_reason = NULL, locked_at = NULL, updated_at = now()
       WHERE id = $1 AND role = 'user' AND status = 'locked'`,
      [id],
    );
    if (!rowCount) throw new HttpError(404, 'Không tìm thấy người dùng đang bị khóa');
    await c.query(
      `INSERT INTO admin_audit_logs(admin_id, action, target_user_id) VALUES ($1, 'user.unlock', $2)`,
      [req.user.id, id],
    );
  });
  res.status(204).end();
});

adminRouter.get('/reports', async (req, res) => {
  const status = z.enum(['all', 'open', 'resolved', 'dismissed']).default('open').parse(req.query.status ?? undefined);
  const { rows } = await query(
    `SELECT r.*, a.username AS reporter_username, a.display_name AS reporter_name,
            b.username AS reported_username, b.display_name AS reported_name, b.status AS reported_status
     FROM reports r
     JOIN users a ON a.id = r.reporter_id
     JOIN users b ON b.id = r.reported_user_id
     WHERE $1 = 'all' OR r.status = $1
     ORDER BY r.created_at DESC LIMIT 100`,
    [status],
  );
  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      description: r.description,
      messageSnapshot: r.message_snapshot,
      status: r.status,
      resolutionNote: r.resolution_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      reporter: { username: r.reporter_username, displayName: r.reporter_name },
      reported: { id: r.reported_user_id, username: r.reported_username, displayName: r.reported_name, status: r.reported_status },
    })),
  });
});

const resolveSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  note: z.string().trim().max(500).default(''),
  lockUser: z.boolean().default(false),
});

adminRouter.post('/reports/:id/resolve', async (req, res) => {
  const id = uuidParam(req.params.id);
  const body = resolveSchema.parse(req.body);
  const reason = body.note || 'Vi phạm quy định sử dụng';
  const lockedUserId = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE reports SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now()
       WHERE id = $1 AND status = 'open' RETURNING reported_user_id`,
      [id, body.status, body.note, req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Không tìm thấy báo cáo đang chờ xử lý');
    await c.query(
      `INSERT INTO admin_audit_logs(admin_id, action, target_user_id, report_id, detail) VALUES ($1, 'report.resolve', $2, $3, $4)`,
      [req.user.id, rows[0].reported_user_id, id, { status: body.status, note: body.note }],
    );
    if (body.status === 'resolved' && body.lockUser) {
      const locked = await lockUser(c, req.user.id, rows[0].reported_user_id, reason, id);
      return locked ? rows[0].reported_user_id : null;
    }
    return null;
  });
  if (lockedUserId) kickUser(lockedUserId, reason);
  res.status(204).end();
});

adminRouter.get('/audit-logs', async (_req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.action, l.detail, l.created_at, a.username AS admin_username, t.username AS target_username
     FROM admin_audit_logs l
     JOIN users a ON a.id = l.admin_id
     LEFT JOIN users t ON t.id = l.target_user_id
     ORDER BY l.created_at DESC LIMIT 100`,
  );
  res.json({
    logs: rows.map((l) => ({
      id: l.id,
      action: l.action,
      detail: l.detail,
      createdAt: l.created_at,
      admin: l.admin_username,
      target: l.target_username,
    })),
  });
});
