import { Request } from "express";
import { pool } from "./db";
import { withTransaction } from "./tx";
import { auditLog } from "./auditLog";
import { emitVoteCast, realtime } from "./realtime";
import { demoteAllIfNoLongerCandidate, promoteAll } from "./candidateRoleSync";
import { IllegalArgumentError, IllegalStateError } from "./errors";
import * as repo from "./electionRepository";
import { Db } from "./electionRepository";
import * as hr from "./historyRepository";
import {
  toArchiveDto,
  toAuditLogDto,
  toTrashDto,
  toVoteLogDto,
} from "./historyMappers";
import { assertSchoolYearAvailable } from "./electionService";
import { enableVoterAccount, VoterRow } from "./voterService";
import { validateMembers } from "./partylistService";
import { assertMembersRestorable } from "./departmentService";
import * as partyRepo from "./partylistRepository";
import * as deptRepo from "./departmentRepository";
import { buildActionDetails } from "./actionDetails";

/** Port of HistoryService.java (superadmin part only). */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export interface PageResponse<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

const pageResponse = <T>(
  items: T[],
  page: number,
  total: number,
): PageResponse<T> => ({
  items,
  page,
  totalPages: Math.ceil(total / hr.PAGE_SIZE),
  totalItems: total,
});

/** parseEnumOrNull: blank / "all" -> no filter, else upper-cased */
const enumFilter = (v?: string): string | null =>
  !v || !v.trim() || v.toLowerCase() === "all" ? null : v.toUpperCase();

const currentUserId = (req: Request): string | null => {
  const id = req.session.user?.userId;
  return id && hr.isUuid(id) ? id : null;
};

// ============================================================
// vote logs
// ============================================================

export async function getVoteLogs(
  filters: hr.VoteLogFilters,
  sort: string,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.voteLogs(pool, filters, sort, page, all);
  const items = rows.map(toVoteLogDto);
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

export const getVoteLogFilterOptions = () => hr.voteLogFilterOptions(pool);

// ============================================================
// actions (audit logs)
// ============================================================

export const getActionFilterOptions = () => hr.distinctActions(pool);

export async function getActions(
  search: string | undefined,
  role: string | undefined,
  action: string | undefined,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.auditLogs(
    pool,
    { search, role: enumFilter(role), action: enumFilter(action) },
    page,
    all,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.userId),
  );
  const items = rows.map((r) =>
    toAuditLogDto(r, r.userId ? users.get(r.userId) : undefined),
  );
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

// ============================================================
// archives / trash lists
// ============================================================

export async function getArchives(
  search: string | undefined,
  type: string | undefined,
  page: number,
) {
  const { rows, total } = await hr.recordPage(
    pool,
    "archive",
    search,
    type,
    page,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.by),
  );
  return pageResponse(
    rows.map((r) =>
      toArchiveDto(r, (r.by && users.get(r.by)?.name) || "Unknown User"),
    ),
    page,
    total,
  );
}

export async function getTrash(
  search: string | undefined,
  type: string | undefined,
  page: number,
) {
  const { rows, total } = await hr.recordPage(
    pool,
    "trash",
    search,
    type,
    page,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.by),
  );
  return pageResponse(
    rows.map((r) =>
      toTrashDto(r, (r.by && users.get(r.by)?.name) || "Unknown User"),
    ),
    page,
    total,
  );
}

// ============================================================
// archive details (organized view of the archived JSON)
// ============================================================

/** "MMM d, yyyy h:mm a" in Asia/Manila (same as Java's ARCHIVE_DATE_FORMAT) */
function formatManila(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")} ${p("day")}, ${p("year")} ${p("hour")}:${p("minute")} ${p("dayPeriod").toUpperCase()}`;
}

function formatEpoch(raw: number): string {
  const millis = raw > 1e11 ? Math.trunc(raw) : Math.trunc(raw * 1000); // millis if very large, else seconds
  const d = new Date(millis);
  return Number.isNaN(d.getTime()) ? String(raw) : formatManila(d);
}

/** keys never shown in archive details: ids, image/file URLs, secrets */
const HIDDEN_KEY_RE = /^(id|authUserId)$|url$|password/i;

