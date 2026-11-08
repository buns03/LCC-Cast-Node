import { pool } from './db';
import * as supabaseAuth from './supabaseAuth';

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const blank = (v: string | null) => v === null || v.trim() === '';

/** Port of SettingsController.updateSettings (voter). Returns the HTTP status + message. */
export async function updateVoterSettings(authUserId: string, body: Record<string, unknown>): Promise<{ status: number; message: string }> {
  const voter = (await pool.query(`SELECT id FROM voters WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId])).rows[0];
  if (!voter) return { status: 404, message: 'Voter account not found.' };

  const newEmail = str(body?.newEmail);
  const currentPassword = str(body?.currentPassword);
  const newPassword = str(body?.newPassword);
  const confirmPassword = str(body?.confirmPassword);

  const wantsEmailChange = !blank(newEmail);
  const wantsPasswordChange = !blank(currentPassword);

  if (!wantsEmailChange && !wantsPasswordChange) return { status: 400, message: 'No changes submitted.' };

  if (wantsPasswordChange) {
    if (blank(newPassword) || confirmPassword === null || confirmPassword !== newPassword) {
      return { status: 400, message: 'New password and confirmation do not match.' };
    }

    const profile = (await pool.query(`SELECT email FROM user_profiles WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId])).rows[0];
    if (!profile || !profile.email) return { status: 404, message: 'Account login could not be found.' };

    let ok = false;
    try {
      ok = !!(await supabaseAuth.supabaseLogin(profile.email, currentPassword as string));
    } catch {
      ok = false;
    }
    if (!ok) return { status: 403, message: 'Current password is incorrect.' };
  }

  if (wantsEmailChange) {
    await pool.query(`UPDATE voters SET email = $2, updated_at = now() WHERE id = $1::uuid`, [voter.id, (newEmail as string).trim()]);
  }
  if (wantsPasswordChange) await supabaseAuth.updatePassword(authUserId, newPassword as string);

  return { status: 200, message: 'Settings updated successfully.' };
}