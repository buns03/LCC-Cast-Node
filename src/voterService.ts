import { Request } from "express";
import type { PoolClient } from "pg";
import { pool } from "./db"; // ← CHECK PATH (file that exports `pool`)
import { Db } from "./electionRepository";
import { auditLog } from "./auditLog"; // ← CHECK PATH (file that exports `auditLog`)
import { getAuthUserId } from "./auth/sessionUser"; // ← CHECK PATH (file that exports `getAuthUserId`)
import { realtime, publish } from "./realtime";
import * as supabaseAuth from "./supabaseAuth"; // ← CHECK PATH (file with supabaseLogin/updatePassword)
import { toDepartmentCode } from "./programCourse";
import {
  parseTerm,
  currentSchoolYear,
  compareTerm,
  formatTerm,
  electionMatchesTerm,
  termMatchSql,
  campusNameFromSection,
  Term,
  termFromEdit,
} from "./schoolTerm";
import {
  resolveDepartmentElectionId,
  listDepartmentElectionIds,
} from "./voterDepartmentElection";
import { diffFields } from "./auditDiff";

// ---------------------------------------------------------------- helpers

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);
export const blankToNull = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const iso = (d: Date | null): string | null =>
  d ? new Date(d).toISOString() : null;

export interface VoterRow {
  id: string;
  auth_user_id: string | null;
  student_id: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  full_name: string;
  email: string | null;
  program_course: string | null;
  year_level: string | null;
  section: string | null;
  campus_id: string;
  voting_status: string;
  time_voted: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  school_year: string | null;
  semester: number | null;
}

async function withTx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function notifyDashboard(campusId: string | null | undefined): void {
  if (!campusId) return;
  try {
    realtime.dashboardChanged(campusId, null);
  } catch (e) {
    console.error(
      "[voters] realtime.dashboardChanged failed:",
      (e as Error).message,
    );
  }
}

export const normalizeNameSort = (v: unknown) =>
  v === "A-Z" || v === "Z-A" ? (v as string) : "default";
export const normalizeTimeSort = (v: unknown) =>
  v === "Newest" || v === "Oldest" ? (v as string) : "default";

async function getVoterById(db: Db, id: string): Promise<VoterRow | null> {
  const r = await db.query(`SELECT * FROM voters WHERE id = $1::uuid`, [id]);
  return (r.rows[0] as VoterRow | undefined) ?? null;
}

// ---------------------------------------------------------------- filters

export interface VoterFilter {
  campusId?: string | null;
  program?: string | null;
  programs?: string[] | null; // admin-dept: every program_course spelling that matches the department
  yearLevel?: string | null;
  section?: string | null;
  search?: string | null;
  schoolYear?: string | null;
}

function baseWhere(f: VoterFilter, params: unknown[]): string[] {
  const where = [`v.status = 'ACTIVE'`];
  if (f.campusId) {
    params.push(f.campusId);
    where.push(`v.campus_id = $${params.length}::uuid`);
  }
  if (f.program) {
    params.push(f.program);
    where.push(`v.program_course = $${params.length}`);
  }
  if (f.programs) {
    params.push(f.programs);
    where.push(`v.program_course = ANY($${params.length}::text[])`);
  }
  if (f.yearLevel) {
    params.push(f.yearLevel);
    where.push(`v.year_level = $${params.length}`);
  }
  if (f.section) {
    params.push(f.section);
    where.push(`v.section = $${params.length}`);
  }
  if (f.schoolYear) {
    params.push(f.schoolYear);
    where.push(`v.school_year = $${params.length}`);
  }
  if (f.search) {
    params.push(f.search.toLowerCase());
    const p = `$${params.length}::text`;
    where.push(
      `(LOWER(v.full_name) LIKE '%' || ${p} || '%' OR LOWER(v.student_id) LIKE '%' || ${p} || '%')`,
    );
  }
  return where;
}

export async function findIdsMatching(f: VoterFilter): Promise<string[]> {
  const params: unknown[] = [];
  const where = baseWhere(f, params).join(" AND ");
  const r = await pool.query(
    `SELECT v.id FROM voters v WHERE ${where}`,
    params,
  );
  return r.rows.map((x) => x.id as string);
}

