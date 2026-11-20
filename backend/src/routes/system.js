import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { requireAuth } from '../auth.js';

export const systemRouter = Router();
systemRouter.use(requireAuth);

// Dia chi de may khac trong mang LAN truy cap; IP do dich vu lan-watch cap nhat.
systemRouter.get('/lan', async (_req, res) => {
  const ip = (await readFile('/run/chatly/lan_host', 'utf8').catch(() => '')).trim();
  const port = process.env.HTTPS_PORT || '8443';
  res.json({ ip: ip || null, url: ip ? `https://${ip}:${port}` : null });
});
