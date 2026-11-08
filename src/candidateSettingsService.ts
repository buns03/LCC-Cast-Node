import { pool } from './db';
import * as supabaseAuth from './supabaseAuth';

export async function findVoterEmail(authUserId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT email FROM voters WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId]);
  return rows[0]?.email ?? null;
}

export interface SettingsBody {
  newEmail?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}

export async function updateSettings(authUserId: string, body: SettingsBody): Promise<{ status: number; message: string }> {
  const voter = (await pool.query(`SELECT id FROM voters WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId])).rows[0];
  if (!voter) return { status: 404, message: 'Account not found.' };

  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const newEmail = str(body?.newEmail);
  const currentPassword = str(body?.currentPassword);
  const newPassword = str(body?.newPassword);
  const confirmPassword = str(body?.confirmPassword);

  const wantsEmailChange = newEmail !== null && newEmail.trim() !== '';
  const wantsPasswordChange = newPassword !== null && newPassword.trim() !== '';

  if (!wantsEmailChange && !wantsPasswordChange) return { status: 200, message: 'Settings saved successfully.' };

  if (wantsPasswordChange) {
    if (!currentPassword || !currentPassword.trim()) {
      return { status: 400, message: 'Current password is required to change your password.' };
    }
    if (confirmPassword === null || confirmPassword !== newPassword) {
      return { status: 400, message: 'New password and confirmation do not match.' };
    }

    // the Supabase LOGIN email lives in user_profiles (voters.email is only the contact email)
    const profile = (await pool.query(`SELECT email FROM user_profiles WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId])).rows[0];
    if (!profile) return { status: 404, message: 'Account not found.' };

    let ok = false;
    try {
      ok = !!profile.email && !!(await supabaseAuth.supabaseLogin(profile.email, currentPassword));
    } catch {
      ok = false;
    }
    if (!ok) return { status: 403, message: 'Current password is incorrect.' };
  }

  if (wantsEmailChange) {
    // ONLY the voter's contact email; Supabase login credentials are not touched
    await pool.query(`UPDATE voters SET email = $2, updated_at = now() WHERE id = $1::uuid`, [voter.id, newEmail!.trim()]);
  }
  if (wantsPasswordChange) await supabaseAuth.updatePassword(authUserId, newPassword!);

  return { status: 200, message: 'Settings updated successfully.' };
}