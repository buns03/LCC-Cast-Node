import { Db } from './electionRepository';

export interface DepartmentJson {
  id: string; name: string; title: string | null; description: string | null;
  campus: { id: string; name: string; description: string | null; status: string; createdAt: Date; updatedAt: Date };
  schoolYear: string; positions: string[]; votingType: string | null; posterImageUrl: string | null; posterLogoUrl: string | null;
  code: string | null; status: string; createdBy: string | null; createdAt: Date; updatedAt: Date;
}

export interface DeptMemberJson {
  id: string; studentId: string; position: string | null; lastName: string; firstName: string; middleName: string | null;
  campaignImageUrl: string | null; backgroundImageUrl: string | null; photoImageUrl: string | null; createdAt: Date; updatedAt: Date;
}

const SEL = `SELECT d.id, d.name, d.title, d.description, d.school_year, d.positions, d.voting_type, d.poster_image_url, d.poster_logo_url,
    d.code, d.status::text AS status, d.created_by, d.created_at, d.updated_at, d.campus_id, c.name AS campus_name,
    c.description AS campus_description, c.status::text AS campus_status, c.created_at AS campus_created_at, c.updated_at AS campus_updated_at
  FROM departments d JOIN campuses c ON c.id = d.campus_id`;

const mapDept = (r: any): DepartmentJson => ({
  id: r.id, name: r.name, title: r.title, description: r.description,
  campus: { id: r.campus_id, name: r.campus_name, description: r.campus_description, status: r.campus_status, createdAt: r.campus_created_at, updatedAt: r.campus_updated_at },
  schoolYear: r.school_year, positions: Array.isArray(r.positions) ? r.positions : [], votingType: r.voting_type,
  posterImageUrl: r.poster_image_url, posterLogoUrl: r.poster_logo_url, code: r.code, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const MEMBER_COLS = `id, student_id, position, last_name, first_name, middle_name, campaign_image_url, background_image_url, photo_image_url, created_at, updated_at`;
const mapMember = (r: any): DeptMemberJson => ({
  id: r.id, studentId: r.student_id, position: r.position, lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name,
  campaignImageUrl: r.campaign_image_url, backgroundImageUrl: r.background_image_url, photoImageUrl: r.photo_image_url,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listByStatus(db: Db, status: string): Promise<DepartmentJson[]> {
  const { rows } = await db.query(`${SEL} WHERE CAST(d.status AS text) = $1`, [status]);
  return rows.map(mapDept);
}

export async function listByCampusNameStatus(db: Db, campusId: string, name: string, status: string): Promise<DepartmentJson[]> {
  const { rows } = await db.query(
    `${SEL} WHERE d.campus_id = $1 AND LOWER(d.name) = LOWER($2) AND CAST(d.status AS text) = $3`,
    [campusId, name, status],
  );
  return rows.map(mapDept);
}

export async function findById(db: Db, id: string): Promise<DepartmentJson | null> {
  const { rows } = await db.query(`${SEL} WHERE d.id = $1`, [id]);
  return rows[0] ? mapDept(rows[0]) : null;
}

/** title must be unique across ALL statuses (existsByTitleIgnoreCase) */
export async function titleExists(db: Db, title: string, excludeId: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM departments WHERE LOWER(title) = LOWER($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`, [title, excludeId]);
  return rows.length > 0;
}

export async function insert(db: Db, d: {
  name: string; title: string; description: string | null; campusId: string; schoolYear: string; positions: string[];
  votingType: string; posterImageUrl: string | null; posterLogoUrl: string | null; code: string | null; status: string;
}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO departments (name, title, description, campus_id, school_year, positions, voting_type, poster_image_url, poster_logo_url, code, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11) RETURNING id`,
    [d.name, d.title, d.description, d.campusId, d.schoolYear, JSON.stringify(d.positions), d.votingType, d.posterImageUrl, d.posterLogoUrl, d.code, d.status],
  );
  return rows[0].id;
}

export const updateFields = (db: Db, d: DepartmentJson) =>
  db.query(
    `UPDATE departments SET name = $2, title = $3, description = $4, campus_id = $5, school_year = $6, positions = $7::jsonb,
            voting_type = $8, poster_image_url = $9, poster_logo_url = $10, updated_at = now() WHERE id = $1`,
    [d.id, d.name, d.title, d.description, d.campus.id, d.schoolYear, JSON.stringify(d.positions), d.votingType, d.posterImageUrl, d.posterLogoUrl],
  );

export const setStatus = (db: Db, id: string, status: string) => db.query(`UPDATE departments SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
export const deleteDepartment = (db: Db, id: string) => db.query(`DELETE FROM departments WHERE id = $1`, [id]);

export async function listMembers(db: Db, departmentId: string): Promise<DeptMemberJson[]> {
  const { rows } = await db.query(`SELECT ${MEMBER_COLS} FROM department_members WHERE department_id = $1`, [departmentId]);
  return rows.map(mapMember);
}

export async function membersOf(db: Db, ids: string[]): Promise<Map<string, DeptMemberJson[]>> {
  const out = new Map<string, DeptMemberJson[]>();
  if (!ids.length) return out;
  const { rows } = await db.query(`SELECT department_id, ${MEMBER_COLS} FROM department_members WHERE department_id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) {
    if (!out.has(r.department_id)) out.set(r.department_id, []);
    out.get(r.department_id)!.push(mapMember(r));
  }
  return out;
}

export const deleteMembers = (db: Db, departmentId: string) => db.query(`DELETE FROM department_members WHERE department_id = $1`, [departmentId]);

export const insertMember = (
  db: Db, departmentId: string,
  m: { studentId: string; lastName: string; firstName: string; middleName: string | null; position: string | null; campaignImageUrl: string | null; backgroundImageUrl: string | null; photoImageUrl: string | null },
) =>
  db.query(
    `INSERT INTO department_members (department_id, student_id, last_name, first_name, middle_name, position, campaign_image_url, background_image_url, photo_image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [departmentId, m.studentId, m.lastName, m.firstName, m.middleName, m.position, m.campaignImageUrl, m.backgroundImageUrl, m.photoImageUrl],
  );

/** the student's memberships in ACTIVE departments of this school year */
export async function activeMemberships(db: Db, studentId: string, schoolYear: string): Promise<(DeptMemberJson & { departmentId: string })[]> {
  const { rows } = await db.query(
    `SELECT dm.department_id, dm.id, dm.student_id, dm.position, dm.last_name, dm.first_name, dm.middle_name, dm.campaign_image_url,
            dm.background_image_url, dm.photo_image_url, dm.created_at, dm.updated_at
       FROM department_members dm JOIN departments d ON d.id = dm.department_id
      WHERE dm.student_id = $1 AND d.school_year = $2 AND CAST(d.status AS text) = 'ACTIVE'`,
    [studentId, schoolYear],
  );
  return rows.map((r) => ({ ...mapMember(r), departmentId: r.department_id }));
}

export async function linkedToActiveElection(db: Db, departmentId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM election_departments ed JOIN elections e ON e.id = ed.election_id
      WHERE ed.department_id = $1 AND CAST(e.status AS text) = 'ACTIVE' AND (e.end_at IS NULL OR now() <= e.end_at) LIMIT 1`, [departmentId]);
  return rows.length > 0;
}

export const insertArchive = (db: Db, r: { entityId: string; entityName: string; data: string; by: string | null }) =>
  db.query(
    `INSERT INTO archive_records (entity_type, entity_id, entity_name, data, archived_by, archived_at, is_restored)
     VALUES ('Departments', $1, $2, $3::jsonb, $4, now(), false)`, [r.entityId, r.entityName, r.data, r.by]);

export const insertTrash = (db: Db, r: { entityId: string; entityName: string; data: string; by: string | null }) =>
  db.query(
    `INSERT INTO trash_records (entity_type, entity_id, entity_name, data, deleted_by, deleted_at, is_restored)
     VALUES ('Departments', $1, $2, $3::jsonb, $4, now(), false)`, [r.entityId, r.entityName, r.data, r.by]);

export async function markRecordsRestored(db: Db, id: string) {
  for (const table of ['archive_records', 'trash_records']) {
    await db.query(`UPDATE ${table} SET is_restored = true, restored_at = now() WHERE entity_type = 'Departments' AND is_restored = false AND entity_id = $1`, [id]);
  }
}

export const deleteTrashRecords = (db: Db, id: string) =>
  db.query(`DELETE FROM trash_records WHERE entity_type = 'Departments' AND is_restored = false AND entity_id = $1`, [id]);
