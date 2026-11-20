import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { clearSessionCookie, createSession, publicUser, requireAuth, userFromCookieHeader } from '../auth.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { disconnectSession } from '../realtime.js';
import { displayName, email, password, username } from '../validation.js';

export const authRouter = Router();

// Chi dem lan that bai: chan do mat khau ma khong anh huong nguoi dung binh thuong.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút' },
});

// So sanh voi hash gia khi khong co tai khoan, de thoi gian phan hoi khong lo email ton tai.
const dummyHash = bcrypt.hashSync('chatly-dummy-password', 12);

const registerSchema = z.object({
  email,
  username,
  displayName,
  password,
});

authRouter.post('/register', limiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(body.password, 12);
  let user;
  try {
    const { rows } = await query(
      `INSERT INTO users(email, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.email, body.username, body.displayName, hash],
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint?.includes('email') ? 'Email' : 'Tên đăng nhập';
      throw new HttpError(409, `${field} đã được sử dụng`);
    }
    throw err;
  }
  await createSession(res, req, user.id);
  res.status(201).json({ user: publicUser(user) });
});

const loginSchema = z.object({
  identifier: z.string({ error: 'Vui lòng nhập email hoặc tên đăng nhập' }).trim().min(1, 'Vui lòng nhập email hoặc tên đăng nhập').max(254),
  password: z.string({ error: 'Vui lòng nhập mật khẩu' }).min(1, 'Vui lòng nhập mật khẩu').max(72),
});

authRouter.post('/login', limiter, async (req, res) => {
  const { identifier, password: pw } = loginSchema.parse(req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1 OR username = $1', [identifier]);
  const user = rows[0];
  const ok = await bcrypt.compare(pw, user?.password_hash ?? dummyHash);
  if (!user || !ok) throw new HttpError(401, 'Tài khoản hoặc mật khẩu không đúng');
  if (user.status === 'locked') {
    const why = user.locked_reason ? `: ${user.locked_reason}` : '';
    throw new HttpError(403, `Tài khoản đã bị khóa${why}`, 'ACCOUNT_LOCKED');
  }
  await createSession(res, req, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const user = await userFromCookieHeader(req.headers.cookie);
  if (user) {
    await query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1', [user.session_id]);
    disconnectSession(user.session_id);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
