import { Request } from 'express';
import { pool } from './db';
import { IllegalArgumentError } from './errors';
import * as partylistService from './partylistService';      // <-- CHECK filename
import * as repo from './partylistRepository';
import type { PartylistInput, MemberInput } from './partylistService';
import type { PartylistJson } from './partylistRepository';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function assertOwnedByCampus(p: PartylistJson, campusId: string) {
  if (!same(p.campus?.id, campusId)) throw new HttpError(403, 'You are not authorized to access this partylist.');
}

async function requireCampus(campusId: string) {
  if (!(await repo.campusExists(pool, campusId))) throw new Error('Your campus could not be found.');
}

// ============ READ ============

export const getActivePartylists = (campusId: string) => partylistService.getByCampus(campusId);

export async function getById(id: string, campusId: string): Promise<PartylistJson> {
  const p = await partylistService.getById(id);
  assertOwnedByCampus(p, campusId);
  return p;
}

/** GET /:id returns the partylist WITH its members (the Java entity serializes them). */
export async function getByIdWithMembers(id: string, campusId: string) {
  const p = await getById(id, campusId);
  return (await partylistService.withMembers([p]))[0];
}

export async function getMembers(partylistId: string, campusId: string) {
  const p = await getById(partylistId, campusId); // ownership check
  return partylistService.getMembers(p.id);
}

export async function getMember(partylistId: string, memberId: string, campusId: string) {
  await getById(partylistId, campusId); // ownership check
  return partylistService.getMember(partylistId, memberId);
}

export const getVotersForCampus = (campusId: string) => repo.listActiveVotersByCampus(pool, campusId);

export async function findVoterByStudentId(studentId: string, campusId: string) {
  const voter = await repo.findVoterByStudentId(pool, studentId);
  return voter && same(voter.campusId, campusId) ? voter : null;
}

// ============ WRITE ============

export async function save(input: PartylistInput, campusId: string, req: Request) {
  if (!input) throw new IllegalArgumentError('Partylist data is required');
  await requireCampus(campusId);
  input.campus = { id: campusId }; // ignore any campus the client sent
  const saved = await partylistService.save(input, req);
  return (await partylistService.withMembers([saved]))[0];
}

export async function update(id: string, input: PartylistInput, campusId: string, req: Request) {
  if (!input) throw new IllegalArgumentError('Partylist data is required');
  await getById(id, campusId); // ownership check on the EXISTING record
  await requireCampus(campusId);
  input.campus = { id: campusId };
  const saved = await partylistService.update(id, input, req);
  return (await partylistService.withMembers([saved]))[0];
}

export async function archive(id: string, campusId: string, req: Request) {
  await getById(id, campusId);
  return partylistService.archive(id, req);
}

export async function remove(id: string, campusId: string, req: Request) {
  await getById(id, campusId);
  return partylistService.remove(id, req);
}

export async function restore(id: string, campusId: string, req: Request) {
  await getById(id, campusId);
  return partylistService.restore(id, req);
}

export function validateMembers(
  partylistId: string | null, campusId: string, schoolYear: string | null, members: MemberInput[] | null | undefined,
) {
  return partylistService.validateMembers(pool, partylistId, campusId, schoolYear, members);
}