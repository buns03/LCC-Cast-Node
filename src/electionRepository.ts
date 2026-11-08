import { Pool, PoolClient } from 'pg';
import { pool } from './db';
import { termMatchSql } from './schoolTerm';

export type Db = Pool | PoolClient;
export type ElectionCategory = 'SSC' | 'DEPARTMENT';

export interface Election {
  id: string;
  title: string;
  category: ElectionCategory;
  campusId: string;
  schoolYear: string;
  startAt: Date | null;
  endAt: Date | null;
  status: string; // record_status: ACTIVE | ARCHIVED | DELETED
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  parentElectionId: string | null;
  drawPositions: string[] | null;
  drawCheckedAt: Date | null;
    semester: number | null;
}

/**
 * ASSUMPTION (Election.java was not shared): a "draw election" is one that has a parent election.
 * Change only this function if your entity defines it differently.
 */
export const isDrawElection = (e: Election): boolean => e.parentElectionId !== null;

const COLS = `id, title, category::text AS category, campus_id, school_year, start_at, end_at,
  status::text AS status, is_active, created_by, created_at, updated_at, parent_election_id, draw_positions, draw_checked_at, semester`;

const mapElection = (r: any): Election => ({
  id: r.id,
  title: r.title,
  category: r.category,
  campusId: r.campus_id,
  schoolYear: r.school_year,
  startAt: r.start_at,
  endAt: r.end_at,
  status: r.status,
  active: r.is_active === true,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  parentElectionId: r.parent_election_id,
  drawPositions: r.draw_positions ?? null,
  drawCheckedAt: r.draw_checked_at ?? null,
  semester: r.semester ?? null,
});

// ---------------- elections ----------------

export async function listByStatus(db: Db, status: string): Promise<Election[]> {
  const { rows } = await db.query(`SELECT ${COLS} FROM elections WHERE CAST(status AS text) = $1`, [status]);
  return rows.map(mapElection);
}

export async function listByCampusAndStatus(db: Db, campusId: string, status: string): Promise<Election[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM elections WHERE campus_id = $1 AND CAST(status AS text) = $2`,
    [campusId, status],
  );
  return rows.map(mapElection);
}

export async function findByIdAndStatus(db: Db, id: string, status: string): Promise<Election | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM elections WHERE id = $1 AND CAST(status AS text) = $2`, [id, status]);
  return rows[0] ? mapElection(rows[0]) : null;
}

export async function findById(db: Db, id: string): Promise<Election | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM elections WHERE id = $1`, [id]);
  return rows[0] ? mapElection(rows[0]) : null;
}

export async function insertElection(
  db: Db,
  e: { title: string; category: string; campusId: string; schoolYear: string; startAt: Date; endAt: Date; createdBy: string | null; semester?: number | null },
): Promise<Election> {
  const { rows } = await db.query(
    `INSERT INTO elections (title, category, campus_id, school_year, start_at, end_at, status, is_active, created_by, semester)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', true, $7, $8::smallint) RETURNING ${COLS}`,
    [e.title, e.category, e.campusId, e.schoolYear, e.startAt, e.endAt, e.createdBy, e.semester ?? null],
  );
  return mapElection(rows[0]);
}

export async function saveElection(db: Db, e: Election): Promise<Election> {
  const { rows } = await db.query(
    `UPDATE elections SET title = $2, category = $3, campus_id = $4, school_year = $5,
            start_at = $6, end_at = $7, status = $8, is_active = $9, semester = $10::smallint, updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [e.id, e.title, e.category, e.campusId, e.schoolYear, e.startAt, e.endAt, e.status, e.active, e.semester],
  );
  return mapElection(rows[0]);
}

export async function existsOtherByCategoryCampusYear(
  db: Db, category: string, campusId: string, schoolYear: string, status: string, excludeId: string,
  semester: number | null = null,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM elections WHERE CAST(category AS text) = $1 AND campus_id = $2 AND school_year = $3
        AND CAST(status AS text) = $4 AND id <> $5::uuid
        AND ($6::smallint IS NULL OR semester IS NULL OR semester = $6::smallint) LIMIT 1`,
    [category, campusId, schoolYear, status, excludeId, semester],
  );
  return rows.length > 0;
}