// /** First ACTIVE SSC election per campus (Java: findByCampusIdAndCategoryAndStatus(...).findFirst()). */
// async function sscElectionIds(
//   db: Db,
//   campusId: string | null,
// ): Promise<string[]> {
//   const params: unknown[] = [];
//   let campusSql = "";
//   if (campusId) {
//     params.push(campusId);
//     campusSql = `AND e.campus_id = $1::uuid`;
//   }
//   const r = await db.query(
//     `SELECT DISTINCT ON (e.campus_id) e.id
//        FROM elections e
//       WHERE e.category::text = 'SSC' AND e.status::text = 'ACTIVE' ${campusSql}
//       ORDER BY e.campus_id, e.created_at ASC`,
//     params,
//   );
//   return r.rows.map((x) => x.id as string);
// }

// /** Port of resolveDepartmentVotedVoterIds, but returns election ids (the SQL does the voter lookup). */
// async function departmentVotedElectionIds(
//   db: Db,
//   campusId: string | null,
//   program: string | null,
// ): Promise<string[]> {
//   const campusIds: string[] = campusId
//     ? [campusId]
//     : (await db.query(`SELECT id FROM campuses`)).rows.map(
//         (x) => x.id as string,
//       );

//   const out = new Set<string>();
//   for (const cid of campusIds) {
//     const programs: string[] = program
//       ? [program]
//       : (
//           await db.query(
//             `SELECT DISTINCT program_course FROM voters
//             WHERE status = 'ACTIVE' AND campus_id = $1::uuid AND program_course IS NOT NULL`,
//             [cid],
//           )
//         ).rows.map((x) => x.program_course as string);

//     const codes = new Set(programs.map(toDepartmentCode).filter((c) => c));
//     for (const code of codes) {
//       const eid = await resolveDepartmentElectionId(db, cid, code);
//       if (eid) out.add(eid);
//     }
//   }
//   return [...out];
// }

async function departmentElectionIds(
  db: Db,
  campusId: string | null,
  program: string | null,
): Promise<string[]> {
  const campusIds: string[] = campusId
    ? [campusId]
    : (await db.query(`SELECT id FROM campuses`)).rows.map(
        (x) => x.id as string,
      );
  const out = new Set<string>();
  for (const cid of campusIds) {
    const programs: string[] = program
      ? [program]
      : (
          await db.query(
            `SELECT DISTINCT program_course FROM voters WHERE status = 'ACTIVE' AND campus_id = $1::uuid AND program_course IS NOT NULL`,
            [cid],
          )
        ).rows.map((x) => x.program_course as string);
    const codes = new Set(programs.map(toDepartmentCode).filter((c) => c));
    for (const code of codes)
      (await listDepartmentElectionIds(db, cid, code)).forEach((id) =>
        out.add(id),
      );
  }
  return [...out];
}

export interface SearchOptions {
  filter: VoterFilter;
  sscVoted: boolean | null;
  deptVoted: boolean | null;
  deptProgram?: string | null; // admin-dept: program used to find the department election
  timeCategory?: string | null;
  nameSort: string;
  timeSort: string;
  page: number;
  size: number;
}

