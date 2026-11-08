import { Request } from 'express';
import { pool } from './db';
import { auditLog } from './auditLog';
import { programCourseMatches } from './programCourse';
import * as voters from './voterService';
import { VoterRow } from './voterService';
import { currentSchoolYear, campusNameFromSection, termFromEdit} from './schoolTerm';

/** Port of the scoped parts of AdminDeptVoterApiController. Scope = the admin's own campus + department (from the session). */

export interface VoterScope { campusId: string; programCourse: string }
export interface Result { status: number; message?: string; voter?: Record<string, unknown> }

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** admin-dept responses have no SSC fields (same as Java's buildVoterResponse) */
const stripSsc = (r: Record<string, unknown>) => {
  const out = { ...r };
  delete out.sscVotingStatus;
  delete out.sscVotedAt;
  return out;
};
export const scopedResponses = async (rows: VoterRow[]) => (await voters.toResponseList(pool, rows)).map(stripSsc);

/** ASSUMPTION: VoterService.resolveProgramVariants was not shared. This returns every program_course
 *  spelling used by voters of the campus that matches the department (same rule the Node side uses elsewhere). */
export async function resolveProgramVariants(scope: VoterScope): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT program_course FROM voters WHERE campus_id = $1::uuid AND program_course IS NOT NULL`, [scope.campusId]);
  return rows.map((r) => r.program_course as string).filter((pc) => programCourseMatches(pc, scope.programCourse));
}

/** findByIdAndCampusAndProgramVariants(..., ACTIVE) */
export async function findOwned(id: string, scope: VoterScope): Promise<VoterRow | null> {
  if (!voters.isUuid(id)) return null;
  const programs = await resolveProgramVariants(scope);
  const { rows } = await pool.query(
    `SELECT * FROM voters WHERE id = $1::uuid AND campus_id = $2::uuid AND status = 'ACTIVE' AND program_course = ANY($3::text[])`,
    [id, scope.campusId, programs]);
  return (rows[0] as VoterRow | undefined) ?? null;
}

export async function listScoped(scope: VoterScope): Promise<Record<string, unknown>[]> {
  const programs = await resolveProgramVariants(scope);
  const { rows } = await pool.query(
    `SELECT * FROM voters WHERE campus_id = $1::uuid AND status = 'ACTIVE' AND program_course = ANY($2::text[])`,
    [scope.campusId, programs]);
  return scopedResponses(rows as VoterRow[]);
}

// ---------------- page + facets ----------------

const toVotedFlag = (s: string | null): boolean | null => {
  if (!s || !s.trim()) return null;
  const t = s.trim().toLowerCase();
  if (t.includes('not')) return false;
  if (t.includes('voted')) return true;
  return null;
};

export interface PageQuery {
  page: number; size: number; yearLevel: string | null; section: string | null; search: string | null; schoolYear: string | null;
  departmentStatus: string | null; nameSort: string; timeSort: string;
}

export async function getPage(scope: VoterScope, q: PageQuery) {
  const programs = await resolveProgramVariants(scope);
  const { rows, total } = await voters.searchVoters({
        filter: { campusId: scope.campusId, programs, yearLevel: q.yearLevel, section: q.section, search: q.search, schoolYear: q.schoolYear },
    sscVoted: null,
    deptVoted: toVotedFlag(q.departmentStatus),
    deptProgram: scope.programCourse,
    nameSort: voters.normalizeNameSort(q.nameSort),
    timeSort: voters.normalizeTimeSort(q.timeSort),
    page: q.page,
    size: q.size,
  });
  return { content: await scopedResponses(rows), totalElements: total, totalPages: Math.ceil(total / q.size), page: q.page };
}

export async function getFacets(scope: VoterScope) {
  const programs = await resolveProgramVariants(scope);
  const distinct = async (col: 'section' | 'year_level' | 'school_year') =>
    (await pool.query(
      `SELECT DISTINCT ${col} AS v FROM voters
        WHERE status = 'ACTIVE' AND campus_id = $1::uuid AND program_course = ANY($2::text[]) AND ${col} IS NOT NULL
        ORDER BY ${col}${col === 'school_year' ? ' DESC' : ''}`, [scope.campusId, programs])).rows.map((r) => r.v as string);

  const schoolYears = await distinct('school_year');
  const cur = currentSchoolYear();
  return {
    sections: await distinct('section'),
    yearLevels: await distinct('year_level'),
    schoolYears,
    currentSchoolYear: schoolYears.includes(cur) ? cur : (schoolYears[0] ?? null),
  };
}

// ---------------- update: campus + program are NEVER taken from the body ----------------

export async function updateOwned(id: string, body: Record<string, unknown>, scope: VoterScope, req: Request): Promise<Result> {
  const existing = await findOwned(id, scope);
  if (!existing) return { status: 404 };

  const studentId = str(body.studentId);
  if (!studentId) return { status: 400, message: 'Student ID is required.' };

  const dup = await pool.query(`SELECT id FROM voters WHERE student_id = $1 LIMIT 1`, [studentId]);
  if (dup.rows[0] && dup.rows[0].id !== existing.id) return { status: 400, message: 'This Student ID is already registered.' };
      const edit = termFromEdit(body, { schoolYear: existing.school_year, semester: existing.semester });
    if ('error' in edit) return { status: 400, message: edit.error };

  let saved: VoterRow;
  try {
    saved = (await pool.query(
            `UPDATE voters SET student_id = $2, last_name = $3, first_name = $4, middle_name = $5, full_name = $6,
              email = $7, year_level = $8, section = $9, school_year = $10, semester = $11::smallint, updated_at = now()
        WHERE id = $1::uuid RETURNING *`,
      [existing.id, studentId, str(body.lastName), str(body.firstName), str(body.middleName), str(body.fullName),
       str(body.email), str(body.yearLevel), str(body.section), edit.term.schoolYear, edit.term.semester],
    )).rows[0] as VoterRow;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { status: 400, message: 'This Student ID is already registered.' };
    throw e;
  }

  await auditLog(pool, req, 'UPDATE', 'Students', saved.id, `Updated voter ${saved.student_id}`, {
    studentId: saved.student_id, fullName: saved.full_name,
  });
  return { status: 200, voter: stripSsc(await voters.toResponse(pool, saved)) };
}

// ---------------- restore: voter may be ARCHIVED / DELETED, so it is checked by campus + program, not by status ----------------

export async function restoreScoped(id: string, scope: VoterScope, req: Request): Promise<Result> {
  if (!voters.isUuid(id)) return { status: 404 };
  const v = (await pool.query(`SELECT * FROM voters WHERE id = $1::uuid`, [id])).rows[0] as VoterRow | undefined;
  if (!v || v.campus_id.toLowerCase() !== scope.campusId.toLowerCase() || !programCourseMatches(v.program_course, scope.programCourse)) {
    return { status: 404 };
  }
  if (v.status !== 'DELETED' && v.status !== 'ARCHIVED') {
    return { status: 400, message: 'Only deleted or archived voters can be restored.' };
  }
  const restored = await voters.restoreVoter(id, req);
  if (!restored) return { status: 404 };
  return { status: 200, voter: stripSsc(await voters.toResponse(pool, restored)) };
}

// ---------------- bulk helpers ----------------

/** keeps only the ids that are ACTIVE voters of this admin's campus + department */
export async function filterToScope(ids: unknown, scope: VoterScope): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const valid = [...new Set(ids.filter(voters.isUuid))];
  if (!valid.length) return [];
  const programs = await resolveProgramVariants(scope);
  const { rows } = await pool.query(
    `SELECT id FROM voters WHERE id = ANY($1::uuid[]) AND campus_id = $2::uuid AND status = 'ACTIVE' AND program_course = ANY($3::text[])`,
    [valid, scope.campusId, programs]);
  return rows.map((r) => r.id as string);
}

export interface BulkFilter { yearLevel?: unknown; section?: unknown; search?: unknown; schoolYear?: unknown}

export async function idsMatching(scope: VoterScope, f: BulkFilter): Promise<string[]> {
  const programs = await resolveProgramVariants(scope);
  return voters.findIdsMatching({
    campusId: scope.campusId, programs,
    yearLevel: voters.blankToNull(f.yearLevel), section: voters.blankToNull(f.section), search: voters.blankToNull(f.search), schoolYear: voters.blankToNull(f.schoolYear),
  });
}

// ---------------- import: campus + program are forced to this admin's scope ----------------

export async function scopeImportRows(rows: Record<string, unknown>[], scope: VoterScope) {
  const campusName: string | null =
    (await pool.query(`SELECT name FROM campuses WHERE id = $1::uuid`, [scope.campusId])).rows[0]?.name ?? null;

  const scopedRows: Record<string, unknown>[] = [];
  const skipErrors: string[] = [];
  let outOfScope = 0;

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rowCampus = str(row.campus);
    const rowProgram = str(row.programCourse);

    if (rowCampus && campusName != null && rowCampus.toLowerCase() !== campusName.trim().toLowerCase()) {
      skipErrors.push(`Row ${rowNumber}: Skipped — student belongs to campus "${rowCampus}", not your campus ("${campusName}").`);
      outOfScope++;
      return;
    }
        const section = str(row.section);
    if (!rowCampus && section && campusName != null) {
      const derived = campusNameFromSection(section);
      if (!derived) {
        skipErrors.push(`Row ${rowNumber}: Skipped — cannot tell the campus from section "${section}".`);
        outOfScope++;
        return;
      }
      if (derived.toLowerCase() !== campusName.trim().toLowerCase()) {
        skipErrors.push(`Row ${rowNumber}: Skipped — section "${section}" belongs to campus "${derived}", not your campus ("${campusName}").`);
        outOfScope++;
        return;
      }
    }
    if (rowProgram && !programCourseMatches(rowProgram, scope.programCourse)) {
      skipErrors.push(`Row ${rowNumber}: Skipped — student belongs to course "${rowProgram}", not your department ("${scope.programCourse}").`);
      outOfScope++;
      return;
    }
    scopedRows.push({ ...row, campusId: scope.campusId, programCourse: rowProgram || scope.programCourse });
  });

  return { scopedRows, skipErrors, outOfScope };
}

// ---------------- CSV export ----------------

export const CSV_HEADER =
  'Student ID,Full Name,Course,Year Level,Section,Campus,Email,Department Voting Status,Department Time Voted\n';

const cell = (v: unknown) =>
  `"${String(v == null ? '' : v instanceof Date ? v.toISOString() : v).replace(/"/g, '""')}"`;

export async function csvRowsFor(ids: string[]): Promise<string> {
  if (!ids.length) return '';
  const rows = (await pool.query(`SELECT * FROM voters WHERE id = ANY($1::uuid[])`, [ids])).rows as VoterRow[];
  return (await voters.toResponseList(pool, rows))
    .map((r) =>
      [r.studentId, r.fullName, r.programCourse, r.yearLevel, r.section, r.campus, r.email, r.departmentVotingStatus, r.departmentVotedAt]
        .map(cell).join(',') + '\n')
    .join('');
}