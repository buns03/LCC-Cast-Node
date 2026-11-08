import type { PoolClient } from "pg";
import { pool } from "./db";
import { CANDIDATE_PORTAL as CP } from "./schema";
import { IllegalArgumentError, IllegalStateError } from "./errors";
import { uploadFile } from "./storage";
import type { Request } from "express";
import { auditLog } from "./auditLog";
import { diffFields } from "./auditDiff";

/** Java IllegalArgumentException thrown for "only the President can update" -> HTTP 403 */
export class ForbiddenError extends Error {}

export type CandidateType = "SSC" | "DEPARTMENT";
export type Source = "CANDIDATE" | "PARTYLIST_MEMBER" | "DEPARTMENT_MEMBER";
export type ImageType = "photo" | "background" | "campaign";

export interface CandidateRecord {
  source: Source;
  id: string;
  studentId: string;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  position: string | null;
  photoImageUrl: string | null;
  backgroundImageUrl: string | null;
  campaignImageUrl: string | null;
  partylistId: string | null;
  departmentId: string | null;
}

export const isPresident = (r: CandidateRecord) =>
  (r.position ?? "").trim().toLowerCase() === "president";

const R = CP.recordCols;
const G = CP.groupCols;

const RECORD_SELECT = `${R.id} AS id, ${R.studentId} AS student_id, ${R.lastName} AS last_name,
  ${R.firstName} AS first_name, ${R.middleName} AS middle_name, ${R.position} AS member_position,
  ${R.photo} AS photo_image_url, ${R.background} AS background_image_url, ${R.campaign} AS campaign_image_url`;

const IMAGE_COLUMN: Record<ImageType, string> = {
  photo: R.photo,
  background: R.background,
  campaign: R.campaign,
};

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

// ---------------------------------------------------------------- lookup

function toRecord(r: any, source: Source): CandidateRecord {
  return {
    source,
    id: r.id,
    studentId: r.student_id,
    lastName: r.last_name ?? null,
    firstName: r.first_name ?? null,
    middleName: r.middle_name ?? null,
    position: r.member_position ?? null,
    photoImageUrl: r.photo_image_url ?? null,
    backgroundImageUrl: r.background_image_url ?? null,
    campaignImageUrl: r.campaign_image_url ?? null,
    partylistId: r.partylist_id ?? null,
    departmentId: r.department_id ?? null,
  };
}

