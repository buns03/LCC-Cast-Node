import { Db } from "./electionRepository";
import { programCourseMatches, toDepartmentCode } from "./programCourse";

/** every program_course spelling in vote_logs (majors, old spellings) that belongs to this program */
async function programVariants(db: Db, campusId: string | null, program: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT upper(program_course) AS pc FROM vote_logs
      WHERE program_course IS NOT NULL AND ($1::uuid IS NULL OR campus_id = $1::uuid)`,
    [campusId],
  );
  return rows.map((r) => r.pc as string).filter((pc) => programCourseMatches(pc, program));
}

/** distinct program CODES (majors folded into their program) for the filter dropdowns */
async function distinctProgramCodes(db: Db, campusId: string | null, sscOnly = false): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT program_course AS v FROM vote_logs
      WHERE program_course IS NOT NULL AND ($1::uuid IS NULL OR campus_id = $1::uuid)
        AND ($2::boolean = FALSE OR upper(election_category) = 'SSC')`,
    [campusId, sscOnly],
  );
  const codes = new Set<string>();
  for (const r of rows) {
    const code = toDepartmentCode(r.v);
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

export const PAGE_SIZE = 10;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

/** runs a COUNT + a (LIMIT/OFFSET) page for the same FROM/WHERE; `all` skips paging (Spring's all=true) */
async function paged(
  db: Db,
  select: string,
  from: string,
  params: unknown[],
  orderBy: string,
  page: number,
  all: boolean,
) {
  let total = 0;
  if (!all)
    total = (await db.query(`SELECT COUNT(*)::int AS n ${from}`, params))
      .rows[0].n;

  const p = [...params];
  let sql = `SELECT ${select} ${from} ORDER BY ${orderBy}`;
  if (!all) {
    p.push(PAGE_SIZE, Math.max(page - 1, 0) * PAGE_SIZE);
    sql += ` LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const { rows } = await db.query(sql, p);
  return { rows, total: all ? rows.length : total };
}

// ============================================================
// vote logs
// ============================================================

export interface VoteLogFilters {
  search?: string;
  ballotRef?: string;
  program?: string;
  section?: string;
  year?: string;
  category?: string;
  campusId?: string;
  programUpper?: string; // admin-dept: case-insensitive exact match, like Java's cb.upper(...)
}

export interface VoteLogRow {
  id: string;
  ballotId: string;
  studentId: string;
  fullName: string;
  email: string | null;
  programCourse: string | null;
  yearLevel: string | null;
  section: string | null;
  campusId: string | null;
  campusName: string | null;
  electionId: string;
  electionName: string;
  electionCategory: string | null;
  votedAt: Date;
}

const has = (s?: string): s is string => !!s && s.trim() !== "";

function voteLogOrder(sort: string): string {
  switch (sort) {
    case "az":
      return "vl.full_name ASC, vl.id";
    case "za":
      return "vl.full_name DESC, vl.id";
    case "time-up":
      return "vl.voted_at ASC, vl.id";
    default:
      return "vl.voted_at DESC, vl.id"; // "time-down"
  }
}

export async function voteLogs(
  db: Db,
  f: VoteLogFilters,
  sort: string,
  page: number,
  all: boolean,
) {
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  // electionIsActive(): only vote logs whose election is ACTIVE (archived/deleted elections drop out)
  const where: string[] = [`CAST(e.status AS text) = 'ACTIVE'`];

  if (has(f.search)) {
    const p = bind(`%${f.search.toLowerCase()}%`);
    where.push(
      `(lower(vl.full_name) LIKE ${p} OR lower(vl.student_id) LIKE ${p} OR lower(vl.email) LIKE ${p})`,
    );
  }
  if (has(f.ballotRef)) {
    // reference = first 8 hex chars of the ballot UUID: match every UUID from ref-0000-... to ref-ffff-...
    const ref = f.ballotRef.trim().toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(ref))
      where.push("FALSE"); // invalid reference -> match nothing
    else {
      const lo = bind(`${ref}-0000-0000-0000-000000000000`);
      const hi = bind(`${ref}-ffff-ffff-ffff-ffffffffffff`);
      where.push(`vl.ballot_id BETWEEN ${lo}::uuid AND ${hi}::uuid`);
    }
  }
    for (const wanted of [f.program, f.programUpper]) {
    if (has(wanted)) {
      const variants = await programVariants(db, f.campusId ?? null, wanted);
      where.push(`upper(vl.program_course) = ANY(${bind(variants)}::text[])`);
    }
  }
  if (has(f.section)) where.push(`vl.section = ${bind(f.section)}`);
  if (has(f.year)) where.push(`vl.year_level = ${bind(f.year)}`);
  if (has(f.category))
    where.push(
      `upper(vl.election_category) = ${bind(f.category.toUpperCase())}`,
    );
  if (f.campusId) where.push(`vl.campus_id = ${bind(f.campusId)}`);

  const from = `FROM vote_logs vl
      JOIN elections e ON e.id = vl.election_id
      LEFT JOIN campuses c ON c.id = vl.campus_id
     WHERE ${where.join(" AND ")}`;

  const { rows, total } = await paged(
    db,
    `vl.id, vl.ballot_id, vl.student_id, vl.full_name, vl.email, vl.program_course, vl.year_level, vl.section,
     vl.campus_id, COALESCE(c.name, vl.campus_name) AS campus_name,
     vl.election_id, e.title AS election_name, CAST(e.category AS text) AS election_category, vl.voted_at`,
    from,
    params,
    voteLogOrder(sort),
    page,
    all,
  );

  return {
    total,
    rows: rows.map(
      (r): VoteLogRow => ({
        id: r.id,
        ballotId: r.ballot_id,
        studentId: r.student_id,
        fullName: r.full_name,
        email: r.email,
        programCourse: r.program_course,
        yearLevel: r.year_level,
        section: r.section,
        campusId: r.campus_id,
        campusName: r.campus_name,
        electionId: r.election_id,
        electionName: r.election_name,
        electionCategory: r.election_category,
        votedAt: r.voted_at,
      }),
    ),
  };
}

async function distinctVoteLogValues(
  db: Db,
  col: "program_course" | "section" | "year_level",
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT ${col} AS v FROM vote_logs WHERE ${col} IS NOT NULL ORDER BY ${col}`,
  );
  return rows.map((r) => r.v as string);
}

export async function voteLogFilterOptions(db: Db) {
  return {
        programs: await distinctProgramCodes(db, null),
    sections: await distinctVoteLogValues(db, "section"),
    yearLevels: await distinctVoteLogValues(db, "year_level"),
  };
}

// ============================================================
// audit logs (Actions tab)
// ============================================================

export interface AuditRow {
  id: string;
  userId: string | null;
  role: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
}

export async function auditLogs(
  db: Db,
  f: {
    search?: string;
    role: string | null;
    action: string | null;
    userId?: string;
  },
  page: number,
  all: boolean,
) {
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ["TRUE"];
  if (f.userId) where.push(`a.user_id = ${bind(f.userId)}`);

  if (has(f.search))
    where.push(
      `lower(a.description) LIKE ${bind(`%${f.search.toLowerCase()}%`)}`,
    );
  if (f.role) where.push(`CAST(a.role AS text) = ${bind(f.role)}`);
  if (f.action) where.push(`CAST(a.action AS text) = ${bind(f.action)}`);

  const { rows, total } = await paged(
    db,
    `a.id, a.user_id, CAST(a.role AS text) AS role, CAST(a.action AS text) AS action,
     a.entity_type, a.entity_id, a.description, a.metadata, a.created_at`,
    `FROM audit_logs a WHERE ${where.join(" AND ")}`,
    params,
    "a.created_at DESC, a.id",
    page,
    all,
  );

  return {
    total,
    rows: rows.map(
      (r): AuditRow => ({
        id: r.id,
        userId: r.user_id,
        role: r.role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        description: r.description,
        metadata: r.metadata,
        createdAt: r.created_at,
      }),
    ),
  };
}

export async function findAuditLog(db: Db, id: string): Promise<AuditRow | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.user_id, CAST(a.role AS text) AS role, CAST(a.action AS text) AS action,
            a.entity_type, a.entity_id, a.description, a.metadata, a.created_at
       FROM audit_logs a WHERE a.id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? { id: r.id, userId: r.user_id, role: r.role, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
        description: r.description, metadata: r.metadata, createdAt: r.created_at }
    : null;
}