function memberLine(m: Record<string, unknown>): string {
  const name = [m.firstName, m.middleName, m.lastName]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ");
  const extra = [m.position, m.studentId ? `ID ${m.studentId}` : null]
    .filter(Boolean)
    .join(" · ");
  return extra ? `${name} — ${extra}` : name;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function archiveLabel(key: string): string {
  switch (key) {
    case "campusId":
      return "Campus";
    case "partylistIds":
      return "Partylists";
    case "departmentIds":
      return "Departments";
    case "partylistId":
      return "Partylist";
    case "departmentId":
      return "Department";
    case "createdBy":
      return "Created By";
    case "updatedBy":
      return "Updated By";
    default:
      return humanizeKey(key);
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatManila(d);
    }
    return v;
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v))
    return v
      .map(formatValue)
      .filter((s) => s.trim() !== "")
      .join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !HIDDEN_KEY_RE.test(k))
      .map(([k, x]) => [k, formatValue(x)] as const)
      .filter(([, s]) => s.trim() !== "")
      .map(([k, s]) => `${humanizeKey(k)}: ${s}`)
      .join(" · ");
  }
  return String(v);
}

async function formatField(db: Db, key: string, v: unknown): Promise<string> {
  if (v === null || v === undefined) return "";

  if (typeof v === "number" && (key.endsWith("At") || key === "timeVoted"))
    return formatEpoch(v);
  if (key === "campusId" && typeof v === "string")
    return (await hr.lookupName(db, "campus", v)) ?? v;

  if (
    ["createdBy", "updatedBy", "archivedBy", "deletedBy"].includes(key) &&
    typeof v === "string"
  ) {
    if (!hr.isUuid(v)) return v;
    return (await hr.userInfos(db, [v])).get(v)?.name ?? v;
  }

  if (key === "partylistIds" && Array.isArray(v)) {
    return (
      await Promise.all(
        v.map(
          async (x) =>
            (await hr.lookupName(db, "partylist", String(x))) ?? String(x),
        ),
      )
    ).join(", ");
  }
  if (key === "departmentIds" && Array.isArray(v)) {
    return (
      await Promise.all(
        v.map(
          async (x) =>
            (await hr.lookupName(db, "department", String(x))) ?? String(x),
        ),
      )
    ).join(", ");
  }
  if (key === "partylistId" && typeof v === "string")
    return (await hr.lookupName(db, "partylist", v)) ?? v;
  if (key === "departmentId" && typeof v === "string")
    return (await hr.lookupName(db, "department", v)) ?? v;
  if (key === "members" && Array.isArray(v)) {
    return v.map((m) => memberLine(m as Record<string, unknown>)).join("\n");
  }
  if (
    key === "campus" &&
    v &&
    typeof v === "object" &&
    typeof (v as any).name === "string"
  ) {
    return (v as any).name;
  }
  return formatValue(v);
}

export async function getArchiveDetails(id: string) {
  const record = await hr.findRecord(pool, "archive", id);
  if (!record) throw new NotFoundError(`Archive record not found: ${id}`);

  const fields: { label: string; value: string }[] = [];
  try {
    const data =
      typeof record.data === "string" ? JSON.parse(record.data) : record.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [key, v] of Object.entries(data as Record<string, unknown>)) {
        if (HIDDEN_KEY_RE.test(key)) continue;

        const value = await formatField(pool, key, v);
        if (!value.trim()) continue;
        fields.push({ label: archiveLabel(key), value });
      }
    }
  } catch {
    // unreadable snapshot -> empty field list instead of failing
  }
  return {
    entityType: record.entityType,
    entityName: record.entityName,
    fields,
  };
}

// ============================================================
// restore (archive + trash)
// ============================================================

/** what to refresh after the transaction commits */
interface Restored {
  kind: "election" | "partylist" | "department" | "student" | "other";
  campusId: string | null;
}

