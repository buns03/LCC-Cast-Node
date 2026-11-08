import { Request } from "express";
import { pool } from "./db";
import { withTransaction } from "./tx";
import { IllegalArgumentError, IllegalStateError } from "./errors";
import { auditLog } from "./auditLog";
import { realtime } from "./realtime";
import {
  demoteSscMember,
  demoteSscMembers,
  promoteAll,
  promoteToCandidate,
} from "./candidateRoleSync";
import * as repo from "./partylistRepository";
import { MemberJson, PartylistJson } from "./partylistRepository";
import { Db } from "./electionRepository";
import { findExistingImages } from "./candidateImages";
import { sameSchoolYear } from "./schoolTerm";
import { diffFields, listDiff, memberLabel } from "./auditDiff";

/** Port of PartylistService.java (superadmin partylists). */

export interface MemberInput {
  studentId?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  position?: string | null;
  campaignImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  photoImageUrl?: string | null;
}
export interface PartylistInput {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  schoolYear?: string | null;
  campus?: { id?: string | null } | null;
  posterImageUrl?: string | null;
  posterLogoUrl?: string | null;
  status?: string | null;
  members?: MemberInput[] | null;
}

/** Partylist.java serializes its "members" too, so the API responses carry them. */
export async function withMembers(items: PartylistJson[]) {
  const byParty = await repo.membersOf(
    pool,
    items.map((p) => p.id),
  );
  return items.map((p) => ({ ...p, members: byParty.get(p.id) ?? [] }));
}
export const getActive = async () =>
  withMembers(await repo.listByStatus(pool, "ACTIVE"));
export const getByCampus = async (campusId: string) =>
  withMembers(await repo.listByStatusAndCampus(pool, "ACTIVE", campusId));
export const getArchived = async () =>
  withMembers(await repo.listByStatus(pool, "ARCHIVED"));
export const getDeleted = async () =>
  withMembers(await repo.listByStatus(pool, "DELETED"));
export const getCampuses = () => repo.allCampuses(pool);
export const getMembers = (id: string) => repo.listMembers(pool, id);

export async function getById(
  id: string,
  db: Db = pool,
): Promise<PartylistJson> {
  const p = await repo.findById(db, id);
  if (!p) throw new Error("Partylist not found");
  return p;
}

export async function getMember(
  partylistId: string,
  memberId: string,
): Promise<MemberJson> {
  const m = (await repo.listMembers(pool, partylistId)).find(
    (x) => x.id === memberId,
  );
  if (!m) throw new Error("Member does not belong to this partylist.");
  return m;
}

async function resolveCampusId(
  db: Db,
  campus: PartylistInput["campus"],
): Promise<string> {
  if (!campus || !campus.id)
    throw new IllegalArgumentError("Campus is required");
  if (!(await repo.campusExists(db, campus.id)))
    throw new Error("Selected campus was not found.");
  return campus.id;
}

async function assertNotLinkedToActiveElection(db: Db, id: string) {
  if (await repo.linkedToActiveElection(db, id)) {
    throw new IllegalStateError(
      "This partylist is part of an active or upcoming election and cannot be archived or deleted. " +
        "Archive or delete that election first, or wait until it concludes.",
    );
  }
}

