import { Request } from "express";
import { pool } from "./db";
import { withTransaction } from "./tx";
import { IllegalArgumentError, IllegalStateError } from "./errors";
import { auditLog } from "./auditLog";
import { realtime } from "./realtime";
import {
  demoteDepartmentMember,
  demoteDepartmentMembers,
  promoteAll,
  promoteToCandidate,
} from "./candidateRoleSync";
import { findExistingImages } from "./candidateImages";
import { programCourseMatches } from "./programCourse";
import * as repo from "./departmentRepository";
import { DepartmentJson, DeptMemberJson } from "./departmentRepository";
import {
  allCampuses,
  campusExists,
  findVoterByStudentId,
} from "./partylistRepository";
import { Db } from "./electionRepository";
import { resolveOfferedProgram } from "./systemConfigService";
import { sameSchoolYear } from "./schoolTerm";
import { diffFields, listDiff, memberLabel } from "./auditDiff";

/** Port of DepartmentService.java (superadmin departments). */

export interface DeptMemberInput {
  studentId?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  position?: string | null;
  campaignImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  photoImageUrl?: string | null;
}
export interface DepartmentInput {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  schoolYear?: string | null;
  positions?: string[] | null;
  votingType?: string | null;
  campus?: { id?: string | null } | null;
  posterImageUrl?: string | null;
  posterLogoUrl?: string | null;
  code?: string | null;
  status?: string | null;
  members?: DeptMemberInput[] | null;
}

/** Department.java serializes its "members" too. */
export async function withMembers(items: DepartmentJson[]) {
  const by = await repo.membersOf(
    pool,
    items.map((d) => d.id),
  );
  return items.map((d) => ({ ...d, members: by.get(d.id) ?? [] }));
}
export const getActive = async () =>
  withMembers(await repo.listByStatus(pool, "ACTIVE"));
export const getArchived = async () =>
  withMembers(await repo.listByStatus(pool, "ARCHIVED"));
export const getDeleted = async () =>
  withMembers(await repo.listByStatus(pool, "DELETED"));
export const getCampuses = () => allCampuses(pool);
export const getMembers = (id: string) => repo.listMembers(pool, id);

export async function getById(
  id: string,
  db: Db = pool,
): Promise<DepartmentJson> {
  const d = await repo.findById(db, id);
  if (!d) throw new Error("Department not found");
  return d;
}

export async function getMember(
  departmentId: string,
  memberId: string,
): Promise<DeptMemberJson> {
  const m = (await repo.listMembers(pool, departmentId)).find(
    (x) => x.id === memberId,
  );
  if (!m) throw new Error("Member does not belong to this department.");
  return m;
}

// ---------------- student lookups (the member rows autofill from these) ----------------

async function findDepartmentVoter(
  db: Db,
  studentId: string,
  campusId: string | null,
  departmentName: string | null,
) {
  if (!campusId) throw new IllegalArgumentError("Campus is required.");
  if (!departmentName || !departmentName.trim())
    throw new IllegalArgumentError("Department is required.");
  const voter = await findVoterByStudentId(db, (studentId ?? "").trim());
  if (
    !voter ||
    voter.campusId !== campusId ||
    !programCourseMatches(voter.programCourse, departmentName)
  ) {
    throw new IllegalArgumentError(
      "Student does not belong to the selected campus and department.",
    );
  }
  return voter;
}

export async function getStudentForDepartmentMember(
  studentId: string,
  departmentId: string,
  db: Db = pool,
) {
  const d = await getById(departmentId, db);
  return findDepartmentVoter(db, studentId, d.campus.id, d.name);
}

export async function getStudentByCampusAndDepartment(
  studentId: string,
  campusId: string,
  departmentId: string,
) {
  const d = await getById(departmentId);
  if (d.campus.id !== campusId)
    throw new IllegalArgumentError(
      "Department does not belong to the selected campus.",
    );
  return findDepartmentVoter(pool, studentId, campusId, d.name);
}

