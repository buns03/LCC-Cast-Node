import { pool } from "./db";
import { T, USER_PROFILE_COLUMNS } from "./schema";
import { UserProfile } from "./types";

const SELECT_PROFILE = `SELECT ${USER_PROFILE_COLUMNS.join(", ")} FROM public.${T.userProfiles}`;

function mapProfile(r: any): UserProfile {
  return {
    id: r.id,
    authUserId: r.auth_user_id,
    role: r.role,
    campusId: r.campus_id,
    departmentId: r.department_id,
    adminDepartment: r.admin_department,
    schoolId: r.school_id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    active: r.is_active === true,
    status: r.status,
    lastLoginAt: r.last_login_at,
    mustChangePassword: r.must_change_password === true,
    adminType: r.admin_type,
  };
}

// ---------------- user_profiles ----------------

export async function findBySchoolId(
  schoolId: string,
): Promise<UserProfile | null> {
  const { rows } = await pool.query(
    `${SELECT_PROFILE} WHERE school_id = $1 LIMIT 1`,
    [schoolId],
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}

/** Case-insensitive on purpose: "Juan@School.edu" should still find juan@school.edu */
export async function findByEmail(email: string): Promise<UserProfile | null> {
  const { rows } = await pool.query(
    `${SELECT_PROFILE} WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function touchLastLogin(profileId: string): Promise<void> {
  await pool.query(
    `UPDATE public.${T.userProfiles} SET last_login_at = now(), updated_at = now() WHERE id = $1`,
    [profileId],
  );
}

// ---------------- voters ----------------

export async function isVoterActive(
  authUserId: string | null,
): Promise<boolean> {
  if (!authUserId) return false;
  const c = T.voterCols;
  const { rows } = await pool.query(
    `SELECT 1 FROM public.${T.voters} WHERE ${c.authUserId} = $1 AND ${c.status}::text = 'ACTIVE' LIMIT 1`,
    [authUserId],
  );
  return rows.length > 0;
}

export async function findVoterInfo(
  authUserId: string | null,
): Promise<{ campusId: string | null; programCourse: string | null } | null> {
  if (!authUserId) return null;
  const c = T.voterCols;
  const { rows } = await pool.query(
    `SELECT ${c.campusId} AS campus_id, ${c.programCourse} AS program_course
       FROM public.${T.voters} WHERE ${c.authUserId} = $1 LIMIT 1`,
    [authUserId],
  );
  return rows[0]
    ? { campusId: rows[0].campus_id, programCourse: rows[0].program_course }
    : null;
}

// ---------------- campuses ----------------

export async function findCampusName(
  campusId: string | null,
): Promise<string | null> {
  if (!campusId) return null;
  const c = T.campusCols;
  const { rows } = await pool.query(
    `SELECT ${c.name} AS name FROM public.${T.campuses} WHERE ${c.id} = $1 LIMIT 1`,
    [campusId],
  );
  return rows[0]?.name ?? null;
}

// ---------------- voters (by email, for forgot-password) ----------------

export async function findVoterByEmail(
  email: string,
): Promise<{ authUserId: string | null } | null> {
  const c = T.voterCols;
  const { rows } = await pool.query(
    `SELECT ${c.authUserId} AS auth_user_id FROM public.${T.voters} WHERE lower(${c.email}) = lower($1) LIMIT 1`,
    [email],
  );
  return rows[0] ? { authUserId: rows[0].auth_user_id } : null;
}

/** Email stored in the voters data, found by School ID (voters.student_id). */
export async function findVoterEmailByStudentId(
  studentId: string,
): Promise<{ email: string | null } | null> {
  const c = T.voterCols;
  const { rows } = await pool.query(
    `SELECT ${c.email} AS email FROM public.${T.voters} WHERE student_id = $1 LIMIT 1`,
    [studentId],
  );
  return rows[0] ? { email: rows[0].email ?? null } : null;
}

// ---------------- user_profiles: must_change_password ----------------

/** Returns the role of the profile that was updated, or null if there is no user_profiles row. */
export async function clearMustChangePassword(
  authUserId: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE public.${T.userProfiles} SET must_change_password = false, updated_at = now()
      WHERE auth_user_id = $1 RETURNING role::text AS role`,
    [authUserId],
  );
  return rows[0]?.role ?? null;
}

// ---------------- email_otps ----------------

export interface EmailOtp {
  id: string;
  authUserId: string;
  email: string;
  otpHash: string;
  purpose: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export async function insertOtp(o: {
  authUserId: string;
  email: string;
  otpHash: string;
  purpose: string;
  expiresAt: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.${T.emailOtps} (auth_user_id, email, otp_hash, purpose, expires_at, attempts)
     VALUES ($1, $2, $3, $4, $5, 0)`,
    [o.authUserId, o.email, o.otpHash, o.purpose, o.expiresAt],
  );
}

export async function findLatestOtp(
  email: string,
  purpose: string,
): Promise<EmailOtp | null> {
  const { rows } = await pool.query(
    `SELECT id, auth_user_id, email, otp_hash, purpose, expires_at, verified_at, attempts, created_at
       FROM public.${T.emailOtps}
      WHERE lower(email) = lower($1) AND purpose = $2
      ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    authUserId: r.auth_user_id,
    email: r.email,
    otpHash: r.otp_hash,
    purpose: r.purpose,
    expiresAt: r.expires_at,
    verifiedAt: r.verified_at,
    attempts: r.attempts,
    createdAt: r.created_at,
  };
}

export async function updateOtpAttempts(
  id: string,
  attempts: number,
): Promise<void> {
  await pool.query(
    `UPDATE public.${T.emailOtps} SET attempts = $2 WHERE id = $1`,
    [id, attempts],
  );
}

export async function markOtpVerified(id: string): Promise<void> {
  await pool.query(
    `UPDATE public.${T.emailOtps} SET verified_at = now() WHERE id = $1`,
    [id],
  );
}

export async function deleteOtp(id: string): Promise<void> {
  await pool.query(`DELETE FROM public.${T.emailOtps} WHERE id = $1`, [id]);
}

export async function findProfilePictureUrl(
  authUserId: string | null,
): Promise<string | null> {
  if (!authUserId) return null;
  const { rows } = await pool.query(
    `SELECT profile_picture_url FROM public.${T.userProfiles} WHERE auth_user_id = $1 LIMIT 1`,
    [authUserId],
  );
  const path = rows[0]?.profile_picture_url;
  return path && String(path).trim() ? String(path) : null;
}

// ---------------- user_profiles: admin settings page ----------------

export async function findSettingsProfile(
  authUserId: string,
): Promise<{ email: string | null; profilePicture: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT email, profile_picture_url FROM public.${T.userProfiles} WHERE auth_user_id = $1 LIMIT 1`,
    [authUserId],
  );
  if (!rows[0]) return null;
  const pic = rows[0].profile_picture_url;
  return {
    email: rows[0].email ?? null,
    profilePicture: pic && String(pic).trim() ? String(pic) : null,
  };
}

export async function updateProfileEmail(
  authUserId: string,
  email: string,
): Promise<void> {
  await pool.query(
    `UPDATE public.${T.userProfiles} SET email = $2, updated_at = now() WHERE auth_user_id = $1`,
    [authUserId, email],
  );
}

export async function updateProfilePicture(
  authUserId: string,
  storagePath: string,
): Promise<void> {
  await pool.query(
    `UPDATE public.${T.userProfiles} SET profile_picture_url = $2, updated_at = now() WHERE auth_user_id = $1`,
    [authUserId, storagePath],
  );
}
