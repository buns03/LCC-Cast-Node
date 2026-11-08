import { pool } from './db';
import { withTransaction } from './tx';
import { IllegalArgumentError, IllegalStateError } from './errors';
import { realtime } from './realtime';
import * as supabaseAuth from './supabaseAuth'; // same path as the supabaseAuth import at the top of voterService.ts
import { Db } from './electionRepository';
import { resolveOfferedProgram } from './systemConfigService';

/** Port of AdminService.java (superadmin Admin Accounts). */

export interface AdminInput {
  lastName?: string | null; firstName?: string | null; middleName?: string | null; contact?: string | null;
  email?: string | null; campus?: string | null; electionType?: string | null; department?: string | null; password?: string | null;
}

const RETIRED = '876000h'; // ~100 year ban, same as Java

const FROM = `FROM user_profiles up LEFT JOIN campuses c ON c.id = up.campus_id`;
const SELECT = `SELECT up.*, c.name AS campus_name ${FROM}`;

// "MMMM d, yyyy" (Java used the server zone; Manila here)
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
const longDate = (d: Date | null) => (d ? dateFmt.format(d) : '');

/** AdminResponse.from(...) */
function toResponse(r: any) {
  return {
    id: r.id,
    lastName: r.last_name ?? '',
    firstName: r.first_name ?? '',
    middleName: r.middle_name,
    contact: r.contact_number,
    email: r.email,
    campus: r.campus_name ?? '',
    electionType: r.admin_type,
    department: r.admin_department ?? '',
    status: r.is_active === true ? 'Active' : 'Inactive',
    dateAssigned: longDate(r.created_at),
    lastUpdated: longDate(r.updated_at),
    profilePictureUrl: r.profile_picture_url ? `/files/${r.profile_picture_url}` : null,
  };
}

/** snapshot stored in archive_records / trash_records (password hash is never copied) */
const snapshot = (r: any) => ({
  id: r.id, authUserId: r.auth_user_id, role: r.role, lastName: r.last_name, firstName: r.first_name,
  middleName: r.middle_name, contactNumber: r.contact_number, email: r.email, campusId: r.campus_id,
  departmentId: r.department_id, active: r.is_active, lastLoginAt: r.last_login_at, createdAt: r.created_at,
  updatedAt: r.updated_at, adminType: r.admin_type, emailVerifiedAt: r.email_verified_at, schoolId: r.school_id,
  mustChangePassword: r.must_change_password, status: r.status, adminDepartment: r.admin_department,
  profilePictureUrl: r.profile_picture_url,
});

const nameOf = (r: any) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();

async function mustAdmin(db: Db, id: string): Promise<any> {
  const { rows } = await db.query(`${SELECT} WHERE up.id = $1::uuid AND CAST(up.role AS text) = 'ADMIN'`, [id]);
  if (!rows[0]) throw new IllegalArgumentError('Admin not found');
  return rows[0];
}

async function campusIdByName(db: Db, name: string | null | undefined): Promise<string> {
  const { rows } = await db.query(`SELECT id FROM campuses WHERE lower(name) = lower($1) LIMIT 1`, [name ?? '']);
  if (!rows[0]) throw new IllegalArgumentError(`Unknown campus: ${name}`);
  return rows[0].id;
}

function resolveElectionType(t: string | null | undefined): 'SSC' | 'DEPARTMENT' {
  if (t !== 'SSC' && t !== 'DEPARTMENT') throw new IllegalArgumentError('Election type is required.');
  return t;
}

async function resolveAdminDepartment(
  db: Db, campusId: string, electionType: string, department: string | null | undefined, current: string | null = null,
): Promise<string | null> {
  if (electionType !== 'DEPARTMENT') return null;
  if (!department || !department.trim()) throw new IllegalArgumentError('Department is required for Department Election admins.');
  return resolveOfferedProgram(db, campusId, department, current);
}

// ---------------- list ----------------

export async function listAdmins() {
  const { rows } = await pool.query(
    `${SELECT} WHERE CAST(up.role AS text) = 'ADMIN' AND up.is_active = true ORDER BY up.created_at DESC NULLS LAST, up.id`);
  return rows.map(toResponse);
}

// ---------------- create ----------------

export async function createAdmin(input: AdminInput) {
  const campusId = await campusIdByName(pool, input.campus);
  const electionType = resolveElectionType(input.electionType);
    const adminDepartment = await resolveAdminDepartment(pool, campusId, electionType, input.department);

  const email = (input.email ?? '').trim();
  if (!email) throw new IllegalArgumentError('Email is required.');
  if (!input.password) throw new IllegalArgumentError('Password is required.');

  let authUserId: string;
  try {
    const auth = await supabaseAuth.createUser(email, input.password);
    if (!auth?.id) throw new Error('Supabase returned no user id.');
    authUserId = auth.id;
  } catch (e) {
    console.error('[admins] createUser failed:', (e as Error).message);
    throw new IllegalStateError(`Failed to create the login for ${email}. The email may already be in use.`);
  }

  try {
    const r = await pool.query(
      `INSERT INTO user_profiles (auth_user_id, role, admin_type, last_name, first_name, middle_name, contact_number,
                                  email, campus_id, admin_department, is_active, status, must_change_password)
       VALUES ($1::uuid, 'ADMIN', $2, $3, $4, $5, $6, $7, $8::uuid, $9, true, 'ACTIVE', true) RETURNING id`,
      [authUserId, electionType, input.lastName ?? null, input.firstName ?? null, input.middleName ?? null,
       input.contact ?? null, email, campusId, adminDepartment],
    );
    return toResponse(await mustAdmin(pool, r.rows[0].id));
  } catch (e) {
    await supabaseAuth.deleteUser(authUserId).catch(() => undefined); // don't leave an orphan login behind
    throw e;
  }
}