/** Same checks the Java validateMembers does (used by the form before saving, and again on save). */
export async function validateMembers(
  db: Db,
  partylistId: string | null,
  campusId: string | null,
  schoolYear: string | null,
  members: MemberInput[] | null | undefined,
  checkSchoolYear = true,
) {
  if (!members || !members.length) return;
  const seen = new Set<string>();

  for (const member of members) {
    if (!member) continue;
    const studentId = (member.studentId ?? "").trim();
    if (!studentId) continue;

    const voter = await repo.findVoterByStudentId(db, studentId);
    if (!voter)
      throw new IllegalArgumentError(`Student ${studentId} was not found.`);
    if (!campusId || campusId !== voter.campusId) {
      throw new IllegalArgumentError(
        `Student ${studentId} does not belong to the selected campus.`,
      );
    }
    if (checkSchoolYear && !sameSchoolYear(voter.schoolYear, schoolYear)) {
      throw new IllegalArgumentError(
        `Student ${studentId} is enrolled in school year ${voter.schoolYear ?? "N/A"}, which does not match the partylist's school year ${schoolYear ?? "N/A"}.`,
      );
    }
    if (seen.has(studentId.toLowerCase())) {
      throw new IllegalArgumentError(
        `Student ${studentId} cannot hold multiple positions in the same partylist.`,
      );
    }
    seen.add(studentId.toLowerCase());

    if (
      await repo.assignedElsewhere(db, studentId, schoolYear ?? "", partylistId)
    ) {
      throw new IllegalArgumentError(
        `Student ${studentId} is already assigned to another partylist for school year ${schoolYear}.`,
      );
    }
  }
}

async function saveMembers(
  db: Db,
  partylist: PartylistJson,
  members: MemberInput[] | null | undefined,
  previous: Map<string, MemberJson> = new Map(),
) {
  if (!members || !members.length) return;
  const ids = new Set<string>();

  for (const member of members) {
    if (!member) continue;
    const studentId = (member.studentId ?? "").trim();
    if (!studentId) throw new IllegalArgumentError("Student ID is required.");
    if (!ids.add(studentId.toLowerCase())) {
      throw new IllegalArgumentError(
        `Student ${studentId} cannot hold multiple positions in the same partylist.`,
      );
    }

    const voter = await repo.findVoterByStudentId(db, studentId);
    if (!voter)
      throw new IllegalArgumentError(`Student ${studentId} was not found.`);
    if (partylist.campus.id !== voter.campusId) {
      throw new IllegalArgumentError(
        `Student ${studentId} does not belong to the selected campus.`,
      );
    }
    if (!sameSchoolYear(voter.schoolYear, partylist.schoolYear)) {
      throw new IllegalArgumentError(
        `Student ${studentId} is enrolled in school year ${voter.schoolYear ?? "N/A"}, which does not match the partylist's school year ${partylist.schoolYear}.`,
      );
    }
    if (
      await repo.assignedElsewhere(
        db,
        studentId,
        partylist.schoolYear,
        partylist.id,
      )
    ) {
      throw new IllegalArgumentError(
        `Student ${studentId} is already assigned to another partylist for school year ${partylist.schoolYear}.`,
      );
    }

    let photo = member.photoImageUrl ?? null;
    let background = member.backgroundImageUrl ?? null;
    let campaign = member.campaignImageUrl ?? null;

    // keep candidate-uploaded images across re-saves
    const prev = previous.get(studentId);
    if (prev) {
      photo = photo ?? prev.photoImageUrl;
      background = background ?? prev.backgroundImageUrl;
      campaign = campaign ?? prev.campaignImageUrl;
    }
    if (!photo && !background && !campaign) {
      const existing = await findExistingImages(db, studentId, "SSC");
      if (existing) {
        photo = existing.photoImageUrl;
        background = existing.backgroundImageUrl;
        campaign = existing.campaignImageUrl;
      }
    }

    await repo.insertMember(db, partylist.id, {
      studentId,
      lastName: member.lastName ?? "",
      firstName: member.firstName ?? "",
      middleName: member.middleName ?? null,
      position: member.position ?? "Member",
      campaignImageUrl: campaign,
      backgroundImageUrl: background,
      photoImageUrl: photo,
    });
    await promoteToCandidate(db, studentId);
  }
}

// ---------------- create ----------------

