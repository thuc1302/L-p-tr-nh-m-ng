import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  seedDemo: process.env.SEED_DEMO === 'true',
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? 'uploads'),
  maxImageBytes: 10 * 1024 * 1024,
  sessionDays: 7,
  cookieName: 'chatly_session',
};
