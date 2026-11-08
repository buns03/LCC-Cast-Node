import { Db } from './electionRepository';

export interface PartylistJson {
  id: string;
  name: string;
  description: string | null;
  campus: { id: string; name: string; description: string | null; status: string; createdAt: Date; updatedAt: Date };
  schoolYear: string;
  posterImageUrl: string | null;
  posterLogoUrl: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberJson {
  id: string;
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  position: string;
  campaignImageUrl: string | null;
  backgroundImageUrl: string | null;
  photoImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SEL = `SELECT p.id, p.name, p.description, p.school_year, p.poster_image_url, p.poster_logo_url, p.status::text AS status,
    p.created_by, p.created_at, p.updated_at, p.campus_id, c.name AS campus_name, c.description AS campus_description,
    c.status::text AS campus_status, c.created_at AS campus_created_at, c.updated_at AS campus_updated_at
  FROM partylists p JOIN campuses c ON c.id = p.campus_id`;

const mapPartylist = (r: any): PartylistJson => ({
  id: r.id, name: r.name, description: r.description,
  campus: { id: r.campus_id, name: r.campus_name, description: r.campus_description, status: r.campus_status, createdAt: r.campus_created_at, updatedAt: r.campus_updated_at },
  schoolYear: r.school_year, posterImageUrl: r.poster_image_url, posterLogoUrl: r.poster_logo_url,
  status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listByStatus(db: Db, status: string): Promise<PartylistJson[]> {
  const { rows } = await db.query(`${SEL} WHERE CAST(p.status AS text) = $1`, [status]);
  return rows.map(mapPartylist);
}

export async function findById(db: Db, id: string): Promise<PartylistJson | null> {
  const { rows } = await db.query(`${SEL} WHERE p.id = $1`, [id]);
  return rows[0] ? mapPartylist(rows[0]) : null;
}

export async function allCampuses(db: Db) {
  const { rows } = await db.query(`SELECT id, name, description, status::text AS status, created_at, updated_at FROM campuses`);
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export async function campusExists(db: Db, id: string): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM campuses WHERE id = $1`, [id])).rows.length > 0;
}

export async function nameTaken(db: Db, name: string, excludeId: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM partylists WHERE LOWER(name) = LOWER($1) AND CAST(status AS text) = 'ACTIVE' AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [name, excludeId],
  );
  return rows.length > 0;
}

export async function insert(db: Db, p: { name: string; description: string | null; campusId: string; schoolYear: string; posterImageUrl: string | null; posterLogoUrl: string | null; status: string }) {
  const { rows } = await db.query(
    `INSERT INTO partylists (name, description, campus_id, school_year, poster_image_url, poster_logo_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [p.name, p.description, p.campusId, p.schoolYear, p.posterImageUrl, p.posterLogoUrl, p.status],
  );
  return rows[0].id as string;
}

export const updateFields = (db: Db, p: PartylistJson) =>
  db.query(
    `UPDATE partylists SET name = $2, description = $3, school_year = $4, poster_image_url = $5, poster_logo_url = $6,
            campus_id = $7, updated_at = now() WHERE id = $1`,
    [p.id, p.name, p.description, p.schoolYear, p.posterImageUrl, p.posterLogoUrl, p.campus.id],
  );

export const setStatus = (db: Db, id: string, status: string) =>
  db.query(`UPDATE partylists SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);

export const deletePartylist = (db: Db, id: string) => db.query(`DELETE FROM partylists WHERE id = $1`, [id]);

// ---------------- members ----------------

export async function listMembers(db: Db, partylistId: string): Promise<MemberJson[]> {
  const { rows } = await db.query(
    `SELECT id, student_id, last_name, first_name, middle_name, position, campaign_image_url, background_image_url,
            photo_image_url, created_at, updated_at FROM partylist_members WHERE partylist_id = $1`,
    [partylistId],
  );
  return rows.map((r) => ({
    id: r.id, studentId: r.student_id, lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name,
    position: r.position, campaignImageUrl: r.campaign_image_url, backgroundImageUrl: r.background_image_url,
    photoImageUrl: r.photo_image_url, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export async function membersOf(db: Db, partylistIds: string[]): Promise<Map<string, MemberJson[]>> {
  const out = new Map<string, MemberJson[]>();
  if (!partylistIds.length) return out;
  const { rows } = await db.query(
    `SELECT partylist_id, id, student_id, last_name, first_name, middle_name, position, campaign_image_url, background_image_url,
            photo_image_url, created_at, updated_at FROM partylist_members WHERE partylist_id = ANY($1::uuid[])`, [partylistIds]);
  for (const r of rows) {
    if (!out.has(r.partylist_id)) out.set(r.partylist_id, []);
    out.get(r.partylist_id)!.push({
      id: r.id, studentId: r.student_id, lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name, position: r.position,
      campaignImageUrl: r.campaign_image_url, backgroundImageUrl: r.background_image_url, photoImageUrl: r.photo_image_url,
      createdAt: r.created_at, updatedAt: r.updated_at });
  }
  return out;
}

export const deleteMembers = (db: Db, partylistId: string) => db.query(`DELETE FROM partylist_members WHERE partylist_id = $1`, [partylistId]);

export const insertMember = (
  db: Db, partylistId: string,
  m: { studentId: string; lastName: string; firstName: string; middleName: string | null; position: string; campaignImageUrl: string | null; backgroundImageUrl: string | null; photoImageUrl: string | null },
) =>
  db.query(
    `INSERT INTO partylist_members (partylist_id, student_id, last_name, first_name, middle_name, position, campaign_image_url, background_image_url, photo_image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [partylistId, m.studentId, m.lastName, m.firstName, m.middleName, m.position, m.campaignImageUrl, m.backgroundImageUrl, m.photoImageUrl],
  );

/** voters row as the Voter entity JSON (used by the student lookup too) */
export async function findVoterByStudentId(db: Db, studentId: string) {
  const { rows } = await db.query(
    `SELECT id, auth_user_id, student_id, last_name, first_name, middle_name, full_name, email, program_course, year_level,
            section, campus_id, voting_status::text AS voting_status, time_voted, status::text AS status, created_at, updated_at, school_year
       FROM voters WHERE student_id = $1 LIMIT 1`,
    [studentId],
  );
  const r = rows[0];
  return r
    ? { id: r.id, authUserId: r.auth_user_id, studentId: r.student_id, lastName: r.last_name, firstName: r.first_name,
        middleName: r.middle_name, fullName: r.full_name, email: r.email, programCourse: r.program_course, yearLevel: r.year_level,
        section: r.section, campusId: r.campus_id, votingStatus: r.voting_status, timeVoted: r.time_voted, status: r.status,
        createdAt: r.created_at, updatedAt: r.updated_at, schoolYear: r.school_year }
    : null;
}

/** student already holds a seat in ANOTHER active partylist of the same school year */
export async function assignedElsewhere(db: Db, studentId: string, schoolYear: string, excludePartylistId: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM partylist_members pm JOIN partylists p ON p.id = pm.partylist_id
      WHERE pm.student_id = $1 AND p.school_year = $2 AND CAST(p.status AS text) = 'ACTIVE'
        AND ($3::uuid IS NULL OR p.id <> $3::uuid) LIMIT 1`,
    [studentId, schoolYear, excludePartylistId],
  );
  return rows.length > 0;
}

export async function linkedToActiveElection(db: Db, partylistId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM election_partylists ep JOIN elections e ON e.id = ep.election_id
      WHERE ep.partylist_id = $1 AND CAST(e.status AS text) = 'ACTIVE' AND (e.end_at IS NULL OR now() <= e.end_at) LIMIT 1`,
    [partylistId],
  );
  return rows.length > 0;
}

// ---------------- archive / trash records ----------------

export const insertArchive = (db: Db, r: { entityId: string; entityName: string; data: string; by: string | null }) =>
  db.query(
    `INSERT INTO archive_records (entity_type, entity_id, entity_name, data, archived_by, archived_at, is_restored)
     VALUES ('Partylists', $1, $2, $3::jsonb, $4, now(), false)`, [r.entityId, r.entityName, r.data, r.by]);

export const insertTrash = (db: Db, r: { entityId: string; entityName: string; data: string; by: string | null }) =>
  db.query(
    `INSERT INTO trash_records (entity_type, entity_id, entity_name, data, deleted_by, deleted_at, is_restored)
     VALUES ('Partylists', $1, $2, $3::jsonb, $4, now(), false)`, [r.entityId, r.entityName, r.data, r.by]);

export async function markRecordsRestored(db: Db, partylistId: string) {
  for (const table of ['archive_records', 'trash_records']) {
    await db.query(
      `UPDATE ${table} SET is_restored = true, restored_at = now()
        WHERE entity_type = 'Partylists' AND is_restored = false AND entity_id = $1`, [partylistId]);
  }
}

export const deleteTrashRecords = (db: Db, partylistId: string) =>
  db.query(`DELETE FROM trash_records WHERE entity_type = 'Partylists' AND is_restored = false AND entity_id = $1`, [partylistId]);

// ---------------- admin-ssc (campus-scoped) ----------------

export async function listByStatusAndCampus(db: Db, status: string, campusId: string): Promise<PartylistJson[]> {
  const { rows } = await db.query(
    `${SEL} WHERE CAST(p.status AS text) = $1 AND p.campus_id = $2::uuid`,
    [status, campusId],
  );
  return rows.map(mapPartylist);
}

/** Voter entity JSON for every ACTIVE voter of a campus (same shape as findVoterByStudentId). */
export async function listActiveVotersByCampus(db: Db, campusId: string) {
  const { rows } = await db.query(
    `SELECT id, auth_user_id, student_id, last_name, first_name, middle_name, full_name, email, program_course, year_level,
            section, campus_id, voting_status::text AS voting_status, time_voted, status::text AS status, created_at, updated_at, school_year
       FROM voters WHERE campus_id = $1::uuid AND CAST(status AS text) = 'ACTIVE'`,
    [campusId],
  );
  return rows.map((r) => ({
    id: r.id, authUserId: r.auth_user_id, studentId: r.student_id, lastName: r.last_name, firstName: r.first_name,
    middleName: r.middle_name, fullName: r.full_name, email: r.email, programCourse: r.program_course, yearLevel: r.year_level,
    section: r.section, campusId: r.campus_id, votingStatus: r.voting_status, timeVoted: r.time_voted, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at, schoolYear: r.school_year,
  }));
}