export async function save(
  input: PartylistInput,
  req: Request,
): Promise<PartylistJson> {
  if (!input) throw new IllegalArgumentError("Partylist data is required");

  const saved = await withTransaction(async (db) => {
    const campusId = await resolveCampusId(db, input.campus);
    const name = (input.name ?? "").trim();

    if (await repo.nameTaken(db, name, null))
      throw new IllegalArgumentError(
        "A partylist with this name already exists.",
      );

    await validateMembers(
      db,
      null,
      campusId,
      input.schoolYear ?? null,
      input.members,
    );

    const id = await repo.insert(db, {
      name: input.name as string,
      description: input.description ?? null,
      campusId,
      schoolYear: input.schoolYear as string,
      posterImageUrl: input.posterImageUrl ?? null,
      posterLogoUrl: input.posterLogoUrl ?? null,
      status: input.status ?? "ACTIVE",
    });
    const partylist = await getById(id, db);

    await saveMembers(db, partylist, input.members);
    await auditLog(
      db,
      req,
      "CREATE",
      "Partylists",
      id,
      `Created partylist: ${partylist.name}`,
      {
        created: {
          Name: partylist.name,
          Description: partylist.description,
          "School year": partylist.schoolYear,
          Campus: partylist.campus.name,
          Members: (input.members ?? [])
            .filter((m) => m && (m.studentId ?? "").trim())
            .map(memberLabel)
            .join(", "),
        },
      },
    );
    return partylist;
  });

  realtime.partylistsChanged(saved.campus.id);
  return saved;
}

// ---------------- update ----------------

export async function update(
  id: string,
  input: PartylistInput,
  req: Request,
): Promise<PartylistJson> {
  if (!input) throw new IllegalArgumentError("Partylist data is required");

  const saved = await withTransaction(async (db) => {
    const existing = await getById(id, db);
    const before = {
      Name: existing.name,
      Description: existing.description,
      "School year": existing.schoolYear,
      Campus: existing.campus.name,
    };
    if (await repo.nameTaken(db, (input.name ?? "").trim(), id)) {
      throw new IllegalArgumentError(
        "A partylist with the same name already exists.",
      );
    }

    existing.name = input.name as string;
    existing.description = input.description ?? null;
    existing.schoolYear = input.schoolYear as string;
    if (input.posterImageUrl != null)
      existing.posterImageUrl = input.posterImageUrl;
    if (input.posterLogoUrl != null)
      existing.posterLogoUrl = input.posterLogoUrl;
    if (input.campus != null)
      existing.campus.id = await resolveCampusId(db, input.campus);

    await validateMembers(
      db,
      id,
      existing.campus.id,
      existing.schoolYear,
      input.members,
    );
    await repo.updateFields(db, existing);
    const partylist = await getById(id, db);

    // snapshot who is a member now, before the rows are replaced
    const oldMembers = await repo.listMembers(db, id);
    const previous = new Map<string, MemberJson>();
    for (const m of oldMembers)
      if (
        m.studentId &&
        m.studentId.trim() &&
        !previous.has(m.studentId.trim())
      )
        previous.set(m.studentId.trim(), m);

    await repo.deleteMembers(db, id);
    await saveMembers(db, partylist, input.members, previous);

    // demote anyone who was a member before but is not anymore
    const newIds = new Set(
      (input.members ?? [])
        .filter(Boolean)
        .map((m) => (m.studentId ?? "").trim()),
    );
    for (const old of oldMembers)
      if (!newIds.has(old.studentId)) await demoteSscMember(db, old.studentId);

    const after = {
      Name: partylist.name,
      Description: partylist.description,
      "School year": partylist.schoolYear,
      Campus: partylist.campus.name,
    };
    const changes = {
      ...diffFields(before, after),
      ...listDiff(
        "Members",
        oldMembers.map(memberLabel),
        (input.members ?? [])
          .filter((m) => m && (m.studentId ?? "").trim())
          .map(memberLabel),
      ),
    };
    await auditLog(
      db,
      req,
      "UPDATE",
      "Partylists",
      id,
      `Updated partylist: ${partylist.name}`,
      { name: partylist.name, changes },
    );
    return partylist;
  });

  realtime.partylistsChanged(saved.campus.id);
  return saved;
}

// ---------------- archive / delete / restore ----------------

