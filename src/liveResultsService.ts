import { pool } from './db';
import * as repo from './electionRepository';
import { Election, phaseOf } from './electionRepository';
import * as er from './electionEmailRepository';
import { CandidateRow } from './electionEmailRepository';
import { findCampusName } from './repositories';
import { detect, DrawOutcome, drawPositions, hasDraw, openPositions } from './drawDetection';
import { orderPositionKeys, sortByPositionOrder } from './positionOrder';

/** Port of LiveResultsService.java: the JSON the Live Results page (and the websocket) uses. */

export const DRAW_MESSAGE = 'Draw — no official winner yet.';

export interface CandidateResult {
  id: string;
  name: string;
  photo: string | null;
  partylist: string | null;
  votes: number;
}

export interface EntityResult {
  id: string;
  key: string;
  name: string;
  title: string;
  phase: string;
  votingType: string | null;
  votesCast: number;
  startAt: Date | null;
  endAt: Date | null;
  positions: Record<string, CandidateResult[]>;
  campusId: string;
  campusName: string;
  departmentId: string | null;
  departmentIds: string[];
  schoolYear: string;
  drawElection: boolean;
  parentElectionId: string | null;
  drawPositions: string[];
  drawMessage: string | null;
}

type Phase = ReturnType<typeof phaseOf>;
const hasVotes = (phase: Phase) => phase !== 'UPCOMING' && phase !== 'UNSCHEDULED';

const toDto = (c: CandidateRow, votes: number, names: Map<string, string>): CandidateResult => ({
  id: c.id,
  name: `${c.firstName} ${c.lastName}`,
  photo: c.photoImageUrl,
  partylist: c.partylistId ? names.get(c.partylistId) ?? null : null,
  votes,
});

async function resolvePartylistNames(candidates: CandidateRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(candidates.map((c) => c.partylistId).filter((p): p is string => !!p))];
  return er.partylistNames(pool, ids);
}

/** candidates grouped by position, each group sorted by votes (highest first) */
function buildPositionsMap(candidates: CandidateRow[], voteCounts: Map<string, number>, names: Map<string, string>) {
  const grouped = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    if (c.position === null) continue;
    if (!grouped.has(c.position)) grouped.set(c.position, []);
    grouped.get(c.position)!.push(c);
  }

  const result: Record<string, CandidateResult[]> = {};
  for (const [position, group] of grouped) {
    group.sort((a, b) => (voteCounts.get(b.id) ?? 0) - (voteCounts.get(a.id) ?? 0));
    result[position] = group.map((c) => toDto(c, voteCounts.get(c.id) ?? 0, names));
  }
  return result;
}

function applyElectionMeta(dto: EntityResult, election: Election, draw: DrawOutcome) {
  dto.schoolYear = election.schoolYear;
  dto.drawElection = repo.isDrawElection(election);
  dto.parentElectionId = election.parentElectionId;
  if (hasDraw(draw)) {
    dto.drawPositions = sortByPositionOrder(drawPositions(draw), (p) => p);
    dto.drawMessage = DRAW_MESSAGE;
  }
}

// ============================================================
// SSC
// ============================================================

async function buildSscResult(election: Election): Promise<EntityResult | null> {
  const phase = phaseOf(election);
  if (phase === 'NOT_VISIBLE') return null;

  const campusName = await findCampusName(election.campusId);
  if (campusName === null) return null;

  const candidates = await er.candidatesFull(pool, election.id);
  const voteCounts = hasVotes(phase) ? await er.votesByCandidate(pool, election.id) : new Map<string, number>();
  const names = await resolvePartylistNames(candidates);
  const positions = orderPositionKeys(buildPositionsMap(candidates, voteCounts, names));

  const totalVotes = await er.countDistinctBallots(pool, election.id);
  const draw = await detect(pool, election);

  const dto: EntityResult = {
    id: election.id,
    key: campusName,
    name: election.title,
    title: election.title,
    phase,
    votingType: null,
    votesCast: totalVotes,
    startAt: election.startAt,
    endAt: election.endAt,
    positions,
    campusId: election.campusId,
    campusName,
    departmentId: null,
    departmentIds: [],
    schoolYear: '',
    drawElection: false,
    parentElectionId: null,
    drawPositions: [],
    drawMessage: null,
  };
  applyElectionMeta(dto, election, draw);
  return dto;
}

async function buildSscList(elections: Election[]): Promise<EntityResult[]> {
  const results: EntityResult[] = [];
  for (const election of elections) {
    const dto = await buildSscResult(election);
    if (dto) results.push(dto);
  }
  return results;
}

/** All campuses (used by the superadmin page and the websocket broadcast). */
export async function getSscLiveResults(): Promise<EntityResult[]> {
  return buildSscList(await repo.listByCategoryAndStatus(pool, 'SSC', 'ACTIVE'));
}

/** One campus only (admin-ssc). Same logic as above, just limited to that campus's SSC elections. */
export async function getSscLiveResultsForCampus(campusId: string): Promise<EntityResult[]> {
  const elections = (await repo.listByCampusAndStatus(pool, campusId, 'ACTIVE')).filter((e) => e.category === 'SSC');
  return buildSscList(elections);
}