export const getStudentByCampusAndName = (
  studentId: string,
  campusId: string,
  departmentName: string,
) => findDepartmentVoter(pool, studentId, campusId, departmentName);

export async function getStudentMembershipsBySchoolYear(
  studentId: string,
  schoolYear: string,
  excludeDepartmentId: string | null,
) {
  if (!studentId || !studentId.trim())
    throw new IllegalArgumentError("Student ID is required.");
  if (!schoolYear || !schoolYear.trim())
    throw new IllegalArgumentError("School year is required.");
  const rows = await repo.activeMemberships(
    pool,
    studentId.trim(),
    schoolYear.trim(),
  );
  return rows
    .filter(
      (m) => !excludeDepartmentId || m.departmentId !== excludeDepartmentId,
    )
    .map(({ departmentId: _d, ...m }) => m);
}

// ---------------- helpers ----------------

async function resolveCampusId(
  db: Db,
  campus: DepartmentInput["campus"],
): Promise<string> {
  if (!campus || !campus.id)
    throw new IllegalArgumentError("Campus is required");
  if (!(await campusExists(db, campus.id)))
    throw new Error("Selected campus was not found.");
  return campus.id;
}

const filledMembers = (members: DeptMemberInput[] | null | undefined) =>
  (members ?? []).filter((m) => m && m.studentId && m.studentId.trim());

function titleWithPrefix(name: string, title: string): string {
  const prefix = `${name} - `;
  return title.startsWith(prefix) ? title : prefix + title;
}

async function assertNotLinkedToActiveElection(db: Db, id: string) {
  if (await repo.linkedToActiveElection(db, id)) {
    throw new IllegalStateError(
      "This department is part of an active or upcoming election and cannot be archived or deleted. " +
        "Archive or delete that election first, or wait until it concludes.",
    );
  }
}

async function saveMembers(
  db: Db,
  department: DepartmentJson,
  members: DeptMemberInput[] | null | undefined,
  previous: Map<string, DeptMemberJson> = new Map(),
) {
  if (!members || !members.length) return;
  if (!department.campus.id)
    throw new IllegalArgumentError("Department campus is required.");
  const ids = new Set<string>();

  for (const member of members) {
    if (!member) continue;
    if (!member.studentId || !member.studentId.trim())
      throw new IllegalArgumentError("Student ID is required.");
    const studentId = member.studentId.trim();
    if (!ids.add(studentId))
      throw new IllegalArgumentError(
        "A student cannot be added more than once to the same department.",
      );

    let position = member.position ?? null;
    if (department.votingType === "PARTYLIST") {
      if (!position || !position.trim())
        throw new IllegalArgumentError(
          "Each partylist member must have a position.",
        );
      position = position.trim();
    }

    const voter = await findDepartmentVoter(
      db,
      studentId,
      department.campus.id,
      department.name,
    );

    if (!sameSchoolYear(voter.schoolYear, department.schoolYear)) {
      throw new IllegalArgumentError(
        `Student ${studentId} is enrolled in school year ${voter.schoolYear ?? "N/A"}, which does not match the department's school year ${department.schoolYear}.`,
      );
    }

    const existing = await repo.activeMemberships(
      db,
      studentId,
      department.schoolYear,
    );
    if (existing.length) {
      if (existing.some((m) => m.departmentId === department.id)) {
        throw new IllegalArgumentError(
          "This student is already a member of this department for the selected school year.",
        );
      }
      throw new IllegalArgumentError(
        "This student is already a member of another department for the selected school year.",
      );
    }

    let photo = member.photoImageUrl ?? null;
    let background = member.backgroundImageUrl ?? null;
    let campaign = member.campaignImageUrl ?? null;

    const prev = previous.get(voter.studentId);
    if (prev) {
      photo = photo ?? prev.photoImageUrl;
      background = background ?? prev.backgroundImageUrl;
      campaign = campaign ?? prev.campaignImageUrl;
    }
    if (!photo && !background && !campaign) {
      const images = await findExistingImages(
        db,
        voter.studentId,
        "DEPARTMENT",
      );
      if (images) {
        photo = images.photoImageUrl;
        background = images.backgroundImageUrl;
        campaign = images.campaignImageUrl;
      }
    }

    await repo.insertMember(db, department.id, {
      studentId: voter.studentId,
      lastName: member.lastName ?? "",
      firstName: member.firstName ?? "",
      middleName: member.middleName ?? null,
      position,
      campaignImageUrl: campaign,
      backgroundImageUrl: background,
      photoImageUrl: photo,
    });
    await promoteToCandidate(db, voter.studentId);
  }
}