export async function distinctActions(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT CAST(action AS text) AS v FROM audit_logs WHERE action IS NOT NULL ORDER BY v`,
  );
  return rows.map((r) => r.v as string);
}

// ============================================================
// archive_records / trash_records
// ============================================================

export type RecordKind = "archive" | "trash";

const KIND = {
  archive: { table: "archive_records", by: "archived_by", at: "archived_at" },
  trash: { table: "trash_records", by: "deleted_by", at: "deleted_at" },
} as const;

export interface RecordRow {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  by: string | null;
  at: Date;
  restored: boolean;
  data: unknown;
}

const mapRecord = (r: any): RecordRow => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  entityName: r.entity_name,
  by: r.by_user,
  at: r.at_time,
  restored: r.is_restored === true,
  data: r.data,
});

/** unrestored records, newest first (HistoryService.getArchives / getTrash) */
export async function recordPage(
  db: Db,
  kind: RecordKind,
  search: string | undefined,
  entityType: string | undefined,
  page: number,
  ownerId?: string,
) {
  const k = KIND[kind];
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ["is_restored = false"];
  if (ownerId) where.push(`${k.by} = ${bind(ownerId)}`);

  if (has(search))
    where.push(`lower(entity_name) LIKE ${bind(`%${search.toLowerCase()}%`)}`);
  if (has(entityType)) where.push(`entity_type = ${bind(entityType)}`);

  const { rows, total } = await paged(
    db,
    `id, entity_type, entity_id, entity_name, ${k.by} AS by_user, ${k.at} AS at_time, is_restored`,
    `FROM ${k.table} WHERE ${where.join(" AND ")}`,
    params,
    `${k.at} DESC, id`,
    page,
    false,
  );
  return { rows: rows.map(mapRecord), total };
}

export async function findRecord(
  db: Db,
  kind: RecordKind,
  id: string,
): Promise<RecordRow | null> {
  const k = KIND[kind];
  const { rows } = await db.query(
    `SELECT id, entity_type, entity_id, entity_name, data, ${k.by} AS by_user, ${k.at} AS at_time, is_restored
       FROM ${k.table} WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapRecord(rows[0]) : null;
}

