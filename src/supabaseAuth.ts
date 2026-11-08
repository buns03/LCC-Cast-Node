import { config } from './config';

export interface SupabaseAuthResponse {
  access_token?: string;
  user?: { id: string; email?: string };
}

export class AuthRateLimitError extends Error {
  constructor() {
    super('Supabase Auth rate limit reached');
    this.name = 'AuthRateLimitError';
  }
}

export async function supabaseLogin(email: string, password: string, clientIp?: string): Promise<SupabaseAuthResponse | null> {
  // optional: count the login against the student's own IP (only when you turn it on in .env, see below)
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const forward = !!(clientIp && secretKey && process.env.SUPABASE_FORWARD_IP === 'true');

  const res = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: forward ? (secretKey as string) : config.supabase.anonKey,
      'Content-Type': 'application/json',
      ...(forward ? { 'Sb-Forwarded-For': clientIp as string } : {}),
    },
    body: JSON.stringify({ email, password }),
  });

  if (res.status === 429) throw new AuthRateLimitError();
  if (!res.ok) return null;

  const body = (await res.json()) as SupabaseAuthResponse;
  if (!body.access_token) return null;
  return body;
}

/**
 * Same as SupabaseAuthService.updatePassword in Java:
 * PUT /auth/v1/admin/users/{id} with the service-role key.
 * Throws when Supabase refuses.
 */
export async function updatePassword(authUserId: string, newPassword: string): Promise<void> {
  const key = config.supabase.serviceRoleKey;
  const res = await fetch(`${config.supabase.url}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(`Supabase updatePassword failed: ${res.status} ${await res.text()}`);
  }
}

// ---------------------------------------------------------------- NEW (needed by voterService.ts)

function adminHeaders() {
  const key = config.supabase.serviceRoleKey;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function createUser(email: string, password: string): Promise<{ id: string } | null> {
  const res = await fetch(`${config.supabase.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Supabase createUser failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id?: string };
  return body.id ? { id: body.id } : null;
}

/** duration: "876000h" to ban, "none" to unban */
export async function setUserBanStatus(authUserId: string, duration: string): Promise<void> {
  const res = await fetch(`${config.supabase.url}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ ban_duration: duration }),
  });
  if (!res.ok) throw new Error(`Supabase setUserBanStatus failed: ${res.status} ${await res.text()}`);
}

/** A 404 (already deleted) counts as success, like the Java NotFound catch. */
export async function deleteUser(authUserId: string): Promise<void> {
  const res = await fetch(`${config.supabase.url}/auth/v1/admin/users/${authUserId}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`Supabase deleteUser failed: ${res.status} ${await res.text()}`);
}

/** PUT /auth/v1/admin/users/{id} with the new email (same as SupabaseAuthService.updateEmail in Java). */
export async function updateEmail(authUserId: string, newEmail: string): Promise<void> {
  const res = await fetch(`${config.supabase.url}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ email: newEmail }),
  });
  if (!res.ok) throw new Error(`Supabase updateEmail failed: ${res.status} ${await res.text()}`);
}