async function findStudentId(authUserId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT student_id FROM voters WHERE auth_user_id = $1::uuid LIMIT 1`,
    [authUserId],
  );
  return rows[0]?.student_id ?? null;
}

async function findRecordByStudentId(
  studentId: string | null,
  type: CandidateType,
): Promise<CandidateRecord | null> {
  if (!studentId || !studentId.trim()) return null;

  if (type === "SSC") {
    const pm = await pool.query(
      `SELECT ${RECORD_SELECT}, partylist_id FROM ${CP.tables.partylistMembers} WHERE ${R.studentId} = $1 LIMIT 1`,
      [studentId],
    );
    if (pm.rows[0]) return toRecord(pm.rows[0], "PARTYLIST_MEMBER");

    const c = await pool.query(
      `SELECT ${RECORD_SELECT}, partylist_id, department_id FROM ${CP.tables.candidates}
        WHERE ${R.studentId} = $1 AND partylist_id IS NOT NULL LIMIT 1`,
      [studentId],
    );
    return c.rows[0] ? toRecord(c.rows[0], "CANDIDATE") : null;
  }

  const dm = await pool.query(
    `SELECT ${RECORD_SELECT}, department_id FROM ${CP.tables.departmentMembers} WHERE ${R.studentId} = $1 LIMIT 1`,
    [studentId],
  );
  if (dm.rows[0]) return toRecord(dm.rows[0], "DEPARTMENT_MEMBER");

  const c = await pool.query(
    `SELECT ${RECORD_SELECT}, partylist_id, department_id FROM ${CP.tables.candidates}
      WHERE ${R.studentId} = $1 AND department_id IS NOT NULL LIMIT 1`,
    [studentId],
  );
  return c.rows[0] ? toRecord(c.rows[0], "CANDIDATE") : null;
}

export async function findRecordByAuthUserId(
  authUserId: string,
  type: CandidateType,
): Promise<CandidateRecord | null> {
  return findRecordByStudentId(await findStudentId(authUserId), type);
}

export async function getCandidacyStatus(
  authUserId: string,
): Promise<{ ssc: boolean; department: boolean }> {
  const studentId = await findStudentId(authUserId);
  if (!studentId) return { ssc: false, department: false };
  return {
    ssc: (await findRecordByStudentId(studentId, "SSC")) !== null,
    department: (await findRecordByStudentId(studentId, "DEPARTMENT")) !== null,
  };
}

/** SSC photo first; if it has none, the department photo (same as findAvatarStoragePath in Java). */
export async function findAvatarStoragePath(
  authUserId: string,
): Promise<string | null> {
  let record = await findRecordByAuthUserId(authUserId, "SSC");
  if (record === null || record.photoImageUrl === null) {
    const dept = await findRecordByAuthUserId(authUserId, "DEPARTMENT");
    if (dept !== null && dept.photoImageUrl !== null) record = dept;
  }
  return record ? record.photoImageUrl : null;
}

// ---------------------------------------------------------------- personal image upload

export async function uploadPersonalImage(
  authUserId: string,
  type: CandidateType,
  imageType: string,
  file:
    | { buffer: Buffer; originalname: string; mimetype: string; size: number }
    | undefined,
  req: Request,
): Promise<string> {
  if (!(imageType in IMAGE_COLUMN))
    throw new IllegalArgumentError("Invalid image type.");
  const column = IMAGE_COLUMN[imageType as ImageType]; // whitelisted, safe for the SQL text

  const studentId = await findStudentId(authUserId);
  if (!studentId) throw new IllegalStateError("Voter account not found.");

  const storagePath = await uploadFile(file, imageType);

  const memberTable =
    type === "SSC" ? CP.tables.partylistMembers : CP.tables.departmentMembers;
  const groupColumn = type === "SSC" ? "partylist_id" : "department_id";

  const updatedAny = await withTx(async (db) => {
    const before = await db.query(
      `SELECT ${R.firstName} AS first_name, ${R.lastName} AS last_name, ${column} AS img
         FROM ${memberTable} WHERE ${R.studentId} = $1 LIMIT 1`,
      [studentId],
    );

    const members = await db.query(
      `UPDATE ${memberTable} SET ${column} = $2, updated_at = now() WHERE ${R.studentId} = $1`,
      [studentId, storagePath],
    );
    const candidates = await db.query(
      `UPDATE ${CP.tables.candidates} SET ${column} = $2 WHERE ${R.studentId} = $1 AND ${groupColumn} IS NOT NULL`,
      [studentId, storagePath],
    );
    const ok = (members.rowCount ?? 0) > 0 || (candidates.rowCount ?? 0) > 0;

    if (ok) {
      const name =
        `${before.rows[0]?.first_name ?? ""} ${before.rows[0]?.last_name ?? ""}`.trim() ||
        studentId;
      const label = {
        photo: "Photo",
        background: "Background",
        campaign: "Campaign image",
      }[imageType as ImageType];
      await auditLog(
        db,
        req,
        "UPDATE",
        "Candidates",
        null,
        `updated ${label.toLowerCase()} of candidate ${name} (${type})`,
        {
          fullName: name,
          studentId,
          changes: {
            [label]: {
              from: before.rows[0]?.img ? "Uploaded" : "None",
              to: "Uploaded (new file)",
            },
          },
        },
      );
    }
    return ok;
  });

  if (!updatedAny) {
    throw new IllegalStateError(
      `No ${type === "SSC" ? "SSC partylist" : "department"} candidate record found for this account.`,
    );
  }
  return storagePath;
}

// ---------------------------------------------------------------- group (partylist / department) info

export interface GroupMember {
  fullName: string;
  position: string | null;
  photoImageUrl: string | null;
}
export interface GroupInfo {
  groupType: "PARTYLIST" | "DEPARTMENT";
  groupId: string;
  name: string;
  description: string | null;
  posterImageUrl: string | null;
  posterLogoUrl: string | null;
  schoolYear: string | null;
  canEdit: boolean;
  members: GroupMember[];
}

/** Port of joinName: first + middle (if not blank) + last. */
function joinName(
  first: string | null,
  middle: string | null,
  last: string | null,
): string {
  let s = "";
  if (first != null) s += first + " ";
  if (middle != null && middle.trim()) s += middle + " ";
  if (last != null) s += last;
  return s.trim();
}

const notInGroup = (type: CandidateType) =>
  type === "SSC"
    ? "You are not currently part of any SSC partylist."
    : "You are not currently part of any department group.";
const notLinked = (type: CandidateType) =>
  type === "SSC"
    ? "This SSC candidate is not linked to a partylist."
    : "This candidate is not linked to a department.";

async function loadGroup(type: CandidateType, groupId: string) {
  const table = type === "SSC" ? CP.tables.partylists : CP.tables.departments;
  const { rows } = await pool.query(
    `SELECT ${G.id} AS id, ${G.name} AS name, ${G.description} AS description, ${G.poster} AS poster_image_url,
            ${G.logo} AS poster_logo_url, ${G.schoolYear} AS school_year
       FROM ${table} WHERE ${G.id} = $1::uuid LIMIT 1`,
    [groupId],
  );
  if (!rows[0])
    throw new IllegalStateError(
      type === "SSC" ? "Partylist not found." : "Department not found.",
    );
  return rows[0];
}

export async function getGroupInfo(
  authUserId: string,
  type: CandidateType,
): Promise<GroupInfo> {
  const record = await findRecordByAuthUserId(authUserId, type);
  if (!record) throw new IllegalStateError(notInGroup(type));

  const groupId = type === "SSC" ? record.partylistId : record.departmentId;
  if (!groupId) throw new IllegalStateError(notLinked(type));

  const g = await loadGroup(type, groupId);

  const memberTable =
    type === "SSC" ? CP.tables.partylistMembers : CP.tables.departmentMembers;
  const memberFk = type === "SSC" ? "partylist_id" : "department_id";
  const { rows } = await pool.query(
    `SELECT ${R.firstName} AS first_name, ${R.middleName} AS middle_name, ${R.lastName} AS last_name,
            ${R.position} AS member_position, ${R.photo} AS photo_image_url
       FROM ${memberTable} WHERE ${memberFk} = $1::uuid`,
    [groupId],
  );

  return {
    groupType: type === "SSC" ? "PARTYLIST" : "DEPARTMENT",
    groupId: g.id,
    name: g.name,
    description: g.description ?? null,
    posterImageUrl: g.poster_image_url ?? null,
    posterLogoUrl: g.poster_logo_url ?? null,
    schoolYear: g.school_year ?? null,
    canEdit: isPresident(record),
    members: rows.map((m) => ({
      fullName: joinName(m.first_name, m.middle_name, m.last_name),
      position: m.member_position ?? null,
      photoImageUrl: m.photo_image_url ?? null,
    })),
  };
}

type UploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export async function updateGroupInfo(
  authUserId: string,
  type: CandidateType,
  description: string | undefined,
  poster: UploadFile | undefined,
  logo: UploadFile | undefined,
  req: Request,
): Promise<void> {
  const record = await findRecordByAuthUserId(authUserId, type);
  if (!record) throw new IllegalStateError(notInGroup(type));
  if (!isPresident(record))
    throw new ForbiddenError("Only the President can update this information.");

  const groupId = type === "SSC" ? record.partylistId : record.departmentId;
  if (!groupId) throw new IllegalStateError(notLinked(type));

  const before = await loadGroup(type, groupId);

  const sets: string[] = [];
  const params: unknown[] = [groupId];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (description !== undefined) add(G.description, description);
  if (poster && poster.size > 0)
    add(G.poster, await uploadFile(poster, "poster"));
  if (logo && logo.size > 0) add(G.logo, await uploadFile(logo, "logo"));

  if (!sets.length) return;
  const table = type === "SSC" ? CP.tables.partylists : CP.tables.departments;
  await pool.query(
    `UPDATE ${table} SET ${sets.join(", ")}, updated_at = now() WHERE ${G.id} = $1::uuid`,
    params,
  );

  const changes = diffFields(
    { Description: before.description ?? "" },
    {
      Description:
        description !== undefined ? description : (before.description ?? ""),
    },
  ) as Record<string, { from?: unknown; to?: unknown }>;
  if (poster && poster.size > 0)
    changes.Poster = {
      from: before.poster_image_url ? "Uploaded" : "None",
      to: "Uploaded (new file)",
    };
  if (logo && logo.size > 0)
    changes.Logo = {
      from: before.poster_logo_url ? "Uploaded" : "None",
      to: "Uploaded (new file)",
    };

  if (Object.keys(changes).length) {
    await auditLog(
      pool,
      req,
      "UPDATE",
      type === "SSC" ? "Partylists" : "Departments",
      groupId,
      `updated ${type === "SSC" ? "partylist" : "department"} information: ${before.name}`,
      { name: before.name, changes },
    );
  }
}
