import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate() {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727274)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await c.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (const file of files) {
      if (applied.has(file)) continue;
      await c.query(await readFile(path.join(dir, file), 'utf8'));
      await c.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      console.log(`Da ap dung migration ${file}`);
    }
  });
}