export async function searchVoters(
  o: SearchOptions,
): Promise<{ rows: VoterRow[]; total: number }> {
  const params: unknown[] = [];
  const where = baseWhere(o.filter, params);

  if (o.sscVoted !== null) {
    where.push(
      `${o.sscVoted ? "" : "NOT "}EXISTS (SELECT 1 FROM vote_logs vl JOIN elections e ON e.id = vl.election_id
       WHERE vl.voter_id = v.id AND e.category::text = 'SSC' AND e.status::text = 'ACTIVE'
         AND e.campus_id = v.campus_id AND ${termMatchSql("v", "e")})`,
    );
  }
  if (o.deptVoted !== null) {
    params.push(
      await departmentElectionIds(
        pool,
        o.filter.campusId ?? null,
        o.deptProgram ?? o.filter.program ?? null,
      ),
    );
    where.push(
      `${o.deptVoted ? "" : "NOT "}EXISTS (SELECT 1 FROM vote_logs vl JOIN elections e ON e.id = vl.election_id
       WHERE vl.voter_id = v.id AND vl.election_id = ANY($${params.length}::uuid[]) AND ${termMatchSql("v", "e")})`,
    );
  }
  const whereSql = where.join(" AND ");

  const total = (
    await pool.query(
      `SELECT COUNT(*)::int AS n FROM voters v WHERE ${whereSql}`,
      params,
    )
  ).rows[0].n as number;

  // nameSort/timeSort are whitelisted by normalize*Sort, so they are safe to put in the SQL text.
  const order: string[] = [];
  if (o.timeSort === "Newest" || o.timeSort === "Oldest") {
    let categorySql = "";
    if (o.timeCategory) {
      params.push(o.timeCategory);
      categorySql = `AND e.category::text = $${params.length}`;
    }
    order.push(
      `(SELECT MAX(vl.voted_at) FROM vote_logs vl JOIN elections e ON e.id = vl.election_id
         WHERE vl.voter_id = v.id AND e.status::text = 'ACTIVE' ${categorySql}) ${o.timeSort === "Newest" ? "DESC" : "ASC"} NULLS LAST`,
    );
  }
  if (o.nameSort === "A-Z") order.push("LOWER(v.full_name) ASC");
  if (o.nameSort === "Z-A") order.push("LOWER(v.full_name) DESC");
  order.push("v.id ASC");

  const limitIdx = params.length + 1;
  const rows = (
    await pool.query(
      `SELECT v.* FROM voters v WHERE ${whereSql} ORDER BY ${order.join(", ")} LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
      [...params, o.size, o.page * o.size],
    )
  ).rows as VoterRow[];

  return { rows, total };
}

export async function getFacets(campusId: string | null, programs: string[]) {
  const progs = (
    await pool.query(
      `SELECT DISTINCT program_course FROM voters
        WHERE status = 'ACTIVE' AND ($1::uuid IS NULL OR campus_id = $1::uuid) AND program_course IS NOT NULL
        ORDER BY program_course`,
      [campusId],
    )
  ).rows.map((r) => r.program_course as string);

  const sections = (
    await pool.query(
      `SELECT DISTINCT section FROM voters
        WHERE status = 'ACTIVE' AND ($1::uuid IS NULL OR campus_id = $1::uuid)
          AND ($2::text[] IS NULL OR program_course = ANY($2::text[])) AND section IS NOT NULL
        ORDER BY section`,
      [campusId, programs.length ? programs : null],
    )
  ).rows.map((r) => r.section as string);

  const schoolYears = (
    await pool.query(
      `SELECT DISTINCT school_year FROM voters
    WHERE status = 'ACTIVE' AND ($1::uuid IS NULL OR campus_id = $1::uuid) AND school_year IS NOT NULL
    ORDER BY school_year DESC`,
      [campusId],
    )
  ).rows.map((r) => r.school_year as string);
  const cur = currentSchoolYear();
  return {
    programs: progs,
    sections,
    schoolYears,
    currentSchoolYear: schoolYears.includes(cur)
      ? cur
      : (schoolYears[0] ?? null),
  };
}

// ---------------------------------------------------------------- response mapping (toResponseList / toResponse)

export async function toResponseList(
  db: Db,
  voters: VoterRow[],
): Promise<Record<string, unknown>[]> {
  if (!voters.length) return [];

  const campusIds = [
    ...new Set(voters.map((v) => v.campus_id).filter(Boolean)),
  ];
  const campusNames = new Map<string, string>();
  (
    await db.query(`SELECT id, name FROM campuses WHERE id = ANY($1::uuid[])`, [
      campusIds,
    ])
  ).rows.forEach((r) => campusNames.set(r.id, r.name));

  const sscRows = (
    await db.query(
      `SELECT id, campus_id, school_year, semester FROM elections
    WHERE category::text = 'SSC' AND status::text = 'ACTIVE' AND campus_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [campusIds],
    )
  ).rows;
  const sscByVoter = new Map<string, string>();
  const deptCache = new Map<string, string | null>();
  const deptByVoter = new Map<string, string>();
  for (const v of voters) {
    const t: Term = { schoolYear: v.school_year, semester: v.semester };
    const s = sscRows.find(
      (e) => e.campus_id === v.campus_id && electionMatchesTerm(e, t),
    );
    if (s) sscByVoter.set(v.id, s.id);

    const key = `${v.campus_id}|${v.program_course}|${v.school_year}|${v.semester}`;
    if (!deptCache.has(key))
      deptCache.set(
        key,
        await resolveDepartmentElectionId(db, v.campus_id, v.program_course, t),
      );
    const eid = deptCache.get(key);
    if (eid) deptByVoter.set(v.id, eid);
  }
  const electionIds = new Set<string>([
    ...sscByVoter.values(),
    ...deptByVoter.values(),
  ]);
  const votedAt = new Map<string, Date>();
  if (electionIds.size) {
    const logs = await db.query(
      `SELECT election_id, voter_id, voted_at FROM vote_logs
        WHERE election_id = ANY($1::uuid[]) AND voter_id = ANY($2::uuid[]) ORDER BY voted_at ASC`,
      [[...electionIds], voters.map((v) => v.id)],
    );
    for (const l of logs.rows) {
      const key = `${l.election_id}|${l.voter_id}`;
      if (!votedAt.has(key)) votedAt.set(key, l.voted_at);
    }
  }

  return voters.map((v) => {
    const sscEid = sscByVoter.get(v.id);
    const sscAt = sscEid ? (votedAt.get(`${sscEid}|${v.id}`) ?? null) : null;
    const deptEid = deptByVoter.get(v.id);
    const deptAt = deptEid ? (votedAt.get(`${deptEid}|${v.id}`) ?? null) : null;
    return {
      id: v.id,
      studentId: v.student_id,
      lastName: v.last_name,
      firstName: v.first_name,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      middleName: v.middle_name ?? "",
      fullName: v.full_name,
      email: v.email ?? "",
      programCourse: v.program_course ?? "",
      yearLevel: v.year_level ?? "",
      section: v.section ?? "",
      campusId: v.campus_id,
      campus: campusNames.get(v.campus_id) ?? "Unknown",
      sscVotingStatus: sscAt ? "VOTED" : "NOT_VOTED",
      sscVotedAt: sscAt,
      departmentVotingStatus: deptAt ? "VOTED" : "NOT_VOTED",
      departmentVotedAt: deptAt,
      status: v.status,
      schoolYear: v.school_year ?? "",
      semester: v.semester,
    };
  });
}