export async function markRestored(
  db: Db,
  kind: RecordKind,
  id: string,
  restoredBy: string | null,
) {
  await db.query(
    `UPDATE ${KIND[kind].table} SET is_restored = true, restored_at = now(), restored_by = $2 WHERE id = $1`,
    [id, restoredBy],
  );
}

export const deleteTrashRecords = (db: Db, ids: string[]) =>
  ids.length
    ? db.query(`DELETE FROM trash_records WHERE id = ANY($1::uuid[])`, [ids])
    : Promise.resolve();

export async function unrestoredTrash(db: Db): Promise<RecordRow[]> {
  const { rows } = await db.query(
    `SELECT id, entity_type, entity_id, entity_name, data, deleted_by AS by_user, deleted_at AS at_time, is_restored
       FROM trash_records WHERE is_restored = false`,
  );
  return rows.map(mapRecord);
}

// ============================================================
// names (AuditLogService.getUserName + profile pictures) and lookups
// ============================================================

export interface UserInfo {
  name: string;
  picture: string | null;
}

/** name = "First Last" of the profile with that auth_user_id, else "Unknown User"; picture = /files/<path> or null */
export async function userInfos(
  db: Db,
  ids: (string | null)[],
): Promise<Map<string, UserInfo>> {
  const wanted = [...new Set(ids.filter(isUuid))];
  const out = new Map<string, UserInfo>();
  if (!wanted.length) return out;

  const { rows } = await db.query(
    `SELECT id, auth_user_id, first_name, last_name, profile_picture_url
       FROM user_profiles WHERE auth_user_id = ANY($1::uuid[]) OR id = ANY($1::uuid[])`,
    [wanted],
  );

  const byAuth = new Map<string, any>();
  const byId = new Map<string, any>();
  for (const r of rows) {
    if (r.auth_user_id) byAuth.set(r.auth_user_id, r);
    byId.set(r.id, r);
  }

  for (const id of wanted) {
    const auth = byAuth.get(id);
    const full = auth
      ? `${auth.first_name ?? ""} ${auth.last_name ?? ""}`.trim()
      : "";
    const path = (auth ?? byId.get(id))?.profile_picture_url; // findByAuthUserId, else findById
    out.set(id, {
      name: full || "Unknown User",
      picture: path && String(path).trim() ? `/files/${path}` : null,
    });
  }
  return out;
}

export async function lookupName(
  db: Db,
  kind: "campus" | "partylist" | "department",
  id: string,
): Promise<string | null> {
  if (!isUuid(id)) return null;
  const sql = {
    campus: "SELECT name AS v FROM campuses WHERE id = $1",
    partylist: "SELECT name AS v FROM partylists WHERE id = $1",
    department: "SELECT title AS v FROM departments WHERE id = $1",
  }[kind];
  const { rows } = await db.query(sql, [id]);
  return rows[0]?.v ?? null;
}