async function restorePartylist(db: Db, id: string): Promise<Restored> {
  const p = await partyRepo.findById(db, id);
  if (!p) throw new NotFoundError(`Partylist not found: ${id}`);
  if (p.status !== "DELETED" && p.status !== "ARCHIVED")
    throw new IllegalStateError("Partylist cannot be restored.");
  if (await partyRepo.nameTaken(db, p.name.trim(), id))
    throw new IllegalArgumentError(
      "A partylist with the same name already exists.",
    );

  const members = await partyRepo.listMembers(db, id);
  await validateMembers(db, id, p.campus.id, p.schoolYear, members);

  await partyRepo.setStatus(db, id, "ACTIVE");
  await promoteAll(
    db,
    members.map((m) => m.studentId),
  );
  return { kind: "partylist", campusId: p.campus.id };
}

async function restoreDepartment(db: Db, id: string): Promise<Restored> {
  const d = await deptRepo.findById(db, id);
  if (!d) throw new NotFoundError(`Department not found: ${id}`);
  if (d.status !== "DELETED" && d.status !== "ARCHIVED")
    throw new IllegalStateError("Department cannot be restored.");

  await assertMembersRestorable(db, d);

  await deptRepo.setStatus(db, id, "ACTIVE");
  await promoteAll(
    db,
    (await deptRepo.listMembers(db, id)).map((m) => m.studentId),
  );
  return { kind: "department", campusId: d.campus.id };
}

async function restoreElection(db: Db, id: string): Promise<Restored> {
  const election = await repo.findById(db, id);
  if (!election) throw new NotFoundError(`Election not found: ${id}`);

  const blockers = await hr.electionRestoreBlockers(db, id);
  if (blockers.length) {
    throw new IllegalStateError(
      "Cannot restore this election because the following are still archived or in trash: " +
        blockers.join(", ") +
        ". Restore them first, then restore the election.",
    );
  }

  // one election per school year (ElectionSchoolYearGuard)
  const departmentIds = (await repo.departmentLinks(db, id)).map((d) => d.id);
  await assertSchoolYearAvailable(
    db,
    election.category,
    election.campusId,
    election.schoolYear,
    departmentIds,
    id,
    election.semester,
  );

  election.status = "ACTIVE";
  election.active = true;
  await repo.saveElection(db, election);

  await repo.refreshVoters(db, await repo.voterIdsOfElection(db, id)); // votes count again
  await promoteAll(
    db,
    (await repo.candidatesOfElection(db, id)).map((c) => c.studentId),
  );
  return { kind: "election", campusId: election.campusId };
}

async function reactivateEntity(
  db: Db,
  entityType: string,
  entityId: string,
  data: unknown,
): Promise<Restored> {
  switch (entityType) {
    case "Students": {
      const r = await db.query(
        `UPDATE voters SET status = 'ACTIVE', updated_at = now() WHERE id = $1 RETURNING *`,
        [entityId],
      );
      const voter = r.rows[0] as VoterRow | undefined;
      if (!voter) throw new NotFoundError(`Voter not found: ${entityId}`);
      await enableVoterAccount(db, voter);
      return { kind: "student", campusId: voter.campus_id };
    }

    case "Partylists":
      return restorePartylist(db, entityId);

    case "Departments":
      return restoreDepartment(db, entityId);

    case "Admins": {
      const r = await db.query(
        `UPDATE user_profiles SET status = 'ACTIVE', is_active = true, updated_at = now() WHERE id = $1`,
        [entityId],
      );
      if (!r.rowCount) throw new NotFoundError(`Admin not found: ${entityId}`);
      return { kind: "other", campusId: null };
    }

    case "Elections":
      return restoreElection(db, entityId);

    default: {
      const table = hr.ENTITY_TYPE_TO_TABLE[entityType];
      if (!table)
        throw new IllegalStateError(
          `No restore mapping for entity type: ${entityType}`,
        );

      let record: unknown;
      try {
        record = typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        throw new Error("Failed to parse archived data for restore.");
      }
      if (!record || typeof record !== "object")
        throw new Error("Failed to parse archived data for restore.");
      await hr.reinsertRow(db, table, record as Record<string, unknown>);
      return { kind: "other", campusId: null };
    }
  }
}

