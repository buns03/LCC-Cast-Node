import { Request } from 'express';
import { pool } from './db';
import { IllegalArgumentError } from './errors';
import { findCampusName } from './repositories';
import * as repo from './electionRepository';
import { Election, isDrawElection } from './electionRepository';
import * as electionService from './electionService';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export interface SscElectionPayload {
  title: string | null;
  schoolYear: string | null;
  startAt: Date | null;
  endAt: Date | null;
  partylistIds: string[] | null;
}

/** Port of assertOwnedByCampus: ACTIVE, same campus, SSC only. */
export async function assertOwned(id: string, campusId: string): Promise<Election> {
  const e = await repo.findByIdAndStatus(pool, id, 'ACTIVE');
  if (!e) throw new NotFoundError('Election not found.');
  if (!e.campusId || e.campusId.toLowerCase() !== campusId.toLowerCase()) {
    throw new ForbiddenError('You are not authorized to access this election.');
  }
  if (e.category !== 'SSC') throw new ForbiddenError('Only SSC elections can be managed here.');
  return e;
}

export async function listForCampus(campusId: string) {
  const all = await electionService.getByCampus(campusId);
  return Promise.all(all.filter((e) => e.category === 'SSC').map((e) => electionService.toResponse(e)));
}

export async function getForCampus(id: string, campusId: string) {
  return electionService.toResponse(await assertOwned(id, campusId));
}

export async function create(p: SscElectionPayload, campusId: string, createdBy: string, req: Request) {
  if (!(await findCampusName(campusId))) throw new IllegalArgumentError('Your campus could not be found.');
  if (!p.partylistIds || p.partylistIds.length < 2) {
    throw new IllegalArgumentError('SSC election requires at least two partylists.');
  }

  const saved = await electionService.createElection(
    {
      title: p.title,
      category: 'SSC', // forced, never taken from the browser
      campusId,        // from the session, never from the browser
      schoolYear: p.schoolYear,
      startAt: p.startAt,
      endAt: p.endAt,
      partylistIds: p.partylistIds,
      departmentIds: null, // no departments, ever
    },
    createdBy,
    req,
  );
  return electionService.toResponse(saved);
}

export async function update(id: string, p: SscElectionPayload, campusId: string, req: Request) {
  const existing = await assertOwned(id, campusId);

  if (!isDrawElection(existing) && (!p.partylistIds || p.partylistIds.length < 2)) {
    throw new IllegalArgumentError('SSC election requires at least two partylists.');
  }

  const saved = await electionService.updateElection(
    id,
    {
      title: p.title,
      category: 'SSC',
      campusId,
      schoolYear: p.schoolYear,
      startAt: p.startAt,
      endAt: p.endAt,
      partylistIds: p.partylistIds,
      departmentIds: null,
    },
    req,
  );
  return electionService.toResponse(saved);
}

export async function archive(id: string, campusId: string, req: Request) {
  await assertOwned(id, campusId);
  await electionService.archiveElection(id, req);
}

export async function remove(id: string, campusId: string, req: Request) {
  await assertOwned(id, campusId);
  await electionService.deleteElection(id, req);
}