export async function toResponse(db: Db, voter: VoterRow) {
  return (await toResponseList(db, [voter]))[0];
}

// ---------------------------------------------------------------- archive / trash

type Kind = "archive" | "trash";
const KINDS = {
  archive: {
    table: "archive_records",
    byCol: "archived_by",
    atCol: "archived_at",
    status: "ARCHIVED",
    action: "ARCHIVE" as const,
  },
  trash: {
    table: "trash_records",
    byCol: "deleted_by",
    atCol: "deleted_at",
    status: "DELETED",
    action: "DELETE" as const,
  },
};

/** Same fields, same order as VoterService.voterSnapshot. Taken BEFORE the status changes. */
function snapshot(v: VoterRow) {
  return {
    id: v.id,
    studentId: v.student_id,
    lastName: v.last_name,
    firstName: v.first_name,
    middleName: v.middle_name,
    fullName: v.full_name,
    email: v.email,
    programCourse: v.program_course,
    yearLevel: v.year_level,
    section: v.section,
    campusId: v.campus_id,
    votingStatus: v.voting_status,
    timeVoted: iso(v.time_voted),
    status: v.status,
    createdAt: iso(v.created_at),
    updatedAt: iso(v.updated_at),
    schoolYear: v.school_year,
    semester: v.semester,
  };
}

async function insertRecord(
  db: Db,
  kind: Kind,
  v: VoterRow,
  userId: string | null,
): Promise<string> {
  const k = KINDS[kind];
  const r = await db.query(
    `INSERT INTO ${k.table} (entity_type, entity_id, entity_name, data, ${k.byCol}, ${k.atCol})
     VALUES ('Students', $1::uuid, $2, $3::jsonb, $4::uuid, now()) RETURNING id`,
    [v.id, v.full_name, JSON.stringify(snapshot(v)), userId],
  );
  return r.rows[0].id as string;
}

async function deactivateProfiles(db: Db, authUserIds: string[]) {
  if (!authUserIds.length) return;
  await db.query(
    `UPDATE user_profiles SET is_active = false, updated_at = now() WHERE auth_user_id = ANY($1::uuid[])`,
    [authUserIds],
  );
}

