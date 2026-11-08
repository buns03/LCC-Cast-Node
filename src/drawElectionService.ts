import { pool } from './db';
import { withTransaction } from './tx';
import { emitVoteCast } from './realtime';
import * as repo from './electionRepository';
import { Db, Election } from './electionRepository';
import { candidatesByIds } from './electionEmailRepository';
import { detect, DrawOutcome, drawPositions, hasDraw } from './drawDetection';

/** Port of DrawElectionService: a minute after an election ends, tied positions get a "Draw - <title>" tie-break election. */

const DRAW_PREFIX = 'Draw - ';
const GRACE_MS = 60_000;

export async function processConcludedElections(): Promise<void> {
  const due = await repo.listDueForDrawCheck(pool, new Date(Date.now() - GRACE_MS));

  for (const id of due) {
    try {
      const touched = await withTransaction((db) => processElection(db, id));
      // Fires even when there is no draw, so live pages flip to CONCLUDED a minute after the end time.
      if (touched) emitVoteCast();
    } catch (e) {
      console.error(`Draw check failed for election ${id}`, e);
    }
  }
}

async function processElection(db: Db, electionId: string): Promise<boolean> {
  const election = await repo.findById(db, electionId);
  if (!election || election.status !== 'ACTIVE' || election.drawCheckedAt !== null) return false;

  await repo.markDrawChecked(db, electionId);

  const outcome = await detect(db, election);
  if (hasDraw(outcome) && !(await repo.existsChildElection(db, electionId, 'ACTIVE'))) {
    await createDrawElection(db, election, outcome);
  }
  return true;
}

async function createDrawElection(db: Db, parent: Election, outcome: DrawOutcome): Promise<Election> {
  const tiedIds = [...new Set([...outcome.tiedByPosition.values()].flat())];
  const tiedCandidates = await candidatesByIds(db, tiedIds);

  // NOTE: bypasses the school-year guard on purpose (same as Java). Schedule stays empty until an admin sets it.
  const saved = await repo.insertDrawElection(db, {
    title: parent.title.startsWith(DRAW_PREFIX) ? parent.title : DRAW_PREFIX + parent.title,
    category: parent.category,
    campusId: parent.campusId,
    schoolYear: parent.schoolYear,
    createdBy: parent.createdBy,
    parentElectionId: parent.id,
    drawPositions: drawPositions(outcome),
  });

  for (const src of tiedCandidates) {
    await repo.insertCandidate(db, {
      electionId: saved.id,
      partylistId: src.partylistId,
      departmentId: src.departmentId,
      position: src.position,
      member: {
        studentId: src.studentId, lastName: src.lastName, firstName: src.firstName, middleName: src.middleName,
        position: src.position, campaignImageUrl: src.campaignImageUrl, backgroundImageUrl: src.backgroundImageUrl,
        photoImageUrl: src.photoImageUrl,
      },
    });
  }

  if (parent.category === 'SSC') {
    // only the partylists that still have someone in the tie-break
    const partylistIds = [...new Set(tiedCandidates.map((c) => c.partylistId).filter((p): p is string => !!p))];
    for (const pid of partylistIds) {
      if ((await repo.findPartylistCampusId(db, pid)) !== null) await repo.insertPartylistLink(db, saved.id, pid);
    }
  } else {
    // keep ALL parent departments linked: they decide who is eligible to vote
    for (const dept of await repo.departmentLinks(db, parent.id)) await repo.insertDepartmentLink(db, saved.id, dept.id);
  }
  return saved;
}