async function snapshot(db: Db, p: PartylistJson): Promise<string> {
  const members = await repo.listMembers(db, p.id);
  return JSON.stringify({
    id: p.id,
    name: p.name,
    description: p.description,
    schoolYear: p.schoolYear,
    status: p.status,
    createdBy: p.createdBy,
    posterImageUrl: p.posterImageUrl,
    posterLogoUrl: p.posterLogoUrl,
    campus: {
      id: p.campus.id,
      name: p.campus.name,
      description: p.campus.description,
      status: p.campus.status,
    },
    members: members.map((m) => ({
      id: m.id,
      studentId: m.studentId,
      lastName: m.lastName,
      firstName: m.firstName,
      middleName: m.middleName,
      position: m.position,
      campaignImageUrl: m.campaignImageUrl,
      backgroundImageUrl: m.backgroundImageUrl,
      photoImageUrl: m.photoImageUrl,
    })),
  });
}

export async function archive(id: string, req: Request): Promise<void> {
  const p = await withTransaction(async (db) => {
    const partylist = await getById(id, db);
    if (partylist.status !== "ACTIVE")
      throw new Error("Only active partylists can be archived");
    await assertNotLinkedToActiveElection(db, id);

    await repo.insertArchive(db, {
      entityId: id,
      entityName: partylist.name,
      data: await snapshot(db, partylist),
      by: req.session.user?.userId ?? null,
    });
    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);

    await repo.setStatus(db, id, "ARCHIVED");
    await demoteSscMembers(db, studentIds);
    await auditLog(
      db,
      req,
      "ARCHIVE",
      "Partylists",
      id,
      `Archived partylist: ${partylist.name}`,
      null,
    );
    return partylist;
  });
  realtime.partylistsChanged(p.campus.id);
  realtime.historyChanged("archives");
}

export async function remove(id: string, req: Request): Promise<void> {
  const p = await withTransaction(async (db) => {
    const partylist = await getById(id, db);
    if (partylist.status === "DELETED")
      throw new Error("Partylist is already deleted");
    await assertNotLinkedToActiveElection(db, id);

    await repo.insertTrash(db, {
      entityId: id,
      entityName: partylist.name,
      data: await snapshot(db, partylist),
      by: req.session.user?.userId ?? null,
    });
    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);

    await repo.setStatus(db, id, "DELETED");
    await demoteSscMembers(db, studentIds);
    await auditLog(
      db,
      req,
      "DELETE",
      "Partylists",
      id,
      `Moved partylist to trash: ${partylist.name}`,
      null,
    );
    return partylist;
  });
  realtime.partylistsChanged(p.campus.id);
  realtime.historyChanged("trash");
}

export async function restore(id: string, req: Request): Promise<void> {
  const p = await withTransaction(async (db) => {
    const partylist = await getById(id, db);
    if (partylist.status !== "DELETED" && partylist.status !== "ARCHIVED")
      throw new Error("Partylist cannot be restored");
    if (await repo.nameTaken(db, partylist.name.trim(), id))
      throw new IllegalArgumentError(
        "A partylist with the same name already exists.",
      );

    const members = await repo.listMembers(db, id);
    await validateMembers(
      db,
      id,
      partylist.campus.id,
      partylist.schoolYear,
      members,
      false,
    );

    await repo.setStatus(db, id, "ACTIVE");
    await promoteAll(
      db,
      members.map((m) => m.studentId),
    );
    await repo.markRecordsRestored(db, id);
    await auditLog(
      db,
      req,
      "RESTORE",
      "Partylists",
      id,
      `Restored partylist: ${partylist.name}`,
      null,
    );
    return partylist;
  });
  realtime.partylistsChanged(p.campus.id);
}

export async function permanentlyDelete(id: string): Promise<void> {
  await withTransaction(async (db) => {
    const partylist = await getById(id, db);
    if (partylist.status !== "DELETED")
      throw new Error("Only trashed partylists can be permanently deleted.");

    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);
    await repo.deleteMembers(db, id);
    await repo.deleteTrashRecords(db, id);
    await repo.deletePartylist(db, id);
    await demoteSscMembers(db, studentIds);
  });
}
