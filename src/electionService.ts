import { Request } from "express";
import { pool } from "./db";
import { withTransaction } from "./tx";
import { IllegalArgumentError, IllegalStateError } from "./errors";
import { auditLog } from "./auditLog";
import { demoteAllIfNoLongerCandidate } from "./candidateRoleSync";
import { extractProgramCode } from "./departmentUtils";
import { findCampusName } from "./repositories";
import { emitVoteCast, realtime } from "./realtime";
import * as repo from "./electionRepository";
import {
  Db,
  Election,
  ElectionCategory,
  isDrawElection,
} from "./electionRepository";
import { sameSchoolYear } from "./schoolTerm";
import { diffFields, listDiff } from "./auditDiff";

/**
 * Port of ElectionService.java + ElectionSchoolYearGuard.java (+ the parts of
 * ElectionVoteSyncService / ElectionEmailService that the elections page needs).
 */

const NO_ELECTION = "00000000-0000-0000-0000-000000000000";

export interface ElectionInput {
  title: string | null;
  category: ElectionCategory | null;
  campusId: string | null;
  schoolYear: string | null;
  startAt: Date | null;
  endAt: Date | null;
  partylistIds: string[] | null;
  departmentIds: string[] | null;
  semester?: number | null;
}

// ============================================================
// reads
// ============================================================

export const getAllActive = () => repo.listByStatus(pool, "ACTIVE");
export const getByCampus = (campusId: string) =>
  repo.listByCampusAndStatus(pool, campusId, "ACTIVE");

export async function getById(id: string, db: Db = pool): Promise<Election> {
  const e = await repo.findByIdAndStatus(db, id, "ACTIVE");
  if (!e) throw new Error("Election not found.");
  return e;
}

/** ACTIVE (not started yet) -> ONGOING -> CONCLUDED. Computed from the schedule, never stored. */
export function calculateElectionStatus(
  e: Election,
): "ACTIVE" | "ONGOING" | "CONCLUDED" {
  if (!e.startAt || !e.endAt) return "ACTIVE";
  const now = Date.now();
  if (now < e.startAt.getTime()) return "ACTIVE";
  if (now <= e.endAt.getTime()) return "ONGOING";
  return "CONCLUDED";
}

export async function toResponse(e: Election) {
  const status = calculateElectionStatus(e);
  const [campusName, partylists, departments] = await Promise.all([
    findCampusName(e.campusId),
    repo.partylistLinks(pool, e.id),
    repo.departmentLinks(pool, e.id),
  ]);

  return {
    id: e.id,
    title: e.title,
    category: e.category,
    campusId: e.campusId,
    campusName,
    schoolYear: e.schoolYear,
    startAt: e.startAt,
    endAt: e.endAt,
    status,
    active: status !== "CONCLUDED",
    partylistIds: partylists.map((p) => p.id),
    partylistNames: partylists.map((p) => p.name),
    departmentIds: departments.map((d) => d.id),
    departmentNames: departments.map((d) => d.title),
    departmentTypes: departments.map((d) => d.votingType),
    description: null,
    parentElectionId: e.parentElectionId,
    drawElection: isDrawElection(e),
    drawPositions: e.drawPositions,
  };
}

// ============================================================
// validation shared by create + update
// ============================================================

function validateBasics(i: ElectionInput) {
  if (!i.title || !i.title.trim())
    throw new IllegalArgumentError("Election title is required.");
  if (!i.category)
    throw new IllegalArgumentError("Election category is required.");
  if (!i.campusId) throw new IllegalArgumentError("Campus is required.");
  if (!i.schoolYear || !i.schoolYear.trim())
    throw new IllegalArgumentError("School year is required.");
  if (!i.startAt || !i.endAt)
    throw new IllegalArgumentError("Election schedule is required.");
  if (!(i.endAt.getTime() > i.startAt.getTime()))
    throw new IllegalArgumentError("End date must be after start date.");
  if (i.semester != null && ![1, 2, 3].includes(i.semester))
    throw new IllegalArgumentError("Invalid semester.");
}

/** Every group must field the exact same set of positions (case-insensitive, blanks ignored). */
function positionSet(members: repo.Member[]): Set<string> {
  return new Set(
    members
      .map((m) => m.position)
      .filter((p): p is string => !!p && !!p.trim())
      .map((p) => p.trim().toLowerCase()),
  );
}
const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