async function banAuthUsers(authUserIds: string[]) {
  for (const id of authUserIds) {
    try {
      await supabaseAuth.setUserBanStatus(id, "876000h"); // ~100 years, same as Java
    } catch (e) {
      console.error("[voters] Supabase ban failed:", (e as Error).message);
    }
  }
}

export async function moveVoter(
  kind: Kind,
  id: string,
  req: Request,
): Promise<void> {
  const k = KINDS[kind];
  const { voter, recordId } = await withTx(async (db) => {
    const v = await getVoterById(db, id);
    if (!v) throw new Error("Voter not found.");
    const recordId = await insertRecord(db, kind, v, getAuthUserId(req));
    await db.query(
      `UPDATE voters SET status = $2::record_status, updated_at = now() WHERE id = $1::uuid`,
      [v.id, k.status],
    );
    if (v.auth_user_id) await deactivateProfiles(db, [v.auth_user_id]);
    await auditLog(
      db,
      req,
      k.action,
      "Students",
      v.id,
      kind === "archive"
        ? `Archived voter ${v.student_id}`
        : `Moved voter ${v.student_id} to trash`,
      { studentId: v.student_id, fullName: v.full_name },
    );
    return { voter: v, recordId };
  });

  publish(
    kind === "archive" ? "/topic/history/archives" : "/topic/history/trash",
    {
      action: kind === "archive" ? "ARCHIVED" : "TRASHED",
      id: recordId,
      count: null,
    },
  );
  if (voter.auth_user_id) await banAuthUsers([voter.auth_user_id]);
  notifyDashboard(voter.campus_id);
}

