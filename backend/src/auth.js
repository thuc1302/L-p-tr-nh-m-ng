import { createHash, randomBytes } from 'node:crypto';
import { parseCookie } from 'cookie';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './errors.js';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createSession(res, req, userId) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 86400 * 1000;
  await query(
    `INSERT INTO user_sessions(user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), req.get('user-agent')?.slice(0, 300), req.ip, new Date(Date.now() + maxAge)],
  );
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Qua HTTPS (nginx bao bang X-Forwarded-Proto) thi cookie chi gui tren HTTPS.
    secure: config.cookieSecure || req.secure,
    maxAge,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

// Dung chung cho REST va Socket.IO. Tai khoan bi khoa coi nhu khong co phien.
export async function userFromCookieHeader(cookieHeader) {
  const token = parseCookie(cookieHeader ?? '')[config.cookieName];
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.created_at, s.id AS session_id
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function requireAuth(req, _res, next) {
  req.user = await userFromCookieHeader(req.headers.cookie);
  if (!req.user) throw new HttpError(401, 'Vui lòng đăng nhập');
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Bạn không có quyền truy cập');
  next();
}

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  displayName: u.display_name,
  bio: u.bio,
  role: u.role,
  createdAt: u.created_at,
});