async function assertBalancedPartylistPositions(
  db: Db,
  partylistIds: string[],
) {
  let reference: Set<string> | null = null;
  for (const id of partylistIds) {
    const positions = positionSet(await repo.partylistMembers(db, id));
    if (reference === null) reference = positions;
    else if (!sameSet(reference, positions)) {
      throw new IllegalArgumentError(
        "All partylists must have the exact same set of positions. " +
          "Every partylist must field a candidate for every position " +
          "(e.g., if one partylist has an Auditor, every partylist must have one).",
      );
    }
  }
}

async function assertBalancedDepartmentPositions(
  db: Db,
  departmentIds: string[],
) {
  let reference: Set<string> | null = null;
  for (const id of departmentIds) {
    const positions = positionSet(await repo.departmentMembers(db, id));
    if (reference === null) reference = positions;
    else if (!sameSet(reference, positions)) {
      throw new IllegalArgumentError(
        "All departments in this election must have the exact same set of positions. " +
          "Every department must field a candidate for every position " +
          "(e.g., if one department has an Auditor, every department must have one).",
      );
    }
  }
}

async function getDepartmentVotingType(
  db: Db,
  departmentId: string,
): Promise<string | null> {
  const d = await repo.findDepartment(db, departmentId);
  if (!d) throw new IllegalArgumentError("Department not found.");
  return d.votingType;
}

// ============================================================
// one active election per school year (ElectionSchoolYearGuard)
// ============================================================

export async function assertSchoolYearAvailable(
  db: Db,
  category: ElectionCategory | null,
  campusId: string,
  schoolYear: string | null,
  departmentIds: string[] | null,
  excludeElectionId: string | null,
  semester: number | null = null,
) {
  if (excludeElectionId) {
    const existing = await repo.findById(db, excludeElectionId);
    if (existing && isDrawElection(existing)) return; // draw elections are exempt
  }
  if (!category || !schoolYear) return;

  const sy = schoolYear.trim();
  const exclude = excludeElectionId ?? NO_ELECTION;

  if (category === "SSC") {
    if (
      await repo.existsOtherByCategoryCampusYear(
        db,
        "SSC",
        campusId,
        sy,
        "ACTIVE",
        exclude,
      )
    ) {
      throw new IllegalStateError(
        `An active SSC election for school year ${sy} already exists for this campus. Only one election per school year is allowed — delete or archive the existing one first.`,
      );
    }
    return;
  }

  if (category === "DEPARTMENT" && departmentIds && departmentIds.length) {
    const requested = new Set(
      (await repo.findDepartmentsByIds(db, departmentIds))
        .map((d) => extractProgramCode(d))
        .filter((c): c is string => !!c)
        .map((c) => c.trim().toUpperCase()),
    );

    const others = await repo.listOtherByCategoryCampusYear(
      db,
      "DEPARTMENT",
      campusId,
      sy,
      "ACTIVE",
      exclude,
    );
    for (const other of others) {
      for (const dept of await repo.departmentLinks(db, other.id)) {
        const code = extractProgramCode(dept);
        if (code && requested.has(code.trim().toUpperCase())) {
          throw new IllegalStateError(
            `An active election for ${code.trim().toUpperCase()} in school year ${sy} already exists for this campus. Only one election per school year is allowed — delete or archive the existing one first.`,
          );
        }
      }
    }
  }
}

// ============================================================
// linking partylists / departments + generating candidates
// ============================================================

async function linkPartylists(
  db: Db,
  election: Election,
  partylistIds: string[] | null,
  campusId: string,
  replaceCandidates: boolean,
) {
  if (!partylistIds || !partylistIds.length) {
    throw new IllegalArgumentError(
      "SSC election requires at least one partylist.",
    );
  }
  await assertBalancedPartylistPositions(db, partylistIds);

  if (replaceCandidates) await repo.deleteCandidatesByElection(db, election.id);

  for (const partylistId of partylistIds) {
    const partylistCampus = await repo.findPartylistCampusId(db, partylistId);
    if (partylistCampus === null)
      throw new IllegalArgumentError("Partylist not found.");
    if (partylistCampus !== campusId) {
      throw new IllegalArgumentError(
        "Partylist does not belong to the selected campus.",
      );
    }

    const plYear = (
      await db.query(`SELECT school_year FROM partylists WHERE id = $1::uuid`, [
        partylistId,
      ])
    ).rows[0]?.school_year as string | null | undefined;
    if (!sameSchoolYear(plYear, election.schoolYear)) {
      throw new IllegalArgumentError(
        `Partylist school year (${plYear ?? "N/A"}) does not match the election's school year (${election.schoolYear}).`,
      );
    }

    await repo.insertPartylistLink(db, election.id, partylistId);

    for (const member of await repo.partylistMembers(db, partylistId)) {
      await repo.insertCandidate(db, {
        electionId: election.id,
        partylistId,
        member,
        position: member.position,
      });
    }
  }
}

