import pg from 'pg';

// BIGINT (id tin nhan, COUNT) nam trong pham vi an toan cua Number.
pg.types.setTypeParser(20, Number);

export const pool = new pg.Pool({ max: 10 });
export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
