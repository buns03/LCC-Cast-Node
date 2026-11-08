import { Request } from 'express';
import { pool } from './db';
import { IllegalArgumentError } from './errors';
import * as supabaseAuth from './supabaseAuth'; // same path as in adminService.ts

/** Port of SecuritySettingService.java + the data SuperadminSettingsController puts on the page. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SessionUserUtil.getAuthUserId: "userId" first, then "authUserId"; must be a UUID */
export function authUserIdOf(req: Request): string | null {
  const u = req.session?.user as unknown as Record<string, unknown> | undefined;
  if (!u) return null;
  for (const v of [u.userId, u.authUserId]) if (typeof v === 'string' && UUID_RE.test(v)) return v;
  return null;
}

async function profileOf(authUserId: string | null) {
  if (!authUserId) throw new IllegalArgumentError('Not logged in.');
  const { rows } = await pool.query(
    `SELECT id, auth_user_id, email FROM user_profiles WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId]);
  if (!rows[0]) throw new IllegalArgumentError('Account not found.');
  return rows[0] as { id: string; auth_user_id: string | null; email: string | null };
}

/** email + picture for the Settings page */
export async function getAccountInfo(req: Request): Promise<{ email: string; pictureUrl: string }> {
  const fallback = { email: '', pictureUrl: '/images/default-avatar.png' };
  const authUserId = authUserIdOf(req);
  if (!authUserId) return fallback;

  const { rows } = await pool.query(
    `SELECT email, profile_picture_url FROM user_profiles WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId]);
  if (!rows[0]) return fallback;
  const path = rows[0].profile_picture_url;
  return { email: rows[0].email ?? '', pictureUrl: path && String(path).trim() ? `/files/${path}` : fallback.pictureUrl };
}

export async function changePassword(authUserId: string | null, currentPassword: unknown, newPassword: unknown): Promise<void> {
  const profile = await profileOf(authUserId);
  if (!profile.email || !profile.auth_user_id) throw new IllegalArgumentError('Account has no linked login.');

  const current = typeof currentPassword === 'string' ? currentPassword : '';
  const next = typeof newPassword === 'string' ? newPassword : '';

  let ok = false;
  try {
    ok = !!(await supabaseAuth.supabaseLogin(profile.email, current));
  } catch {
    ok = false;
  }
  if (!ok) throw new IllegalArgumentError('Current password is incorrect.');

  if (current === next) throw new IllegalArgumentError('New password cannot be the same as your current password.');
  if (next.length < 8) throw new IllegalArgumentError('New password must be at least 8 characters.');

  await supabaseAuth.updatePassword(profile.auth_user_id, next);
}

export async function changeEmail(authUserId: string | null, newEmail: unknown): Promise<string> {
  const profile = await profileOf(authUserId);
  const email = typeof newEmail === 'string' ? newEmail.trim() : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IllegalArgumentError('Please enter a valid email address.');
  if (email.toLowerCase() === (profile.email ?? '').toLowerCase()) {
    throw new IllegalArgumentError('New email is the same as your current email.');
  }

  // Supabase Auth first; if it rejects (e.g. already in use) nothing local changes
  await supabaseAuth.updateEmail(authUserId as string, email);

  await pool.query(`UPDATE user_profiles SET email = $2, updated_at = now() WHERE id = $1::uuid`, [profile.id, email]);
  return email;
}