async function linkDepartments(
  db: Db,
  election: Election,
  departmentIds: string[] | null,
  campusId: string,
  replaceCandidates: boolean,
) {
  if (!departmentIds || !departmentIds.length) {
    throw new IllegalArgumentError(
      "Department election requires at least one department.",
    );
  }

  const firstVotingType = await getDepartmentVotingType(db, departmentIds[0]);

  if (firstVotingType === "PARTYLIST" && departmentIds.length < 2) {
    throw new IllegalArgumentError(
      "Partylist voting requires at least two departments.",
    );
  }
  if (firstVotingType === "REPRESENTATIVE" && departmentIds.length > 1) {
    throw new IllegalArgumentError(
      "Representative voting allows only one department.",
    );
  }
  if (firstVotingType === "PARTYLIST")
    await assertBalancedDepartmentPositions(db, departmentIds);

  if (replaceCandidates) await repo.deleteCandidatesByElection(db, election.id);

  let selectedVotingType: string | null = null;

  for (const departmentId of departmentIds) {
    const votingType = await getDepartmentVotingType(db, departmentId);

    if (selectedVotingType === null) selectedVotingType = votingType;
    else if (votingType !== selectedVotingType) {
      throw new IllegalArgumentError(
        "All selected departments must have the same voting type.",
      );
    }

    const department = await repo.findDepartment(db, departmentId);
    if (!department) throw new IllegalArgumentError("Department not found.");
    if (department.campusId !== campusId) {
      throw new IllegalArgumentError(
        "Department does not belong to the selected campus.",
      );
    }
    const deptYear = (
      await db.query(
        `SELECT school_year FROM departments WHERE id = $1::uuid`,
        [departmentId],
      )
    ).rows[0]?.school_year as string | null | undefined;
    if (!sameSchoolYear(deptYear, election.schoolYear)) {
      throw new IllegalArgumentError(
        `Department school year (${deptYear ?? "N/A"}) does not match the election's school year (${election.schoolYear}).`,
      );
    }

    await repo.insertDepartmentLink(db, election.id, departmentId);

    for (const member of await repo.departmentMembers(db, departmentId)) {
      await repo.insertCandidate(db, {
        electionId: election.id,
        departmentId,
        member,
        position: votingType === "PARTYLIST" ? member.position : null,
      });
    }
  }
}

// ============================================================
// create
// ============================================================

export async function createElection(
  input: ElectionInput,
  createdBy: string,
  req: Request,
): Promise<Election> {
  validateBasics(input);
  const category = input.category!;
  const campusId = input.campusId!;

  const saved = await withTransaction(async (db) => {
    await assertSchoolYearAvailable(
      db,
      category,
      campusId,
      input.schoolYear,
      input.departmentIds,
      null,
      input.semester ?? null,
    );

    const election = await repo.insertElection(db, {
      title: input.title!.trim(),
      category,
      campusId,
      schoolYear: input.schoolYear!.trim(),
      startAt: input.startAt!,
      endAt: input.endAt!,
      createdBy,
      semester: input.semester ?? null,
    });

    await auditLog(
      db,
      req,
      "CREATE",
      "Elections",
      election.id,
      `created election: ${election.title}`,
      {
        title: election.title,
        category: election.category,
        campusId: election.campusId,
        schoolYear: election.schoolYear,
      },
    );

    if (category === "SSC")
      await linkPartylists(db, election, input.partylistIds, campusId, false);
    if (category === "DEPARTMENT")
      await linkDepartments(db, election, input.departmentIds, campusId, false);

    return election;
  });

  realtime.electionsChanged(saved.campusId);
  return saved;
}

// ============================================================
// update
// ============================================================

