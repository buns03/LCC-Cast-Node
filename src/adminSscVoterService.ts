import { Request } from 'express';
import { pool } from './db';
import { IllegalArgumentError } from './errors';
import { findCampusName } from './repositories';
import {
  ImportResult,
  VoterFilter,
  VoterRow,
  blankToNull,
  findIdsMatching,
  getFacets as getFacetsBase,
  importVoters,
  isUuid,
  moveVoter,
  moveVoters,
  normalizeNameSort,
  normalizeTimeSort,
  restoreVoter as restoreVoterBase,
  searchVoters,
  toResponse,
  toResponseList,
  updateVoter as updateVoterBase,
} from './voterService'; // ← CHECK PATH
import { campusNameFromSection } from './schoolTerm';

/** Java RuntimeException("Voter not found." / "You are not authorized ...") */
export class VoterAccessError extends Error {}

export interface BulkFilter {
  program?: unknown;
  yearLevel?: unknown;
  section?: unknown;
  search?: unknown;
    schoolYear?: unknown;
}

const sameId = (a: unknown, b: string) => String(a ?? '').toLowerCase() === b.toLowerCase();

function toFilter(campusId: string, f: BulkFilter): VoterFilter {
  return {
    campusId,
    program: blankToNull(f.program),
    yearLevel: blankToNull(f.yearLevel),
    section: blankToNull(f.section),
    search: blankToNull(f.search),
        schoolYear: blankToNull(f.schoolYear),
  };
}

async function requireOwned(id: string, campusId: string): Promise<VoterRow> {
  const { rows } = await pool.query(`SELECT * FROM voters WHERE id = $1::uuid AND status = 'ACTIVE'`, [id]);
  const voter = rows[0] as VoterRow | undefined;
  if (!voter) throw new VoterAccessError('Voter not found.');
  if (!sameId(voter.campus_id, campusId)) throw new VoterAccessError('You are not authorized to access this voter.');
  return voter;
}

async function filterOwnedIds(ids: string[], campusId: string): Promise<string[]> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return [];
  const { rows } = await pool.query(
    `SELECT id FROM voters WHERE id = ANY($1::uuid[]) AND campus_id = $2::uuid`,
    [valid, campusId],
  );
  return rows.map((r) => r.id as string);
}

function toVotedFlag(status: string | null): boolean | null {
  if (!status || !status.trim()) return null;
  const s = status.trim().toLowerCase().replace(/[_-]/g, ' ').trim();
  if (s === 'voted') return true;
  if (s === 'not voted') return false;
  return null;
}

// ============ READ ============

export async function getActiveForCampus(campusId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM voters WHERE campus_id = $1::uuid AND status = 'ACTIVE' ORDER BY LOWER(full_name), id`,
    [campusId],
  );
  return toResponseList(pool, rows as VoterRow[]);
}

export async function getPageForCampus(o: {
  campusId: string;
  page: number;
  size: number;
  program: string | null;
  yearLevel: string | null;
  section: string | null;
  search: string | null;
    schoolYear: string | null;
  sscStatus: string | null;
  nameSort: string | null;
  timeSort: string | null;
}) {
  const { rows, total } = await searchVoters({
    filter: toFilter(o.campusId, o),
    sscVoted: toVotedFlag(o.sscStatus),
    deptVoted: null,
    nameSort: normalizeNameSort(o.nameSort),
    timeSort: normalizeTimeSort(o.timeSort),
    timeCategory: 'SSC', // Java: "SSC admin only sees SSC vote time"
    page: o.page,
    size: o.size,
  });

  return {
    content: await toResponseList(pool, rows),
    totalElements: total,
    totalPages: Math.ceil(total / o.size),
    page: o.page,
  };
}

export const getFacets = getFacetsBase; // (campusId, programs[]) -> { programs, sections }

export async function getById(id: string, campusId: string) {
  return toResponse(pool, await requireOwned(id, campusId));
}

export async function getByStudentId(studentId: string, campusId: string) {
  const { rows } = await pool.query(`SELECT * FROM voters WHERE student_id = $1 LIMIT 1`, [studentId.trim()]);
  const v = rows[0] as VoterRow | undefined;
  if (!v || v.status !== 'ACTIVE' || !sameId(v.campus_id, campusId)) return null;
  return toResponse(pool, v);
}

export const findIdsMatchingForCampus = (campusId: string, f: BulkFilter) => findIdsMatching(toFilter(campusId, f));

export async function exportMatching(campusId: string, f: BulkFilter) {
  const ids = await findIdsMatchingForCampus(campusId, f);
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT * FROM voters WHERE id = ANY($1::uuid[]) ORDER BY LOWER(full_name), id`,
    [ids],
  );
  return toResponseList(pool, rows as VoterRow[]);
}