// ============================================================
// DEPARTMENTS
// ============================================================

export async function getDepartmentLiveResults(): Promise<EntityResult[]> {
  const elections = await repo.listByCategoryAndStatus(pool, 'DEPARTMENT', 'ACTIVE');
  const results: EntityResult[] = [];

  for (const election of elections) {
    const depts = await repo.departmentLinks(pool, election.id);
    if (!depts.length) continue;

    const phase = phaseOf(election);
    if (phase === 'NOT_VISIBLE') continue;

    const draw = await detect(pool, election);
    const primary = depts[0];
    let positions: Record<string, CandidateResult[]>;

    if (primary.votingType === 'REPRESENTATIVE') {
      const repCandidates = await er.candidatesByElectionAndDepartment(pool, election.id, primary.id);
      positions = await buildRepresentativePositions(
        election.id, primary.id,
        openPositions(election, primary), // draw elections only show their positions
        phase, repCandidates, await resolvePartylistNames(repCandidates), draw,
      );
    } else {
      const candidates = await er.candidatesFull(pool, election.id);
      const voteCounts = hasVotes(phase) ? await er.votesByCandidate(pool, election.id) : new Map<string, number>();
      positions = buildPositionsMap(candidates, voteCounts, await resolvePartylistNames(candidates));
    }

    positions = orderPositionKeys(positions);

    const totalVotes = await er.countDistinctBallots(pool, election.id);

    const campusName = await findCampusName(election.campusId);
    if (campusName === null) continue;

    const dto: EntityResult = {
      id: election.id,
      key: primary.name ?? '',
      name: primary.name ?? '',
      title: election.title,
      phase,
      votingType: primary.votingType,
      votesCast: totalVotes,
      startAt: election.startAt,
      endAt: election.endAt,
      positions,
      campusId: election.campusId,
      campusName,
      departmentId: primary.id,
      // every attached department, so admin-dept scoping matches whichever one loaded first as "primary"
      departmentIds: depts.map((d) => d.id),
      schoolYear: '',
      drawElection: false,
      parentElectionId: null,
      drawPositions: [],
      drawMessage: null,
    };
    applyElectionMeta(dto, election, draw);
    results.push(dto);
  }
  return results;
}

/** how many candidates each position shows on the Representative live results */
const TOP_PER_POSITION = 3;

/**
 * Representative-type departments have no declared position per candidate: the position is whatever the voter
 * picked on the ballot. Greedy pairing: highest (candidate, position) vote count first, one seat per candidate.
 */
async function buildRepresentativePositions(
  electionId: string, departmentId: string, positions: string[], phase: Phase,
  candidates: CandidateRow[], names: Map<string, string>, draw: DrawOutcome,
): Promise<Record<string, CandidateResult[]>> {
  if (!hasVotes(phase)) {
    // UPCOMING / UNSCHEDULED: just list the candidates
    return { Candidates: candidates.map((c) => toDto(c, 0, names)) };
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rows = await er.votesByCandidateAndPosition(pool, electionId, departmentId);

  const votes = new Map<string, number>();
  for (const r of rows) if (r.position !== null) votes.set(`${r.candidateId}|${r.position}`, r.votes);

  // ---- 1) the leading candidate(s) of each position ----
  const leading = new Map<string, string[]>();

  if (hasDraw(draw)) {
    // CONCLUDED with a draw: draw detection already resolved winners + ties
    for (const position of positions) {
      const tied = draw.tiedByPosition.get(position);
      const winner = draw.winnersByPosition.get(position);
      if (tied) leading.set(position, [...tied]);
      else if (winner) leading.set(position, [winner]);
    }
  } else {
    // greedy pairing: highest (candidate, position) vote count first, one seat per candidate
    const pairings = rows.filter((r) => r.position !== null).sort((a, b) => b.votes - a.votes);
    const assigned = new Set<string>();
    const filled = new Set<string>();

    for (const p of pairings) {
      const position = p.position as string;
      if (assigned.has(p.candidateId)) continue;
      if (filled.has(position)) continue;
      if (!byId.has(p.candidateId)) continue;

      leading.set(position, [p.candidateId]);
      assigned.add(p.candidateId);
      filled.add(position);
    }
  }

  // ---- 2) fill the rest of each position (up to the top 3) with runners-up ----
  // a candidate who is already leading a position is not repeated as a runner-up elsewhere
  const taken = new Set<string>();
  for (const ids of leading.values()) for (const id of ids) taken.add(id);

  const result: Record<string, CandidateResult[]> = {};
  for (const [position, ids] of leading) {
    const list = [...ids];

    if (list.length < TOP_PER_POSITION) {
      const votesFor = (c: CandidateRow) => votes.get(`${c.id}|${position}`) ?? 0;
      const runnersUp = candidates
        .filter((c) => !taken.has(c.id) && votesFor(c) > 0)
        .sort((a, b) => votesFor(b) - votesFor(a))
        .slice(0, TOP_PER_POSITION - list.length)
        .map((c) => c.id);
      list.push(...runnersUp);
    }

    result[position] = list.map((id) => toDto(byId.get(id)!, votes.get(`${id}|${position}`) ?? 0, names));
  }
  return result;
}
