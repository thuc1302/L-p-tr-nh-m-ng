import { z } from 'zod';
import { HttpError } from './errors.js';

export function uuidParam(value) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'Không tìm thấy tài nguyên');
  return parsed.data;
}

export function idParam(value) {
  const parsed = z.coerce.number().int().positive().safe().safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'Không tìm thấy tài nguyên');
  return parsed.data;
}

// Tranh % va _ cua nguoi dung bi hieu la ky tu dai dien trong ILIKE.
export const likePattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export const password = z
  .string({ error: 'Vui lòng nhập mật khẩu' })
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự')
  .max(72, 'Mật khẩu tối đa 72 ký tự');

export const displayName = z
  .string({ error: 'Vui lòng nhập tên hiển thị' })
  .trim()
  .min(1, 'Vui lòng nhập tên hiển thị')
  .max(60, 'Tên hiển thị tối đa 60 ký tự');

// Nhan dien anh theo noi dung file thay vi tin vao ten/kieu do trinh duyet gui.
export function detectImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.toString('latin1', 0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export const username = z
  .string({ error: 'Vui lòng nhập tên đăng nhập' })
  .trim()
  .regex(/^[a-zA-Z0-9_.]{3,30}$/, 'Tên đăng nhập gồm 3-30 ký tự: chữ, số, dấu chấm hoặc gạch dưới');

export const email = z
  .string({ error: 'Vui lòng nhập email' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email không hợp lệ').max(254, 'Email quá dài'));