export async function moveVoters(
  kind: Kind,
  ids: string[],
  req: Request,
): Promise<number> {
  if (!ids.length) return 0;
  const k = KINDS[kind];

  const { count, targets } = await withTx(async (db) => {
    const targets = (
      await db.query(`SELECT * FROM voters WHERE id = ANY($1::uuid[])`, [ids])
    ).rows as VoterRow[];
    if (!targets.length) return { count: 0, targets };

    const userId = getAuthUserId(req);
    for (const v of targets) await insertRecord(db, kind, v, userId);

    const upd = await db.query(
      `UPDATE voters SET status = $2::record_status, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [ids, k.status],
    );
    const count = upd.rowCount ?? 0;

    await deactivateProfiles(
      db,
      targets.map((v) => v.auth_user_id).filter((x): x is string => !!x),
    );

    if (count > 0) {
      await auditLog(
        db,
        req,
        k.action,
        "Students",
        null,
        kind === "archive"
          ? `Archived ${count} voters`
          : `Moved ${count} voters to trash`,
        {
          count,
          voters: targets.map((v) => ({
            id: v.id,
            studentId: v.student_id,
            fullName: v.full_name,
          })),
        },
      );
    }
    return { count, targets };
  });

  if (count > 0) {
    publish(
      kind === "archive" ? "/topic/history/archives" : "/topic/history/trash",
      {
        action: kind === "archive" ? "BULK_ARCHIVED" : "BULK_TRASHED",
        id: null,
        count,
      },
    );
  }

  // fire-and-forget, like Java's @Async: don't block the request on N Supabase calls
  void banAuthUsers(
    targets.map((v) => v.auth_user_id).filter((x): x is string => !!x),
  );

  [...new Set(targets.map((v) => v.campus_id).filter(Boolean))].forEach(
    notifyDashboard,
  );
  return count;
}

// ---------------------------------------------------------------- restore / permanent delete

export async function enableVoterAccount(db: Db, v: VoterRow) {
  if (!v.auth_user_id) return;
  await db.query(
    `UPDATE user_profiles SET is_active = true, updated_at = now() WHERE auth_user_id = $1::uuid`,
    [v.auth_user_id],
  );
  try {
    await supabaseAuth.setUserBanStatus(v.auth_user_id, "none");
  } catch (e) {
    console.error("[voters] Supabase unban failed:", (e as Error).message);
  }
}

export async function restoreVoterRecords(db: Db, voterId: string) {
  for (const table of ["trash_records", "archive_records"]) {
    await db.query(
      `UPDATE ${table} SET is_restored = true, restored_at = now()
        WHERE entity_type = 'Students' AND entity_id = $1::uuid AND is_restored = false`,
      [voterId],
    );
  }
  const v = await getVoterById(db, voterId);
  if (v) {
    await enableVoterAccount(db, v);
    notifyDashboard(v.campus_id);
  }
}

/** returns null when the voter does not exist (route answers 404); throws for 400 cases */
export async function restoreVoter(
  id: string,
  req: Request,
): Promise<VoterRow | null> {
  const v = await getVoterById(pool, id);
  if (!v) return null;
  if (v.status !== "DELETED" && v.status !== "ARCHIVED")
    throw new Error("Only deleted or archived voters can be restored.");

  await pool.query(
    `UPDATE voters SET status = 'ACTIVE', updated_at = now() WHERE id = $1::uuid`,
    [id],
  );
  await restoreVoterRecords(pool, id);

  const restored = (await getVoterById(pool, id))!;
  await auditLog(
    pool,
    req,
    "RESTORE",
    "Students",
    id,
    `Restored voter ${restored.student_id}`,
    {
      studentId: restored.student_id,
      fullName: restored.full_name,
    },
  );
  return restored;
}

export async function permanentlyDeleteVoter(id: string): Promise<void> {
  const v = await getVoterById(pool, id);
  if (!v) throw new Error("Voter not found.");
  if (v.status !== "DELETED")
    throw new Error("Only trashed voters can be permanently deleted.");

  // Same order as Java: Supabase first (404 = already gone is fine, any other error aborts), then local rows.
  if (v.auth_user_id) await supabaseAuth.deleteUser(v.auth_user_id);

  await withTx(async (db) => {
    await db.query(
      `DELETE FROM trash_records WHERE entity_type = 'Students' AND entity_id = $1::uuid AND is_restored = false`,
      [id],
    );
    if (v.auth_user_id)
      await db.query(
        `DELETE FROM user_profiles WHERE auth_user_id = $1::uuid`,
        [v.auth_user_id],
      );
    await db.query(`DELETE FROM voters WHERE id = $1::uuid`, [id]);
  });
}

// ---------------------------------------------------------------- update

export async function updateVoter(
  id: string,
  body: Record<string, unknown>,
  req: Request,
): Promise<{
  status: number;
  message?: string;
  voter?: Record<string, unknown>;
}> {
  const existing = (
    await pool.query(
      `SELECT * FROM voters WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [id],
    )
  ).rows[0] as VoterRow | undefined;
  if (!existing) return { status: 404 };

  const studentId = str(body.studentId);
  if (!studentId) return { status: 400, message: "Student ID is required." };

  const dup = await pool.query(
    `SELECT id FROM voters WHERE student_id = $1 LIMIT 1`,
    [studentId],
  );
  if (dup.rows[0] && dup.rows[0].id !== id)
    return { status: 400, message: "This Student ID is already registered." };

  const campusId = str(body.campusId);
  if (!campusId) return { status: 400, message: "Campus is required." };
  if (!isUuid(campusId)) return { status: 400, message: "Invalid campus ID." };
  const campus = await pool.query(
    `SELECT 1 FROM campuses WHERE id = $1::uuid`,
    [campusId],
  );
  if (!campus.rowCount)
    return { status: 400, message: "Selected campus was not found." };

  const edit = termFromEdit(body, {
    schoolYear: existing.school_year,
    semester: existing.semester,
  });
  if ("error" in edit) return { status: 400, message: edit.error };

  let saved: VoterRow;
  try {
    saved = (
      await pool.query(
        `UPDATE voters SET student_id = $2, last_name = $3, first_name = $4, middle_name = $5, full_name = $6,
                email = $7, program_course = $8, year_level = $9, section = $10, campus_id = $11::uuid,
                school_year = $12, semester = $13::smallint, updated_at = now()
          WHERE id = $1::uuid RETURNING *`,
        [
          id,
          studentId,
          str(body.lastName),
          str(body.firstName),
          str(body.middleName),
          str(body.fullName),
          str(body.email),
          str(body.programCourse),
          str(body.yearLevel),
          str(body.section),
          campusId,
          edit.term.schoolYear,
          edit.term.semester,
        ],
      )
    ).rows[0] as VoterRow;
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      return { status: 400, message: "This Student ID is already registered." };
    throw e;
  }

  const snap = (v: VoterRow) => ({
    "Student ID": v.student_id,
    "Full name": v.full_name,
    "Last name": v.last_name,
    "First name": v.first_name,
    "Middle name": v.middle_name,
    Email: v.email,
    "Program/Course": v.program_course,
    "Year level": v.year_level,
    Section: v.section,
    "School year": v.school_year,
    Semester: v.semester,
  });
  const changes = diffFields(snap(existing), snap(saved));
  if (existing.campus_id !== saved.campus_id) {
    const names = new Map(
      (
        await pool.query(
          `SELECT id, name FROM campuses WHERE id = ANY($1::uuid[])`,
          [[existing.campus_id, saved.campus_id]],
        )
      ).rows.map((r) => [r.id as string, r.name as string]),
    );
    changes.Campus = {
      from: names.get(existing.campus_id) ?? existing.campus_id,
      to: names.get(saved.campus_id) ?? saved.campus_id,
    };
  }

  await auditLog(
    pool,
    req,
    "UPDATE",
    "Students",
    saved.id,
    `Updated voter ${saved.student_id}`,
    {
      studentId: saved.student_id,
      fullName: saved.full_name,
      changes,
    },
  );
  return { status: 200, voter: await toResponse(pool, saved) };
}

// ---------------------------------------------------------------- import

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

async function createVoterUserAccount(
  v: {
    id: string;
    student_id: string;
    first_name: string;
    last_name: string;
    campus_id: string;
  },
  errors: string[],
  rowNumber: number,
) {
  try {
    const syntheticEmail = `${v.student_id}@voter.local`;
    const auth = await supabaseAuth.createUser(syntheticEmail, v.student_id);
    if (!auth?.id) {
      errors.push(`Row ${rowNumber}: Voter saved but account creation failed.`);
      return;
    }
    await pool.query(
      `UPDATE voters SET auth_user_id = $2::uuid WHERE id = $1::uuid`,
      [v.id, auth.id],
    );
    await pool.query(
      `INSERT INTO user_profiles (auth_user_id, role, campus_id, school_id, email, first_name, last_name, is_active, must_change_password)
       VALUES ($1::uuid, 'STUDENT', $2::uuid, $3, $4, $5, $6, true, true)`,
      [
        auth.id,
        v.campus_id,
        v.student_id,
        syntheticEmail,
        v.first_name,
        v.last_name,
      ],
    );
  } catch (e) {
    console.error(e);
    errors.push(
      `Row ${rowNumber}: Voter saved but account creation failed: ${(e as Error).message}`,
    );
  }
}

export async function importVoters(
  rows: Record<string, unknown>[],
  req: Request,
): Promise<ImportResult> {
  let added = 0,
    updated = 0,
    skipped = 0;
  const errors: string[] = [];
  const touched = new Set<string>();

  const campusRows = (await pool.query(`SELECT id, name FROM campuses`)).rows;
  const knownCampuses = new Set(
    campusRows.map((r) => String(r.id).toLowerCase()),
  );
  const campusByName = new Map(
    campusRows.map((r) => [
      String(r.name).trim().toLowerCase(),
      String(r.id).toLowerCase(),
    ]),
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 2;
    try {
      const studentId = str(row.studentId);
      const lastName = str(row.lastName);
      const firstName = str(row.firstName);
      const middleName = str(row.middleName);
      let fullName = str(row.fullName);
      const email = str(row.email);
      const programCourse = str(row.programCourse);
      const yearLevel = str(row.yearLevel);
      const section = str(row.section);
      let campusId = str(row.campusId).toLowerCase();

      if (!studentId) {
        errors.push(`Row ${n}: Student ID is required.`);
        skipped++;
        continue;
      }
      if (!firstName) {
        errors.push(`Row ${n}: First name is required.`);
        skipped++;
        continue;
      }
      if (!lastName) {
        errors.push(`Row ${n}: Last name is required.`);
        skipped++;
        continue;
      }
      if (!fullName)
        fullName = [firstName, middleName, lastName]
          .filter((x) => x)
          .join(" ")
          .trim();

      // campus: 1) campusId given  2) campus name given  3) derived from the section (BSIS1-MZN -> Muzon)
      if (!campusId) {
        const named = str(row.campus).toLowerCase();
        const wanted =
          named || (campusNameFromSection(section) ?? "").toLowerCase();
        campusId = campusByName.get(wanted) ?? "";
        if (!campusId) {
          errors.push(
            `Row ${n}: Could not work out the campus (${named ? `campus "${row.campus}"` : `section "${section}"`}).`,
          );
          skipped++;
          continue;
        }
      }
      if (!UUID_RE.test(campusId)) {
        errors.push(`Row ${n}: Invalid campus ID.`);
        skipped++;
        continue;
      }
      if (!knownCampuses.has(campusId)) {
        errors.push(`Row ${n}: Selected campus was not found.`);
        skipped++;
        continue;
      }

      // school year + semester (missing SY in the file -> current SY)
      const parsed = parseTerm(row.schoolYear, row.semester);
      const term: Term = {
        schoolYear: parsed.schoolYear ?? currentSchoolYear(),
        semester: parsed.semester,
      };

      const vals = [
        lastName,
        firstName,
        blankToNull(middleName),
        fullName,
        blankToNull(email),
        blankToNull(programCourse),
        blankToNull(yearLevel),
        blankToNull(section),
        campusId,
      ];

      const found = (
        await pool.query(`SELECT * FROM voters WHERE student_id = $1 LIMIT 1`, [
          studentId,
        ])
      ).rows[0] as VoterRow | undefined;

      if (found) {
        const prev: Term = {
          schoolYear: found.school_year,
          semester: found.semester,
        };
        const cmp = compareTerm(term, prev);
        if (found.school_year && cmp < 0) {
          errors.push(
            `Row ${n}: ${studentId} is already on a newer term (${formatTerm(prev)}); skipped.`,
          );
          skipped++;
          continue;
        }
        // moved to a LATER school year / semester -> voting status goes back to NOT_VOTED.
        // ballots and vote_logs are never touched, so past votes stay.
        const newTerm = !!found.school_year && cmp > 0;
        const wasInactive = found.status !== "ACTIVE";

        await pool.query(
          `UPDATE voters SET last_name = $2, first_name = $3, middle_name = $4, full_name = $5, email = $6,
                  program_course = $7, year_level = $8, section = $9, campus_id = $10::uuid,
                  school_year = $11, semester = $12::smallint,
                  voting_status = (CASE WHEN $13::boolean THEN 'NOT_VOTED' ELSE voting_status::text END)::voting_status,
                  time_voted = CASE WHEN $13::boolean THEN NULL ELSE time_voted END,
                  status = 'ACTIVE', updated_at = now()
            WHERE id = $1::uuid`,
          [found.id, ...vals, term.schoolYear, term.semester, newTerm],
        );
        touched.add(campusId);
        if (wasInactive) await restoreVoterRecords(pool, found.id);
        if (!found.auth_user_id) {
          await createVoterUserAccount(
            {
              id: found.id,
              student_id: studentId,
              first_name: firstName,
              last_name: lastName,
              campus_id: campusId,
            },
            errors,
            n,
          );
        }
        updated++;
        continue;
      }

      const ins = await pool.query(
        `INSERT INTO voters (student_id, last_name, first_name, middle_name, full_name, email, program_course,
                             year_level, section, campus_id, school_year, semester, voting_status, time_voted, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11, $12::smallint, 'NOT_VOTED', NULL, 'ACTIVE') RETURNING id`,
        [studentId, ...vals, term.schoolYear, term.semester],
      );
      touched.add(campusId);
      await createVoterUserAccount(
        {
          id: ins.rows[0].id,
          student_id: studentId,
          first_name: firstName,
          last_name: lastName,
          campus_id: campusId,
        },
        errors,
        n,
      );
      added++;
    } catch (e) {
      errors.push(
        `Row ${n}: ${(e as Error).message || "Unable to import voter."}`,
      );
      skipped++;
    }
  }

  if (added > 0 || updated > 0) {
    await auditLog(
      pool,
      req,
      "IMPORT",
      "Students",
      null,
      `Imported voters: ${added} added, ${updated} updated, ${skipped} skipped.`,
      { added, updated, skipped },
    );
  }
  touched.forEach(notifyDashboard);
  return { added, updated, skipped, errors };
}
