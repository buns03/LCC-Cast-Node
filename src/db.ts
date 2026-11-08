import { Pool } from 'pg';
import { config } from './config';

/**
 * Spring used a JDBC url (jdbc:postgresql://host:port/db).
 * Node's "pg" wants host/port/database separately, so we split it here.
 * That way you can reuse the exact same SUPABASE_DB_URL value.
 */
function parseJdbcUrl(raw: string) {
  const cleaned = raw.replace(/^jdbc:/, '');
  const u = new URL(cleaned);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

export const pool = new Pool({
  ...parseJdbcUrl(config.db.url),
  user: config.db.username,
  password: config.db.password,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  max: 12,                        // must stay below the pooler's pool_size (15)
  idleTimeoutMillis: 10000,       // release idle connections so restarts don't pile up
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

export { programCourseMatches } from './programCourse';