// ============================================================
// generic re-insert (HistoryService.reinsertEntity) — only "Candidates" reaches it
// ============================================================

export const ENTITY_TYPE_TO_TABLE: Record<string, string> = {
  Elections: "elections",
  Partylists: "partylists",
  Departments: "departments",
  Students: "voters",
  Candidates: "candidates",
};

export async function reinsertRow(
  db: Db,
  table: string,
  record: Record<string, unknown>,
) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [key, v] of Object.entries(record)) {
    const col = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(col))
      throw new Error(`Unsafe column name in archived data: ${key}`);
    cols.push(col);
    vals.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v); // objects/arrays -> raw JSON (jsonb columns)
  }
  if (!cols.length) return;
  await db.query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (id) DO NOTHING`,
    vals,
  );
}

/** the "still archived or in trash" blockers HistoryService checks before restoring an election */
export async function electionRestoreBlockers(
  db: Db,
  electionId: string,
): Promise<string[]> {
  const out: string[] = [];

  const partylists = await db.query(
    `SELECT pl.name FROM election_partylists ep JOIN partylists pl ON pl.id = ep.partylist_id
      WHERE ep.election_id = $1 AND CAST(pl.status AS text) <> 'ACTIVE'`,
    [electionId],
  );
  partylists.rows.forEach((r) => out.push(`Partylist "${r.name}"`));

  const departments = await db.query(
    `SELECT d.title FROM election_departments ed JOIN departments d ON d.id = ed.department_id
      WHERE ed.election_id = $1 AND CAST(d.status AS text) <> 'ACTIVE'`,
    [electionId],
  );
  departments.rows.forEach((r) => out.push(`Department "${r.title}"`));

  return out;
}

export async function expiredTrash(db: Db, cutoff: Date): Promise<RecordRow[]> {
  const { rows } = await db.query(
    `SELECT id, entity_type, entity_id, entity_name, data, deleted_by AS by_user, deleted_at AS at_time, is_restored
       FROM trash_records WHERE is_restored = false AND deleted_at < $1`,
    [cutoff],
  );
  return rows.map(mapRecord);
}

// ============================================================
// admin-dept scoped lookups
// ============================================================

export async function unrestoredTrashOf(
  db: Db,
  userId: string,
): Promise<RecordRow[]> {
  const { rows } = await db.query(
    `SELECT id, entity_type, entity_id, entity_name, data, deleted_by AS by_user, deleted_at AS at_time, is_restored
       FROM trash_records WHERE is_restored = false AND deleted_by = $1`,
    [userId],
  );
  return rows.map(mapRecord);
}

export async function distinctActionsOfUser(
  db: Db,
  userId: string,
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT CAST(action AS text) AS v FROM audit_logs WHERE user_id = $1 AND action IS NOT NULL ORDER BY v`,
    [userId],
  );
  return rows.map((r) => r.v as string);
}

export async function voteLogFilterOptionsForProgram(db: Db, campusId: string, programCourse: string) {
  const variants = await programVariants(db, campusId, programCourse);
  const distinct = async (col: "section" | "year_level") => {
    const { rows } = await db.query(
      `SELECT DISTINCT ${col} AS v FROM vote_logs
        WHERE ${col} IS NOT NULL AND campus_id = $1 AND upper(program_course) = ANY($2::text[]) ORDER BY ${col}`,
      [campusId, variants],
    );
    return rows.map((r) => r.v as string);
  };
  return { sections: await distinct("section"), yearLevels: await distinct("year_level") };
}

/** admin-ssc: dropdown options built only from vote logs of one campus (VoteLogRepository.findDistinct...ByCampus) */
export async function voteLogFilterOptionsForCampus(db: Db, campusId: string) {
  const distinct = async (col: "program_course" | "section" | "year_level") => {
    const { rows } = await db.query(
      `SELECT DISTINCT ${col} AS v FROM vote_logs
        WHERE ${col} IS NOT NULL AND campus_id = $1 AND upper(election_category) = 'SSC' ORDER BY ${col}`,
      [campusId],
    );
    return rows.map((r) => r.v as string);
  };
  return {
        programs: await distinctProgramCodes(db, campusId, true),
    sections: await distinct("section"),
    yearLevels: await distinct("year_level"),
  };
}