export async function listOtherByCategoryCampusYear(
  db: Db, category: string, campusId: string, schoolYear: string, status: string, excludeId: string,
  semester: number | null = null,
): Promise<Election[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM elections WHERE CAST(category AS text) = $1 AND campus_id = $2 AND school_year = $3
        AND CAST(status AS text) = $4 AND id <> $5::uuid
        AND ($6::smallint IS NULL OR semester IS NULL OR semester = $6::smallint)`,
    [category, campusId, schoolYear, status, excludeId, semester],
  );
  return rows.map(mapElection);
}

// ---------------- links: election_partylists / election_departments ----------------

export interface DepartmentRow {
  id: string;
  name: string | null;
  title: string | null;
  code: string | null;
  campusId: string;
  votingType: string | null; // PARTYLIST | REPRESENTATIVE
  positions: string[];
}

const DEPT_COLS = 'd.id, d.name, d.title, d.code, d.campus_id, d.voting_type, d.positions';
const mapDept = (r: any): DepartmentRow => ({
  id: r.id, name: r.name, title: r.title, code: r.code, campusId: r.campus_id, votingType: r.voting_type,
  positions: Array.isArray(r.positions) ? r.positions : [],
});

export async function partylistLinks(db: Db, electionId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query(
    `SELECT p.id, p.name FROM election_partylists ep JOIN partylists p ON p.id = ep.partylist_id
      WHERE ep.election_id = $1 ORDER BY ep.created_at, ep.id`,
    [electionId],
  );
  return rows;
}

export async function departmentLinks(db: Db, electionId: string): Promise<DepartmentRow[]> {
  const { rows } = await db.query(
    `SELECT ${DEPT_COLS} FROM election_departments ed JOIN departments d ON d.id = ed.department_id
      WHERE ed.election_id = $1 ORDER BY ed.created_at, ed.id`,
    [electionId],
  );
  return rows.map(mapDept);
}

export const deletePartylistLinks = (db: Db, electionId: string) =>
  db.query(`DELETE FROM election_partylists WHERE election_id = $1`, [electionId]);
export const deleteDepartmentLinks = (db: Db, electionId: string) =>
  db.query(`DELETE FROM election_departments WHERE election_id = $1`, [electionId]);
export const insertPartylistLink = (db: Db, electionId: string, partylistId: string) =>
  db.query(`INSERT INTO election_partylists (election_id, partylist_id) VALUES ($1, $2)`, [electionId, partylistId]);
export const insertDepartmentLink = (db: Db, electionId: string, departmentId: string) =>
  db.query(`INSERT INTO election_departments (election_id, department_id) VALUES ($1, $2)`, [electionId, departmentId]);

// ---------------- partylists / departments ----------------

export async function findPartylistCampusId(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT campus_id FROM partylists WHERE id = $1`, [id]);
  return rows[0]?.campus_id ?? null;
}

export async function findDepartment(db: Db, id: string): Promise<DepartmentRow | null> {
  const { rows } = await db.query(`SELECT ${DEPT_COLS} FROM departments d WHERE d.id = $1`, [id]);
  return rows[0] ? mapDept(rows[0]) : null;
}