// ---------------- create ----------------

export async function save(
  input: DepartmentInput,
  req: Request,
): Promise<DepartmentJson> {
  if (!input) throw new IllegalArgumentError("Department data is required");

  const saved = await withTransaction(async (db) => {
    const campusId = await resolveCampusId(db, input.campus);

    if (!input.name || !input.name.trim())
      throw new IllegalArgumentError("Department name is required.");
    const name = await resolveOfferedProgram(db, campusId, input.name.trim());

    if (!input.title || !input.title.trim())
      throw new IllegalArgumentError("Department title is required.");
    const title = titleWithPrefix(name, input.title.trim());

    if (await repo.titleExists(db, title, null))
      throw new IllegalArgumentError(
        `A department with the title "${title}" already exists.`,
      );

    const votingType =
      input.votingType === "PARTYLIST" || input.votingType === "REPRESENTATIVE"
        ? input.votingType
        : null;
    if (!votingType) throw new IllegalArgumentError("Voting type is required.");

    const positions = input.positions ?? [];
    if (votingType === "REPRESENTATIVE" && !positions.length)
      throw new IllegalArgumentError(
        "At least one department position is required.",
      );

    const seen = new Set<string>();
    for (const p of positions) {
      if (p == null || !String(p).trim())
        throw new IllegalArgumentError("Department positions cannot be blank.");
      if (seen.has(String(p).trim()))
        throw new IllegalArgumentError(
          "A department position cannot be added more than once.",
        );
      seen.add(String(p).trim());
    }

    if (
      votingType === "REPRESENTATIVE" &&
      filledMembers(input.members).length < positions.length
    ) {
      throw new IllegalArgumentError(
        `The department must have at least ${positions.length} member(s) for the selected positions.`,
      );
    }

    const id = await repo.insert(db, {
      name,
      title,
      description: input.description ?? null,
      campusId,
      schoolYear: input.schoolYear as string,
      positions,
      votingType,
      posterImageUrl: input.posterImageUrl ?? null,
      posterLogoUrl: input.posterLogoUrl ?? null,
      code: input.code ?? null,
      status: input.status ?? "ACTIVE",
    });
    const department = await getById(id, db);

    await saveMembers(db, department, input.members);
    await auditLog(
      db,
      req,
      "CREATE",
      "Departments",
      id,
      `Created department: ${department.title}`,
      {
        created: {
          Name: department.name,
          Title: department.title,
          Description: department.description,
          "School year": department.schoolYear,
          Campus: department.campus.name,
          "Voting type": department.votingType,
          Positions: department.positions,
          Members: filledMembers(input.members).map(memberLabel).join(", "),
        },
      },
    );
    return department;
  });

  realtime.departmentsChanged(saved.campus.id);
  return saved;
}

// ---------------- update ----------------

