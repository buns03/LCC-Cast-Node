import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable: ${name}. Check your .env file.`);
  }
  return value.trim();
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  isProd,
  sessionSecret: isProd ? required('SESSION_SECRET') : (process.env.SESSION_SECRET ?? 'dev-only-secret'),
  db: {
    url: required('SUPABASE_DB_URL'),
    username: required('SUPABASE_DB_USERNAME'),
    password: required('SUPABASE_DB_PASSWORD'),
  },
  supabase: {
    url: required('SUPABASE_URL').replace(/\/+$/, ''),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  appBaseUrl: (process.env.APP_BASE_URL ?? 'https://lcc-cast.onrender.com').replace(/\/+$/, ''),
  appLoginUrl: process.env.APP_LOGIN_URL ?? 'https://lcc-cast.onrender.com/login',
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'partylist-files',
  /** The background jobs email real voters. OFF unless you turn them on (see .env.example). */
  enableSchedulers: process.env.ENABLE_SCHEDULERS === 'true',
  mail: {
    username: process.env.MAIL_USERNAME?.trim() ?? '',
    password: process.env.MAIL_PASSWORD?.trim() ?? '',
    fromName: 'LCC Cast',
  },
};
