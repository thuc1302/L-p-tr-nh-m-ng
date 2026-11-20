import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { migrate } from './migrate.js';
import { initRealtime } from './realtime.js';
import { adminRouter } from './routes/admin.js';
import { attachmentsRouter } from './routes/attachments.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { reportsRouter } from './routes/reports.js';
import { systemRouter } from './routes/system.js';
import { usersRouter } from './routes/users.js';
import { seed } from './seed.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/system', systemRouter);
app.use('/api/admin', adminRouter);
app.use(notFoundHandler);
app.use(errorHandler);

await mkdir(config.uploadDir, { recursive: true });
await migrate();
await seed();

const server = createServer(app);
initRealtime(server);
server.listen(config.port, () => console.log(`Chatly API dang chay o cong ${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))));
}