export async function update(
  id: string,
  input: DepartmentInput,
  req: Request,
): Promise<DepartmentJson> {
  if (!input) throw new IllegalArgumentError("Department data is required");

  const saved = await withTransaction(async (db) => {
    const existing = await getById(id, db);
    const before = {
      Name: existing.name,
      Title: existing.title,
      Description: existing.description,
      "School year": existing.schoolYear,
      Campus: existing.campus.name,
      "Voting type": existing.votingType,
      Positions: existing.positions,
    };
    existing.campus.id = await resolveCampusId(db, input.campus);

    if (!input.name || !input.name.trim())
      throw new IllegalArgumentError("Department name is required.");
    existing.name = await resolveOfferedProgram(
      db,
      existing.campus.id,
      input.name.trim(),
      existing.name,
    );

    if (!input.title || !input.title.trim())
      throw new IllegalArgumentError("Department title is required.");
    const title = titleWithPrefix(existing.name, input.title.trim());
    if (await repo.titleExists(db, title, id))
      throw new IllegalArgumentError(
        `A department with the title "${title}" already exists.`,
      );

    existing.title = title;
    existing.description = input.description ?? null;
    existing.schoolYear = input.schoolYear as string;
    existing.positions = input.positions ?? [];
    existing.posterImageUrl = input.posterImageUrl ?? null;
    existing.posterLogoUrl = input.posterLogoUrl ?? null;

    const votingType =
      input.votingType === "PARTYLIST" || input.votingType === "REPRESENTATIVE"
        ? input.votingType
        : null;
    if (!votingType) throw new IllegalArgumentError("Voting type is required.");
    existing.votingType = votingType;

    if (votingType === "REPRESENTATIVE") {
      if (!input.positions || !input.positions.length)
        throw new IllegalArgumentError(
          "At least one department position is required.",
        );
      if (filledMembers(input.members).length < input.positions.length) {
        throw new IllegalArgumentError(
          `The department must have at least ${input.positions.length} member(s) for the selected positions.`,
        );
      }
    }

    await repo.updateFields(db, existing);
    const department = await getById(id, db);

    const oldMembers = await repo.listMembers(db, id);
    const previous = new Map<string, DeptMemberJson>();
    for (const m of oldMembers)
      if (
        m.studentId &&
        m.studentId.trim() &&
        !previous.has(m.studentId.trim())
      )
        previous.set(m.studentId.trim(), m);

    const updatedMembers = input.members ?? null;
    const seen = new Set<string>();
    for (const m of filledMembers(updatedMembers)) {
      const sid = m.studentId!.trim();
      if (seen.has(sid))
        throw new IllegalArgumentError(
          "A student cannot be added more than once to the same department.",
        );
      seen.add(sid);
    }
    for (const m of filledMembers(updatedMembers)) {
      const memberships = await repo.activeMemberships(
        db,
        m.studentId as string,
        department.schoolYear,
      );
      if (
        memberships.length &&
        !memberships.some((x) => x.departmentId === id)
      ) {
        throw new IllegalArgumentError(
          "This student is already a member of another department for the selected school year.",
        );
      }
    }

    await repo.deleteMembers(db, id);
    await saveMembers(db, department, updatedMembers, previous);

    const newIds = new Set(
      (updatedMembers ?? [])
        .filter(Boolean)
        .map((m) => (m.studentId ?? "").trim()),
    );
    for (const old of oldMembers)
      if (!newIds.has(old.studentId))
        await demoteDepartmentMember(db, old.studentId);

    const after = {
      Name: department.name,
      Title: department.title,
      Description: department.description,
      "School year": department.schoolYear,
      Campus: department.campus.name,
      "Voting type": department.votingType,
      Positions: department.positions,
    };
    const changes = {
      ...diffFields(before, after),
      ...listDiff(
        "Members",
        oldMembers.map(memberLabel),
        filledMembers(updatedMembers).map(memberLabel),
      ),
    };
    await auditLog(
      db,
      req,
      "UPDATE",
      "Departments",
      id,
      `Updated department: ${department.title}`,
      { name: department.title, changes },
    );
    return department;
  });

  realtime.departmentsChanged(saved.campus.id);
  return saved;
}

// ---------------- archive / delete / restore ----------------