// ============ BULK BY FILTER ============

export async function archiveAllMatching(campusId: string, f: BulkFilter, req: Request): Promise<number> {
  return moveVoters('archive', await findIdsMatchingForCampus(campusId, f), req);
}

export async function deleteAllMatching(campusId: string, f: BulkFilter, req: Request): Promise<number> {
  return moveVoters('trash', await findIdsMatchingForCampus(campusId, f), req);
}

export async function archiveAllInCampus(campusId: string, ids: string[], req: Request): Promise<number> {
  return moveVoters('archive', await filterOwnedIds(ids, campusId), req);
}

export async function deleteAllInCampus(campusId: string, ids: string[], req: Request): Promise<number> {
  return moveVoters('trash', await filterOwnedIds(ids, campusId), req);
}

// ============ WRITE ============

export async function update(id: string, campusId: string, body: Record<string, unknown>, req: Request) {
  await requireOwned(id, campusId);
  // Campus is NOT taken from the request: it's locked to the admin's own campus.
  return updateVoterBase(id, { ...body, campusId }, req);
}

export async function archive(id: string, campusId: string, req: Request): Promise<void> {
  await requireOwned(id, campusId);
  await moveVoter('archive', id, req);
}

export async function trash(id: string, campusId: string, req: Request): Promise<void> {
  await requireOwned(id, campusId);
  await moveVoter('trash', id, req);
}

export async function restore(id: string, campusId: string, req: Request): Promise<void> {
  const { rows } = await pool.query(`SELECT campus_id, status::text AS status FROM voters WHERE id = $1::uuid`, [id]);
  const v = rows[0];
  if (!v) throw new VoterAccessError('Voter not found.');
  if (!sameId(v.campus_id, campusId)) throw new VoterAccessError('You are not authorized to restore this voter.');
  if (v.status !== 'DELETED' && v.status !== 'ARCHIVED') {
    throw new IllegalArgumentError('Only deleted or archived voters can be restored.');
  }
  await restoreVoterBase(id, req);
}

export async function importForCampus(
  campusId: string,
  rows: Record<string, unknown>[],
  req: Request,
): Promise<ImportResult> {
  const campusName = await findCampusName(campusId);

  const scopedRows: Record<string, unknown>[] = [];
  const skipErrors: string[] = [];
  let skippedForCampusMismatch = 0;

    rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rowCampus = String(row?.campus ?? '').trim();
    const section = String(row?.section ?? '').trim();

    if (rowCampus && campusName && rowCampus.toLowerCase() !== campusName.trim().toLowerCase()) {
      skipErrors.push(
        `Row ${rowNumber}: Skipped — student belongs to campus "${rowCampus}", not your campus ("${campusName}").`,
      );
      skippedForCampusMismatch++;
      return;
    }

    // no Campus column in the file -> work it out from the section (BSIS1A = Kaypian, BSIS1-MZN = Muzon)
    if (!rowCampus && section) {
      const derived = campusNameFromSection(section);
      if (!derived) {
        skipErrors.push(`Row ${rowNumber}: Skipped — cannot tell the campus from section "${section}".`);
        skippedForCampusMismatch++;
        return;
      }
      if (campusName && derived.toLowerCase() !== campusName.trim().toLowerCase()) {
        skipErrors.push(
          `Row ${rowNumber}: Skipped — section "${section}" belongs to campus "${derived}", not your campus ("${campusName}").`,
        );
        skippedForCampusMismatch++;
        return;
      }
    }

    scopedRows.push({ ...row, campusId });
  });

  const result = await importVoters(scopedRows, req);

  return {
    added: result.added,
    updated: result.updated,
    skipped: result.skipped + skippedForCampusMismatch,
    errors: [...skipErrors, ...result.errors],
  };
}

// ============ CSV (same columns as the Java writeVotersCsv, SSC version) ============

export const VOTERS_CSV_HEADER =
  'Student ID,Full Name,Course,Year Level,Section,Campus,Email,SSC Voting Status,SSC Time Voted\n';

const csvCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
const stamp = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export function csvRow(v: Record<string, unknown>): string {
  return (
    [v.studentId, v.fullName, v.programCourse, v.yearLevel, v.section, v.campus, v.email, v.sscVotingStatus, stamp(v.sscVotedAt)]
      .map(csvCell)
      .join(',') + '\n'
  );
}