function afterRestore(r: Restored): void {
  switch (r.kind) {
    case "election":
      realtime.electionsChanged(r.campusId);
      emitVoteCast(); // live results, analytics, vote logs
      break;
    case "partylist":
      realtime.partylistsChanged(r.campusId);
      break;
    case "department":
      realtime.departmentsChanged(r.campusId);
      break;
    case "student":
      if (r.campusId) realtime.dashboardChanged(r.campusId, null);
      break;
  }
}

export async function restoreArchive(id: string, req: Request): Promise<void> {
  const restored = await withTransaction(async (db) => {
    const rec = await hr.findRecord(db, "archive", id);
    if (!rec) throw new NotFoundError(`Archive record not found: ${id}`);
    if (rec.restored) throw new IllegalStateError("Record already restored.");

    const result = await reactivateEntity(
      db,
      rec.entityType,
      rec.entityId,
      rec.data,
    );
    await hr.markRestored(db, "archive", id, currentUserId(req));

    await auditLog(
      db,
      req,
      "RESTORE",
      rec.entityType,
      rec.entityId,
      `restored archived ${rec.entityType} "${rec.entityName}"`,
      { source: "archive" },
    );
    return result;
  });

  afterRestore(restored);
  realtime.historyChanged("archives");
}

export async function restoreTrash(id: string, req: Request): Promise<void> {
  const restored = await withTransaction(async (db) => {
    const rec = await hr.findRecord(db, "trash", id);
    if (!rec) throw new NotFoundError(`Trash record not found: ${id}`);
    if (rec.restored) throw new IllegalStateError("Record already restored.");

    const result = await reactivateEntity(
      db,
      rec.entityType,
      rec.entityId,
      rec.data,
    );
    await hr.markRestored(db, "trash", id, currentUserId(req));

    await auditLog(
      db,
      req,
      "RESTORE",
      rec.entityType,
      rec.entityId,
      `restored ${rec.entityType} "${rec.entityName}" from trash`,
      { source: "trash" },
    );
    return result;
  });

  afterRestore(restored);
  realtime.historyChanged("trash");
}

// ============================================================
// permanent delete
// ============================================================

/** removes the real row (+ children). Returns true when votes were affected (elections). */
async function hardDeleteEntity(
  db: Db,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  switch (entityType) {
    case "Students":
      await db.query(`DELETE FROM voters WHERE id = $1`, [entityId]);
      return false;

    case "Partylists":
      await db.query(`DELETE FROM partylist_members WHERE partylist_id = $1`, [
        entityId,
      ]);
      await db.query(`DELETE FROM partylists WHERE id = $1`, [entityId]);
      return false;

    case "Departments":
      await db.query(
        `DELETE FROM department_members WHERE department_id = $1`,
        [entityId],
      );
      await db.query(`DELETE FROM departments WHERE id = $1`, [entityId]);
      return false;

    case "Elections": {
      const voterIds = await repo.voterIdsOfElection(db, entityId);
      const candidateStudentIds = (
        await repo.candidatesOfElection(db, entityId)
      ).map((c) => c.studentId);

      await db.query(
        `DELETE FROM ballot_votes WHERE ballot_id IN (SELECT id FROM ballots WHERE election_id = $1)`,
        [entityId],
      );
      await db.query(`DELETE FROM vote_logs WHERE election_id = $1`, [
        entityId,
      ]);
      await db.query(`DELETE FROM ballots WHERE election_id = $1`, [entityId]);
      await repo.deleteCandidatesByElection(db, entityId);
      await repo.deletePartylistLinks(db, entityId);
      await repo.deleteDepartmentLinks(db, entityId);

      await repo.refreshVoters(db, voterIds);

      await db.query(`DELETE FROM elections WHERE id = $1`, [entityId]);
      await demoteAllIfNoLongerCandidate(db, candidateStudentIds);
      return true;
    }

    case "Admins":
      await db.query(`DELETE FROM user_profiles WHERE id = $1`, [entityId]);
      return false;

    default:
      return false; // legacy entity types: row already removed at trash time
  }
}