// ---------------- update ----------------

export async function updateAdmin(id: string, input: AdminInput) {
  const row = await mustAdmin(pool, id);
  const campusId = await campusIdByName(pool, input.campus);
  const electionType = resolveElectionType(input.electionType);
    const adminDepartment = await resolveAdminDepartment(pool, campusId, electionType, input.department, row.admin_department);

  const newEmail = (input.email ?? '').trim();
  const emailChanged = !!newEmail && (row.email ?? '').toLowerCase() !== newEmail.toLowerCase();

  if (emailChanged && row.auth_user_id) {
    try {
      await supabaseAuth.updateEmail(row.auth_user_id, newEmail);
    } catch {
      throw new IllegalArgumentError(`That email is already in use by another account: ${newEmail}`);
    }
  }

  if (input.password && input.password.trim() && row.auth_user_id) {
    await supabaseAuth.updatePassword(row.auth_user_id, input.password);
  }

  await pool.query(
    `UPDATE user_profiles SET last_name = $2, first_name = $3, middle_name = $4, contact_number = $5, email = $6,
            campus_id = $7::uuid, admin_type = $8, admin_department = $9, updated_at = now()
      WHERE id = $1::uuid`,
    [id, input.lastName ?? null, input.firstName ?? null, input.middleName ?? null, input.contact ?? null,
     emailChanged ? newEmail : row.email, campusId, electionType, adminDepartment],
  );
  return toResponse(await mustAdmin(pool, id));
}

// ---------------- archive / delete (soft) ----------------

async function retire(id: string, by: string | null, kind: 'archive' | 'trash'): Promise<void> {
  const row = await mustAdmin(pool, id);

  if (kind === 'archive' && row.status !== 'ACTIVE') throw new IllegalStateError('Only active admins can be archived.');
  if (kind === 'trash' && row.status === 'DELETED') throw new IllegalStateError('Admin is already deleted.');

  // block the login first: if this fails nothing else changes
  if (row.auth_user_id) await supabaseAuth.setUserBanStatus(row.auth_user_id, RETIRED);

  await withTransaction(async (db) => {
    if (kind === 'archive') {
      await db.query(
        `INSERT INTO archive_records (entity_type, entity_id, entity_name, data, archived_by, archived_at, is_restored)
         VALUES ('Admins', $1::uuid, $2, $3::jsonb, $4::uuid, now(), false)`,
        [row.id, nameOf(row), JSON.stringify(snapshot(row)), by]);
    } else {
      await db.query(
        `INSERT INTO trash_records (entity_type, entity_id, entity_name, data, deleted_by, deleted_at, is_restored)
         VALUES ('Admins', $1::uuid, $2, $3::jsonb, $4::uuid, now(), false)`,
        [row.id, nameOf(row), JSON.stringify(snapshot(row)), by]);
    }
    await db.query(
      `UPDATE user_profiles SET status = $2::record_status, is_active = false, updated_at = now() WHERE id = $1::uuid`,
      [id, kind === 'archive' ? 'ARCHIVED' : 'DELETED']);
  });

  realtime.historyChanged(kind === 'archive' ? 'archives' : 'trash');
}

export const archiveAdmin = (id: string, by: string | null) => retire(id, by, 'archive');
export const deleteAdmin = (id: string, by: string | null) => retire(id, by, 'trash');

// ---------------- restore / permanent delete ----------------

export async function restoreAdmin(id: string): Promise<void> {
  const row = await mustAdmin(pool, id);
  if (row.status !== 'DELETED' && row.status !== 'ARCHIVED') throw new IllegalStateError('Admin cannot be restored.');

  if (row.auth_user_id) await supabaseAuth.setUserBanStatus(row.auth_user_id, 'none');

  await withTransaction(async (db) => {
    await db.query(`UPDATE user_profiles SET status = 'ACTIVE', is_active = true, updated_at = now() WHERE id = $1::uuid`, [id]);
    for (const table of ['trash_records', 'archive_records']) {
      await db.query(
        `UPDATE ${table} SET is_restored = true, restored_at = now()
          WHERE entity_type = 'Admins' AND entity_id = $1::uuid AND is_restored = false`, [id]);
    }
  });

  realtime.historyChanged('archives');
  realtime.historyChanged('trash');
}

export async function permanentlyDeleteAdmin(id: string): Promise<void> {
  const row = await mustAdmin(pool, id);
  if (row.status !== 'DELETED') throw new IllegalStateError('Only trashed admins can be permanently deleted.');

  // Supabase first (404 = already gone is fine, any other error aborts), then the local rows
  if (row.auth_user_id) await supabaseAuth.deleteUser(row.auth_user_id);

  await withTransaction(async (db) => {
    await db.query(`DELETE FROM trash_records WHERE entity_type = 'Admins' AND entity_id = $1::uuid AND is_restored = false`, [id]);
    await db.query(`DELETE FROM user_profiles WHERE id = $1::uuid`, [id]);
  });

  realtime.historyChanged('trash');
}