export async function findDepartmentsByIds(db: Db, ids: string[]): Promise<DepartmentRow[]> {
  if (!ids.length) return [];
  const { rows } = await db.query(`SELECT ${DEPT_COLS} FROM departments d WHERE d.id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapDept);
}

// ---------------- members + candidates ----------------

export interface Member {
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  position: string | null;
  campaignImageUrl: string | null;
  backgroundImageUrl: string | null;
  photoImageUrl: string | null;
}

const MEMBER_COLS = `student_id, last_name, first_name, middle_name, position,
  campaign_image_url, background_image_url, photo_image_url`;
const mapMember = (r: any): Member => ({
  studentId: r.student_id, lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name,
  position: r.position, campaignImageUrl: r.campaign_image_url, backgroundImageUrl: r.background_image_url,
  photoImageUrl: r.photo_image_url,
});

export async function partylistMembers(db: Db, partylistId: string): Promise<Member[]> {
  const { rows } = await db.query(`SELECT ${MEMBER_COLS} FROM partylist_members WHERE partylist_id = $1`, [partylistId]);
  return rows.map(mapMember);
}

export async function departmentMembers(db: Db, departmentId: string): Promise<Member[]> {
  const { rows } = await db.query(`SELECT ${MEMBER_COLS} FROM department_members WHERE department_id = $1`, [departmentId]);
  return rows.map(mapMember);
}

export async function insertCandidate(
  db: Db,
  c: { electionId: string; partylistId?: string | null; departmentId?: string | null; member: Member; position: string | null },
): Promise<void> {
  const m = c.member;
  await db.query(
    `INSERT INTO candidates (election_id, partylist_id, department_id, student_id, last_name, first_name, middle_name,
                             position, campaign_image_url, background_image_url, photo_image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [c.electionId, c.partylistId ?? null, c.departmentId ?? null, m.studentId, m.lastName, m.firstName, m.middleName,
      c.position, m.campaignImageUrl, m.backgroundImageUrl, m.photoImageUrl],
  );
}

export const deleteCandidatesByElection = (db: Db, electionId: string) =>
  db.query(`DELETE FROM candidates WHERE election_id = $1`, [electionId]);

export async function candidatesOfElection(
  db: Db, electionId: string,
): Promise<{ id: string; studentId: string; partylistId: string | null; departmentId: string | null }[]> {
  const { rows } = await db.query(
    `SELECT id, student_id, partylist_id, department_id FROM candidates WHERE election_id = $1`, [electionId],
  );
  return rows.map((r) => ({ id: r.id, studentId: r.student_id, partylistId: r.partylist_id, departmentId: r.department_id }));
}

export async function findPartylistMember(db: Db, partylistId: string, studentId: string): Promise<Member | null> {
  const { rows } = await db.query(
    `SELECT ${MEMBER_COLS} FROM partylist_members WHERE partylist_id = $1 AND student_id = $2 LIMIT 1`, [partylistId, studentId]);
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function findDepartmentMember(db: Db, departmentId: string, studentId: string): Promise<Member | null> {
  const { rows } = await db.query(
    `SELECT ${MEMBER_COLS} FROM department_members WHERE department_id = $1 AND student_id = $2 LIMIT 1`, [departmentId, studentId]);
  return rows[0] ? mapMember(rows[0]) : null;
}

export const updateCandidateImages = (db: Db, candidateId: string, m: Member) =>
  db.query(
    `UPDATE candidates SET photo_image_url = $2, campaign_image_url = $3, background_image_url = $4 WHERE id = $1`,
    [candidateId, m.photoImageUrl, m.campaignImageUrl, m.backgroundImageUrl],
  );

// ---------------- archive / trash ----------------

export const insertArchiveRecord = (db: Db, r: { entityId: string; entityName: string; data: string; archivedBy: string | null }) =>
  db.query(
    `INSERT INTO archive_records (entity_type, entity_id, entity_name, data, archived_by, archived_at, is_restored)
     VALUES ('Elections', $1, $2, $3::jsonb, $4, now(), false)`,
    [r.entityId, r.entityName, r.data, r.archivedBy],
  );

export const insertTrashRecord = (db: Db, r: { entityId: string; entityName: string; data: string; deletedBy: string | null }) =>
  db.query(
    `INSERT INTO trash_records (entity_type, entity_id, entity_name, data, deleted_by, deleted_at, is_restored)
     VALUES ('Elections', $1, $2, $3::jsonb, $4, now(), false)`,
    [r.entityId, r.entityName, r.data, r.deletedBy],
  );

// ---------------- votes (ElectionVoteSyncService) ----------------

export async function voterIdsOfElection(db: Db, electionId: string): Promise<string[]> {
  const { rows } = await db.query(`SELECT DISTINCT voter_id FROM ballots WHERE election_id = $1`, [electionId]);
  return rows.map((r) => r.voter_id);
}

/**
 * voters.voting_status / time_voted follow their latest ballot in an ACTIVE election.
 * (Ballots of archived/deleted elections are kept but do not count.)
 */
export async function refreshVoters(db: Db, voterIds: string[]): Promise<void> {
  if (!voterIds.length) return;
  await db.query(
    `UPDATE voters v
        SET voting_status = (CASE WHEN lb.submitted_at IS NOT NULL THEN 'VOTED' ELSE 'NOT_VOTED' END)::voting_status,
            time_voted = lb.submitted_at,
            updated_at = now()
       FROM (SELECT id AS voter_id, school_year, semester FROM voters WHERE id = ANY($1::uuid[])) ids
       LEFT JOIN LATERAL (
              SELECT b.submitted_at FROM ballots b JOIN elections e ON e.id = b.election_id
               WHERE b.voter_id = ids.voter_id AND CAST(e.status AS text) = 'ACTIVE'
                 AND ${termMatchSql('ids', 'e')}
               ORDER BY b.submitted_at DESC LIMIT 1) lb ON true
      WHERE v.id = ids.voter_id`,
    [voterIds],
  );
}

// ---------------- email status (ElectionEmailService, eligibility only) ----------------

export async function countVotersByCampus(db: Db, campusId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM voters WHERE campus_id = $1 AND CAST(status AS text) = 'ACTIVE'`, [campusId]);
  return rows[0].n;
}

export async function countVotersByCampusAndPrograms(db: Db, campusId: string, codesLower: string[]): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM voters
      WHERE campus_id = $1 AND LOWER(program_course) = ANY($2::text[]) AND CAST(status AS text) = 'ACTIVE'`,
    [campusId, codesLower],
  );
  return rows[0].n;
}

export async function scheduledCampaign(db: Db, electionId: string): Promise<{ scheduledAt: Date | null } | null> {
  const { rows } = await db.query(
    `SELECT scheduled_at FROM election_email_campaigns
      WHERE election_id = $1 AND status = 'SCHEDULED' ORDER BY created_at DESC LIMIT 1`,
    [electionId],
  );
  return rows[0] ? { scheduledAt: rows[0].scheduled_at } : null;
}



// ---------------- draw elections (DrawElectionService) ----------------

/** Port of Election.getPhase(), reduced to what the server needs. */
export function phaseOf(e: Election): 'UNSCHEDULED' | 'CONCLUDED' | 'UPCOMING' | 'NOT_VISIBLE' | 'ONGOING' {
  if (!e.startAt || !e.endAt) return 'UNSCHEDULED';
  const now = Date.now();
  if (now > e.endAt.getTime()) return 'CONCLUDED';
  if (now < e.startAt.getTime()) {
    const daysUntilStart = Math.trunc((e.startAt.getTime() - now) / 86_400_000);
    return daysUntilStart <= 5 ? 'UPCOMING' : 'NOT_VISIBLE';
  }
  return 'ONGOING';
}

export async function insertDrawElection(
  db: Db,
  e: { title: string; category: string; campusId: string; schoolYear: string; createdBy: string | null; parentElectionId: string; drawPositions: string[] },
): Promise<Election> {
  const { rows } = await db.query(
    `INSERT INTO elections (title, category, campus_id, school_year, start_at, end_at, status, is_active, created_by, parent_election_id, draw_positions)
     VALUES ($1, $2, $3, $4, NULL, NULL, 'ACTIVE', true, $5, $6, $7::jsonb) RETURNING ${COLS}`,
    [e.title, e.category, e.campusId, e.schoolYear, e.createdBy, e.parentElectionId, JSON.stringify(e.drawPositions)],
  );
  return mapElection(rows[0]);
}

export async function listDueForDrawCheck(db: Db, cutoff: Date): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT id FROM elections WHERE CAST(status AS text) = 'ACTIVE' AND draw_checked_at IS NULL AND end_at < $1`, [cutoff]);
  return rows.map((r) => r.id);
}

export const markDrawChecked = (db: Db, id: string) =>
  db.query(`UPDATE elections SET draw_checked_at = now(), updated_at = now() WHERE id = $1`, [id]);

export async function existsChildElection(db: Db, parentId: string, status: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM elections WHERE parent_election_id = $1 AND CAST(status AS text) = $2 LIMIT 1`, [parentId, status]);
  return rows.length > 0;
}

export async function listByCategoryAndStatus(db: Db, category: string, status: string): Promise<Election[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM elections WHERE CAST(category AS text) = $1 AND CAST(status AS text) = $2`, [category, status]);
  return rows.map(mapElection);
}