export async function deleteTrashPermanently(
  id: string,
  req: Request,
): Promise<void> {
  const votesChanged = await withTransaction(async (db) => {
    const rec = await hr.findRecord(db, "trash", id);
    if (!rec) throw new NotFoundError(`Trash record not found: ${id}`);

    const changed = await hardDeleteEntity(db, rec.entityType, rec.entityId);
    await hr.deleteTrashRecords(db, [id]);

    await auditLog(
      db,
      req,
      "DELETE",
      rec.entityType,
      rec.entityId,
      `permanently deleted ${rec.entityType} "${rec.entityName}"`,
      { permanent: true },
    );
    return changed;
  });

  if (votesChanged) emitVoteCast();
  realtime.historyChanged("trash");
}

export async function emptyTrash(req: Request): Promise<void> {
  const votesChanged = await withTransaction(async (db) => {
    const all = await hr.unrestoredTrash(db);
    let changed = false;

    for (const rec of all)
      changed =
        (await hardDeleteEntity(db, rec.entityType, rec.entityId)) || changed;
    await hr.deleteTrashRecords(
      db,
      all.map((r) => r.id),
    );

    await auditLog(
      db,
      req,
      "DELETE",
      "Trash",
      null,
      `emptied trash (${all.length} records permanently deleted)`,
      { count: all.length },
    );
    return changed;
  });

  if (votesChanged) emitVoteCast();
  realtime.historyChanged("trash");
}

export { IllegalArgumentError };

// ============================================================
// ADMIN-DEPT scoped (HistoryService.*ForAdminDept)
// ============================================================

const sameId = (a: string | null, b: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export async function getVoteLogsForAdminDept(
  campusId: string,
  programCourse: string,
  f: { search?: string; ballotRef?: string; section?: string; year?: string },
  sort: string,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.voteLogs(
    pool,
    { ...f, campusId, programUpper: programCourse, category: "DEPARTMENT" },
    sort,
    page,
    all,
  );
  const items = rows.map(toVoteLogDto);
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

export const getVoteLogFilterOptionsForAdminDept = (
  campusId: string,
  programCourse: string,
) => hr.voteLogFilterOptionsForProgram(pool, campusId, programCourse);

export const getActionFilterOptionsForUser = (userId: string) =>
  hr.distinctActionsOfUser(pool, userId);

export async function getActionsForAdminDept(
  userId: string,
  search: string | undefined,
  action: string | undefined,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.auditLogs(
    pool,
    { search, role: null, action: enumFilter(action), userId },
    page,
    all,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.userId),
  );
  const items = rows.map((r) =>
    toAuditLogDto(r, r.userId ? users.get(r.userId) : undefined),
  );
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

export async function getArchivesForAdminDept(
  userId: string,
  search: string | undefined,
  type: string | undefined,
  page: number,
) {
  const { rows, total } = await hr.recordPage(
    pool,
    "archive",
    search,
    type,
    page,
    userId,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.by),
  );
  return pageResponse(
    rows.map((r) =>
      toArchiveDto(r, (r.by && users.get(r.by)?.name) || "Unknown User"),
    ),
    page,
    total,
  );
}

export async function getTrashForAdminDept(
  userId: string,
  search: string | undefined,
  type: string | undefined,
  page: number,
) {
  const { rows, total } = await hr.recordPage(
    pool,
    "trash",
    search,
    type,
    page,
    userId,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.by),
  );
  return pageResponse(
    rows.map((r) =>
      toTrashDto(r, (r.by && users.get(r.by)?.name) || "Unknown User"),
    ),
    page,
    total,
  );
}

/** 404 when the record doesn't exist, 403 (IllegalArgumentError) when it isn't the caller's */
async function assertOwner(
  kind: hr.RecordKind,
  id: string,
  userId: string,
  message: string,
): Promise<void> {
  const rec = await hr.findRecord(pool, kind, id);
  if (!rec)
    throw new NotFoundError(
      `${kind === "archive" ? "Archive" : "Trash"} record not found: ${id}`,
    );
  if (!sameId(rec.by, userId)) throw new IllegalArgumentError(message);
}