export async function updateElection(
  id: string,
  input: ElectionInput,
  req: Request,
): Promise<Election> {
  let wasDraw = false;
  const result = await withTransaction(async (db) => {
    const election = await getById(id, db);

    if (isDrawElection(election)) {
      // Only the schedule is editable; candidates stay as generated.
      wasDraw = true;
      return scheduleDrawInTx(db, id, input.startAt, input.endAt, req);
    }

    const currentStatus = calculateElectionStatus(election);
    if (currentStatus === "ONGOING" || currentStatus === "CONCLUDED") {
      throw new IllegalStateError(
        "This election cannot be edited because voting has already started or ended.",
      );
    }

    const old = { ...election };
    const oldPartylists = await repo.partylistLinks(db, id);
    const oldDepartments = await repo.departmentLinks(db, id);
    const oldPartylistIds = oldPartylists.map((p) => p.id);
    const oldDepartmentIds = oldDepartments.map((d) => d.id);

    validateBasics(input);
    const category = input.category!;
    const campusId = input.campusId!;

    await assertSchoolYearAvailable(
      db,
      category,
      campusId,
      input.schoolYear,
      input.departmentIds,
      id,
      input.semester ?? null,
    );

    election.title = input.title!.trim();
    election.category = category;
    election.campusId = campusId;
    election.schoolYear = input.schoolYear!.trim();
    election.startAt = input.startAt;
    election.endAt = input.endAt;
    election.semester = input.semester ?? null;

    await repo.deletePartylistLinks(db, id);
    await repo.deleteDepartmentLinks(db, id);

    if (category === "SSC")
      await linkPartylists(db, election, input.partylistIds, campusId, true);
    if (category === "DEPARTMENT")
      await linkDepartments(db, election, input.departmentIds, campusId, true);

    const saved = await repo.saveElection(db, election);

    const changes: string[] = [];
    if (old.title !== saved.title)
      changes.push(`title from "${old.title}" to "${saved.title}"`);
    if (old.category !== saved.category)
      changes.push(`category from "${old.category}" to "${saved.category}"`);
    if (old.campusId !== saved.campusId) changes.push("campus");
    if (old.schoolYear !== saved.schoolYear)
      changes.push(
        `school year from "${old.schoolYear}" to "${saved.schoolYear}"`,
      );
    if (old.startAt?.getTime() !== saved.startAt?.getTime())
      changes.push("start date");
    if (old.endAt?.getTime() !== saved.endAt?.getTime())
      changes.push("end date");

    const sorted = (a: string[]) => [...a].sort().join(",");
    const newPartylists = await repo.partylistLinks(db, id);
    const newDepartments = await repo.departmentLinks(db, id);
    const newPartylistIds = newPartylists.map((p) => p.id);
    const newDepartmentIds = newDepartments.map((d) => d.id);
    if (sorted(oldPartylistIds) !== sorted(newPartylistIds))
      changes.push("partylists");
    if (sorted(oldDepartmentIds) !== sorted(newDepartmentIds))
      changes.push("departments");

    if (changes.length) {
      const description =
        changes.length === 1
          ? `changed ${changes[0]} in election "${saved.title}"`
          : `changed election "${saved.title}": ${changes.join(", ")}`;
      const iso = (d: Date | null) => (d ? d.toISOString() : null);
      const diff = {
        ...diffFields(
          {
            Title: old.title,
            Category: old.category,
            "School year": old.schoolYear,
            Start: iso(old.startAt),
            End: iso(old.endAt),
          },
          {
            Title: saved.title,
            Category: saved.category,
            "School year": saved.schoolYear,
            Start: iso(saved.startAt),
            End: iso(saved.endAt),
          },
        ),
        ...(old.campusId !== saved.campusId
          ? {
              Campus: {
                from: await findCampusName(old.campusId),
                to: await findCampusName(saved.campusId),
              },
            }
          : {}),
        ...listDiff(
          "Partylists",
          oldPartylists.map((p) => p.name),
          newPartylists.map((p) => p.name),
        ),
        ...listDiff(
          "Departments",
          oldDepartments.map((d) => d.title ?? ""),
          newDepartments.map((d) => d.title ?? ""),
        ),
      };
      await auditLog(db, req, "UPDATE", "Elections", saved.id, description, {
        title: saved.title,
        changes,
        diff,
      });
    }

    return saved;
  });

  realtime.electionsChanged(result.campusId);
  if (wasDraw) emitVoteCast();
  return result;
}

// ============================================================
// draw elections: only the schedule can be set
// ============================================================

