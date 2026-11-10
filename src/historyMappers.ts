import { AuditRow, RecordRow, UserInfo, VoteLogRow } from './historyRepository';

// ---------------- AuditLogDTO ----------------

const ROLE_CLASS: Record<string, string> = {
  STUDENT: 'student', CANDIDATE: 'candidate', ADMIN: 'admin', SUPERADMIN: 'superadmin',
};

const ACTION_CLASS: Record<string, string> = {
  LOGIN: 'login', LOGOUT: 'login', PASSWORD_CHANGED: 'update', CREATE: 'create', UPDATE: 'update', DELETE: 'delete',
  ARCHIVE: 'archive', RESTORE: 'restore', VOTE: 'vote', IMPORT: 'create', EXPORT: 'update', ACTIVATE: 'update',
  DEACTIVATE: 'update', OTHER: 'update',
};

const ACTION_ICON: Record<string, string> = {
  LOGIN: 'bi-box-arrow-in-right', LOGOUT: 'bi-box-arrow-right', PASSWORD_CHANGED: 'bi-key', CREATE: 'bi-plus-circle',
  UPDATE: 'bi-pencil-square', DELETE: 'bi-trash3', ARCHIVE: 'bi-archive', RESTORE: 'bi-arrow-counterclockwise',
  VOTE: 'bi-check2-square', IMPORT: 'bi-upload', EXPORT: 'bi-download', ACTIVATE: 'bi-toggle-on',
  DEACTIVATE: 'bi-toggle-off', OTHER: 'bi-activity',
};

function initialsOf(name: string | null | undefined): string {
  if (!name || !name.trim()) return '??';
  const parts = name.trim().split(/\s+/);
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

function humanizeAction(action: string | null): string {
  if (!action) return 'Action';
  return action
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

/** metadata shaped like {"details":[{"target","field","from","to"}]}; anything else -> no details */
function parseDetails(metadata: unknown) {
  let root: any = metadata;
  if (typeof root === 'string') {
    try { root = JSON.parse(root); } catch { return []; }
  }
  const arr = root && typeof root === 'object' ? root.details : null;
  if (!Array.isArray(arr)) return [];
  const text = (o: any, k: string) => (o == null || o[k] == null ? null : String(o[k]));
  return arr.map((d) => ({ target: text(d, 'target'), field: text(d, 'field'), from: text(d, 'from'), to: text(d, 'to') }));
}

export function toAuditLogDto(r: AuditRow, info: UserInfo | undefined) {
  const user = info?.name ?? 'Unknown User';
  return {
    id: r.id,
    user,
    initials: initialsOf(user),
    userId: r.userId,
    role: r.role ?? 'UNKNOWN',
    roleClass: r.role ? ROLE_CLASS[r.role] ?? 'student' : 'student',
    action: humanizeAction(r.action),
    actionClass: ACTION_CLASS[r.action] ?? 'update',
    icon: ACTION_ICON[r.action] ?? 'bi-activity',
    description: r.description,
    details: parseDetails(r.metadata),
    createdAt: r.createdAt,
    profilePictureUrl: info?.picture ?? null,
  };
}

// ---------------- ArchiveRecordDTO / TrashRecordDTO ----------------

export function toArchiveDto(r: RecordRow, archivedByName: string) {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    entityName: r.entityName,
    archivedBy: archivedByName,
    archivedAt: r.at,
  };
}

export const RETENTION_DAYS = 30;

export function toTrashDto(r: RecordRow, deletedByName: string) {
  const msLeft = r.at.getTime() + RETENTION_DAYS * 86_400_000 - Date.now();
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    entityName: r.entityName,
    deletedBy: deletedByName,
    deletedAt: r.at,
    daysRemaining: Math.max(Math.trunc(msLeft / 86_400_000), 0), // Duration.toDays() truncates
  };
}

// ---------------- VoteLogDTO ----------------
// PROVISIONAL: VoteLogDTO.java was not shared. Field names are what history.js reads.

export function toVoteLogDto(r: VoteLogRow) {
  return {
    id: r.id,
    initials: initialsOf(r.fullName),
    fullName: r.fullName,
    email: r.email,
    studentId: r.studentId,
    ballotId: r.ballotId,
    programCourse: r.programCourse,
    section: r.section,
    yearLevel: r.yearLevel,
    campusId: r.campusId,
    campusName: r.campusName,
    electionId: r.electionId,
    electionName: r.electionName,
    electionCategory: r.electionCategory,
    votedAt: r.votedAt,
  };
}