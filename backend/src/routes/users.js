import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { publicUser, requireAuth } from '../auth.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { disconnectSession, isOnline, notifyPeers } from '../realtime.js';
import { displayName, email, likePattern, password, username, uuidParam } from '../validation.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// Cac thao tac can mat khau hien tai: chan doan mat khau tu mot phien bi lo.
const passwordGuard = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' },
});

const currentPassword = z.string({ error: 'Vui lòng nhập mật khẩu hiện tại' }).min(1, 'Vui lòng nhập mật khẩu hiện tại').max(72);

async function checkPassword(userId, pw) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!(await bcrypt.compare(pw, rows[0].password_hash))) {
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
  }
}

// Dang xuat moi thiet bi khac, giu lai phien dang dung.
async function revokeOtherSessions(user) {
  const { rows } = await query(
    `UPDATE user_sessions SET revoked_at = now()
     WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id`,
    [user.id, user.session_id],
  );
  rows.forEach((r) => disconnectSession(r.id));
}

async function updateMe(userId, sql, params, takenLabel) {
  try {
    const { rows } = await query(`UPDATE users SET ${sql}, updated_at = now() WHERE id = $1 RETURNING *`, [userId, ...params]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, `${takenLabel} đã được sử dụng`);
    throw err;
  }
}

// Ten va gioi thieu hien ngay ben phia nhung nguoi dang tro chuyen.
const announce = (u) => notifyPeers(u.id, 'user:updated', {
  id: u.id, username: u.username, displayName: u.display_name, bio: u.bio,
}).catch(console.error);

usersRouter.get('/me', async (req, res) => {
  const { rows } = await query(
    `SELECT u.*,
       (SELECT count(*) FROM conversation_members cm WHERE cm.user_id = u.id) AS conversation_count,
       (SELECT count(*) FROM messages m WHERE m.sender_id = u.id AND m.type <> 'call') AS message_count,
       (SELECT count(*) FROM calls c WHERE c.caller_id = u.id OR c.callee_id = u.id) AS call_count
     FROM users u WHERE u.id = $1`,
    [req.user.id],
  );
  const u = rows[0];
  res.json({
    user: publicUser(u),
    stats: { conversations: u.conversation_count, messages: u.message_count, calls: u.call_count },
  });
});

const profileSchema = z.object({
  displayName,
  bio: z.string().trim().max(200, 'Giới thiệu tối đa 200 ký tự').default(''),
});

usersRouter.patch('/me', async (req, res) => {
  const body = profileSchema.parse(req.body);
  const user = await updateMe(req.user.id, 'display_name = $2, bio = $3', [body.displayName, body.bio]);
  announce(user);
  res.json({ user: publicUser(user) });
});

usersRouter.patch('/me/username', async (req, res) => {
  const body = z.object({ username }).parse(req.body);
  const user = await updateMe(req.user.id, 'username = $2', [body.username], 'Tên đăng nhập');
  announce(user);
  res.json({ user: publicUser(user) });
});

usersRouter.patch('/me/email', passwordGuard, async (req, res) => {
  const body = z.object({ email, currentPassword }).parse(req.body);
  await checkPassword(req.user.id, body.currentPassword);
  if (body.email === req.user.email.toLowerCase()) throw new HttpError(400, 'Email mới phải khác email hiện tại');
  const user = await updateMe(req.user.id, 'email = $2', [body.email], 'Email');
  await revokeOtherSessions(req.user);
  res.json({ user: publicUser(user) });
});

usersRouter.post('/me/password', passwordGuard, async (req, res) => {
  const body = z.object({ currentPassword, newPassword: password }).parse(req.body);
  if (body.newPassword === body.currentPassword) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại');
  await checkPassword(req.user.id, body.currentPassword);
  const hash = await bcrypt.hash(body.newPassword, 12);
  await updateMe(req.user.id, 'password_hash = $2', [hash]);
  await revokeOtherSessions(req.user);
  res.status(204).end();
});

usersRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const { rows } = await query(
    `SELECT id, username, display_name, bio, last_seen_at FROM users
     WHERE id <> $1 AND role = 'user' AND status = 'active'
       AND ($2 = '' OR username ILIKE $3 OR display_name ILIKE $3)
     ORDER BY display_name LIMIT 20`,
    [req.user.id, q, likePattern(q)],
  );
  res.json({
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      bio: u.bio,
      online: isOnline(u.id),
      lastSeenAt: u.last_seen_at,
    })),
  });
});

// Ho so cong khai: khong co email.
usersRouter.get('/:id', async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rows } = await query(
    `SELECT id, username, display_name, bio, status, created_at, last_seen_at FROM users WHERE id = $1 AND role = 'user'`,
    [id],
  );
  const u = rows[0];
  if (!u) throw new HttpError(404, 'Không tìm thấy người dùng');
  res.json({
    user: {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      bio: u.bio,
      locked: u.status === 'locked',
      online: isOnline(u.id),
      lastSeenAt: u.last_seen_at,
      createdAt: u.created_at,
    },
  });
});