export async function getArchiveDetailsForAdminDept(
  id: string,
  userId: string,
) {
  await assertOwner(
    "archive",
    id,
    userId,
    "You are not authorized to view this record.",
  );
  return getArchiveDetails(id);
}

export async function restoreArchiveForAdminDept(
  id: string,
  userId: string,
  req: Request,
): Promise<void> {
  await assertOwner(
    "archive",
    id,
    userId,
    "You are not authorized to restore this record.",
  );
  await restoreArchive(id, req);
}

export async function restoreTrashForAdminDept(
  id: string,
  userId: string,
  req: Request,
): Promise<void> {
  await assertOwner(
    "trash",
    id,
    userId,
    "You are not authorized to restore this record.",
  );
  await restoreTrash(id, req);
}

export async function deleteTrashPermanentlyForAdminDept(
  id: string,
  userId: string,
  req: Request,
): Promise<void> {
  await assertOwner(
    "trash",
    id,
    userId,
    "You are not authorized to delete this record.",
  );
  await deleteTrashPermanently(id, req);
}

export async function emptyTrashForAdminDept(
  userId: string,
  req: Request,
): Promise<void> {
  const votesChanged = await withTransaction(async (db) => {
    const owned = await hr.unrestoredTrashOf(db, userId);
    let changed = false;

    for (const rec of owned)
      changed =
        (await hardDeleteEntity(db, rec.entityType, rec.entityId)) || changed;
    await hr.deleteTrashRecords(
      db,
      owned.map((r) => r.id),
    );

    await auditLog(
      db,
      req,
      "DELETE",
      "Trash",
      null,
      `emptied own trash (${owned.length} records permanently deleted)`,
      { count: owned.length },
    );
    return changed;
  });

  if (votesChanged) emitVoteCast();
  realtime.historyChanged("trash");
}

// ============================================================
// ADMIN-SSC scoped (HistoryService.*ForAdminSsc)
// Archives, trash, archive details, restore and permanent delete reuse the ...ForAdminDept functions above
// (the Java *ForAdminSsc methods simply delegate to the admin-dept ones).
// ============================================================

/** vote logs of ONE campus (campusId always comes from the session, never from the request) */
export async function getVoteLogsForAdminSsc(
  campusId: string,
  f: {
    search?: string;
    ballotRef?: string;
    program?: string;
    section?: string;
    year?: string;
  },
  sort: string,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.voteLogs(
    pool,
    { ...f, campusId, category: "SSC" },
    sort,
    page,
    all,
  );
  const items = rows.map(toVoteLogDto);
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

export const getVoteLogFilterOptionsForAdminSsc = (campusId: string) =>
  hr.voteLogFilterOptionsForCampus(pool, campusId);

/** this account's own audit entries; the role filter is honoured but can never widen the user scope */
export async function getActionsForAdminSsc(
  userId: string,
  search: string | undefined,
  role: string | undefined,
  action: string | undefined,
  page: number,
  all: boolean,
) {
  const { rows, total } = await hr.auditLogs(
    pool,
    { search, role: enumFilter(role), action: enumFilter(action), userId },
    page,
    all,
  );
  const users = await hr.userInfos(
    pool,
    rows.map((r) => r.userId),
  );
  const items = rows.map((r) =>
    toAuditLogDto(r, r.userId ? users.get(r.userId) : undefined),
  );
  return all
    ? { items, page: 1, totalPages: 1, totalItems: items.length }
    : pageResponse(items, page, total);
}

/** details of ONE audit entry. ownerUserId = admin accounts can only open their own entries. */
export async function getActionDetails(id: string, ownerUserId?: string) {
  const row = await hr.findAuditLog(pool, id);
  if (!row) throw new NotFoundError(`Action not found: ${id}`);
  if (ownerUserId && !sameId(row.userId, ownerUserId)) {
    throw new IllegalArgumentError("You are not authorized to view this record.");
  }
  const users = await hr.userInfos(pool, [row.userId]);
  const details = await buildActionDetails(pool, row);
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    description: row.description,
    user: (row.userId && users.get(row.userId)?.name) || "Unknown User",
    role: row.role,
    createdAt: row.createdAt,
    ...details,
  };
}