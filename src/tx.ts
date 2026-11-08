import { PoolClient } from 'pg';
import { pool } from './db';

/** Same idea as Spring's @Transactional: everything commits together, or nothing does. */
export async function withTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