async function snapshot(db: Db, d: DepartmentJson): Promise<string> {
  const members = await repo.listMembers(db, d.id);
  return JSON.stringify({
    id: d.id,
    name: d.name,
    title: d.title,
    description: d.description,
    schoolYear: d.schoolYear,
    votingType: d.votingType,
    status: d.status,
    createdBy: d.createdBy,
    posterImageUrl: d.posterImageUrl,
    posterLogoUrl: d.posterLogoUrl,
    campus: {
      id: d.campus.id,
      name: d.campus.name,
      description: d.campus.description,
      status: d.campus.status,
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
  const d = await withTransaction(async (db) => {
    const dept = await getById(id, db);
    if (dept.status !== "ACTIVE")
      throw new Error("Only active departments can be archived");
    await assertNotLinkedToActiveElection(db, id);

    await repo.insertArchive(db, {
      entityId: id,
      entityName: dept.title ?? "",
      data: await snapshot(db, dept),
      by: req.session.user?.userId ?? null,
    });
    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);

    await repo.setStatus(db, id, "ARCHIVED");
    await demoteDepartmentMembers(db, studentIds);
    await auditLog(
      db,
      req,
      "ARCHIVE",
      "Departments",
      id,
      `Archived department: ${dept.title}`,
      null,
    );
    return dept;
  });
  realtime.departmentsChanged(d.campus.id);
  realtime.historyChanged("archives");
}

export async function remove(id: string, req: Request): Promise<void> {
  const d = await withTransaction(async (db) => {
    const dept = await getById(id, db);
    if (dept.status === "DELETED")
      throw new Error("Department is already deleted");
    await assertNotLinkedToActiveElection(db, id);

    await repo.insertTrash(db, {
      entityId: id,
      entityName: dept.title ?? "",
      data: await snapshot(db, dept),
      by: req.session.user?.userId ?? null,
    });
    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);

    await repo.setStatus(db, id, "DELETED");
    await demoteDepartmentMembers(db, studentIds);
    await auditLog(
      db,
      req,
      "DELETE",
      "Departments",
      id,
      `Moved department to trash: ${dept.title}`,
      null,
    );
    return dept;
  });
  realtime.departmentsChanged(d.campus.id);
  realtime.historyChanged("trash");
}

/** a restored department must not clash with a student who is now in another ACTIVE department of that school year */
export async function assertMembersRestorable(db: Db, d: DepartmentJson) {
  for (const m of await repo.listMembers(db, d.id)) {
    if (!m.studentId || !m.studentId.trim()) continue;
    const active = await repo.activeMemberships(db, m.studentId, d.schoolYear);
    if (active.some((a) => a.departmentId !== d.id)) {
      throw new IllegalArgumentError(
        `This department cannot be restored because student ${m.studentId} is already a member of an active department for the selected school year.`,
      );
    }
  }
}

export async function restore(id: string, req: Request): Promise<void> {
  const d = await withTransaction(async (db) => {
    const dept = await getById(id, db);
    await assertMembersRestorable(db, dept);
    if (dept.status !== "DELETED" && dept.status !== "ARCHIVED")
      throw new Error("Department cannot be restored");

    await repo.setStatus(db, id, "ACTIVE");
    await promoteAll(
      db,
      (await repo.listMembers(db, id)).map((m) => m.studentId),
    );
    await repo.markRecordsRestored(db, id);
    await auditLog(
      db,
      req,
      "RESTORE",
      "Departments",
      id,
      `Restored department: ${dept.title}`,
      null,
    );
    return dept;
  });
  realtime.departmentsChanged(d.campus.id);
}

export async function permanentlyDelete(id: string): Promise<void> {
  await withTransaction(async (db) => {
    const dept = await getById(id, db);
    if (dept.status !== "DELETED")
      throw new Error("Only trashed departments can be permanently deleted.");

    const studentIds = (await repo.listMembers(db, id)).map((m) => m.studentId);
    await repo.deleteMembers(db, id);
    await repo.deleteTrashRecords(db, id);
    await repo.deleteDepartment(db, id);
    await demoteDepartmentMembers(db, studentIds);
  });
}