async function scheduleDrawInTx(
  db: Db,
  id: string,
  startAt: Date | null,
  endAt: Date | null,
  req: Request,
): Promise<Election> {
  const election = await getById(id, db);

  if (!isDrawElection(election))
    throw new IllegalArgumentError(
      "Only draw elections can be scheduled here.",
    );

  const current = calculateElectionStatus(election);
  if (current === "ONGOING" || current === "CONCLUDED") {
    throw new IllegalStateError(
      "This draw election has already started or ended.",
    );
  }

  if (!startAt || !endAt)
    throw new IllegalArgumentError("Election schedule is required.");
  if (!(endAt.getTime() > startAt.getTime()))
    throw new IllegalArgumentError("End date must be after start date.");

  const parent = await repo.findById(db, election.parentElectionId!);
  if (parent && parent.endAt && startAt.getTime() < parent.endAt.getTime()) {
    throw new IllegalArgumentError(
      "A draw election must start after the original election has ended.",
    );
  }

  election.startAt = startAt;
  election.endAt = endAt;
  const saved = await repo.saveElection(db, election);

  await auditLog(
    db,
    req,
    "UPDATE",
    "Elections",
    saved.id,
    `scheduled draw election "${saved.title}"`,
    {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    },
  );
  return saved;
}

export async function scheduleDrawElection(
  id: string,
  startAt: Date | null,
  endAt: Date | null,
  req: Request,
) {
  const saved = await withTransaction((db) =>
    scheduleDrawInTx(db, id, startAt, endAt, req),
  );
  realtime.electionsChanged(saved.campusId);
  emitVoteCast();
  return saved;
}

// ============================================================
// archive / delete (soft): keep a copy in archive_records / trash_records
// ============================================================

async function electionToJson(db: Db, e: Election): Promise<string> {
  return JSON.stringify({
    id: e.id,
    title: e.title,
    category: e.category,
    campusId: e.campusId,
    schoolYear: e.schoolYear,
    semester: e.semester,
    startAt: e.startAt,
    endAt: e.endAt,
    status: e.status,
    active: e.active,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    parentElectionId: e.parentElectionId,
    drawPositions: e.drawPositions,
    partylistIds: (await repo.partylistLinks(db, e.id)).map((p) => p.id),
    departmentIds: (await repo.departmentLinks(db, e.id)).map((d) => d.id),
  });
}

async function retire(
  id: string,
  req: Request,
  kind: "ARCHIVE" | "DELETE",
): Promise<Election> {
  const userId = req.session.user?.userId ?? null;

  const election = await withTransaction(async (db) => {
    const e = await getById(id, db);
    const candidateStudentIds = (await repo.candidatesOfElection(db, e.id)).map(
      (c) => c.studentId,
    );
    const data = await electionToJson(db, e);

    if (kind === "ARCHIVE") {
      await repo.insertArchiveRecord(db, {
        entityId: e.id,
        entityName: e.title,
        data,
        archivedBy: userId,
      });
      e.status = "ARCHIVED";
    } else {
      await repo.insertTrashRecord(db, {
        entityId: e.id,
        entityName: e.title,
        data,
        deletedBy: userId,
      });
      e.status = "DELETED";
    }
    e.active = false;
    await repo.saveElection(db, e);

    // voters' voting status no longer counts this election's ballots
    await repo.refreshVoters(db, await repo.voterIdsOfElection(db, e.id));

    await demoteAllIfNoLongerCandidate(db, candidateStudentIds);

    await auditLog(
      db,
      req,
      kind,
      "Elections",
      e.id,
      `${kind === "ARCHIVE" ? "archived" : "deleted"} election: ${e.title}`,
      { title: e.title, entityType: "Elections" },
    );
    return e;
  });

  realtime.electionsChanged(election.campusId);
  emitVoteCast();
  realtime.historyChanged(kind === "ARCHIVE" ? "archives" : "trash");
  return election;
}

export const archiveElection = (id: string, req: Request) =>
  retire(id, req, "ARCHIVE");
export const deleteElection = (id: string, req: Request) =>
  retire(id, req, "DELETE");

// ============================================================
// re-copy candidate images from partylist / department members
// ============================================================

export async function resyncCandidateImages(electionId: string): Promise<void> {
  await withTransaction(async (db) => {
    await getById(electionId, db);
    for (const c of await repo.candidatesOfElection(db, electionId)) {
      const member = c.departmentId
        ? await repo.findDepartmentMember(db, c.departmentId, c.studentId)
        : c.partylistId
          ? await repo.findPartylistMember(db, c.partylistId, c.studentId)
          : null;
      if (member) await repo.updateCandidateImages(db, c.id, member);
    }
  });
}
