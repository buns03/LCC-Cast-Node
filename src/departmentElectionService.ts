import { pool } from './db';
import { IllegalArgumentError, IllegalStateError } from './errors';
import { programCourseMatches } from './programCourse';
import { TtlCache } from './ttlCache';
import { castBallot } from './ballotCaster';
import { getVoter, hasVoted, votedCache } from './sscElectionService';
import { sameSchoolYear } from './schoolTerm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- phase (exact port of ElectionService.calculateVoterPhase)

export type VoterPhase = 'HIDDEN' | 'UPCOMING' | 'ONGOING' | 'CONCLUDED';

export function calculateVoterPhase(startAt: Date | null, endAt: Date | null, now = Date.now()): VoterPhase {
  if (!startAt || !endAt) return 'HIDDEN';
  if (now > endAt.getTime()) return 'CONCLUDED';
  if (now >= startAt.getTime()) return 'ONGOING';
  if (now >= startAt.getTime() - 5 * 86_400_000) return 'UPCOMING';
  return 'HIDDEN';
}

// resolveVisibleElection = pickBest(voter, includeConcluded = false)
const RANK: Record<VoterPhase, number> = { ONGOING: 0, UPCOMING: 1, CONCLUDED: -1, HIDDEN: -1 };

// ---------------------------------------------------------------- types

interface DeptRow {
  id: string; name: string; title: string | null; votingType: string; positions: string[];
  posterImageUrl: string | null; posterLogoUrl: string | null; campusName: string;
}
interface CandRow {
  id: string; firstName: string; middleName: string | null; lastName: string; position: string | null;
  photoImageUrl: string | null; campaignImageUrl: string | null; backgroundImageUrl: string | null; departmentId: string;
}
interface ElectionInfo { id: string; title: string; schoolYear: string; startAt: Date; endAt: Date }

type Context =
  | { kind: 'NO_DEPARTMENT_MATCH' | 'NO_ELECTION' }
  | {
      kind: 'ELECTION';
      election: ElectionInfo;
      primary: DeptRow;
      byId: Map<string, CandRow>;
      positions: string[];
      base: Record<string, unknown>; // the JSON the page needs, built once and shared by every voter of this department
    };

// ---------------------------------------------------------------- caches

const departmentsCache = new TtlCache<DeptRow[]>(30_000, 500);
const contextCache = new TtlCache<Context>(10_000, 500);

const mapDept = (r: any): DeptRow => ({
  id: r.id, name: r.name, title: r.title ?? null, votingType: r.voting_type,
  positions: Array.isArray(r.positions) ? r.positions : [],
  posterImageUrl: r.poster_image_url ?? null, posterLogoUrl: r.poster_logo_url ?? null, campusName: r.campus_name,
});

/** resolveVoterDepartments: ACTIVE departments of the voter's campus whose name matches the voter's program */
async function findVoterDepartments(campusId: string, programCourse: string | null): Promise<DeptRow[]> {
  if (!campusId || !programCourse) return [];
  return departmentsCache.get(`${campusId}|${programCourse}`, async () => {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.title, d.voting_type, d.positions, d.poster_image_url, d.poster_logo_url, c.name AS campus_name
         FROM departments d JOIN campuses c ON c.id = d.campus_id
        WHERE d.campus_id = $1::uuid AND d.status::text = 'ACTIVE'`,
      [campusId],
    );
    return rows.filter((d) => programCourseMatches(programCourse, d.name)).map(mapDept);
  });
}

/** the page needs the voter's department (title + voting type); null = "not available" */
export async function findVoterDepartmentForPage(authUserId: string): Promise<{ title: string; votingType: string } | null> {
  let voter;
  try {
    voter = await getVoter(authUserId);
  } catch (e) {
    if (e instanceof IllegalStateError) return null;
    throw e;
  }
  const dept = (await findVoterDepartments(voter.campusId, voter.programCourse))[0];
  return dept ? { title: dept.title ?? '', votingType: dept.votingType } : null;
}

// ---------------------------------------------------------------- the department election for a campus + program

const fullNameOf = (c: CandRow) =>
  `${c.firstName}${c.middleName && c.middleName.trim() ? ' ' + c.middleName : ''} ${c.lastName}`.trim();

/** DrawDetectionService.openPositions: a draw election only settles its draw positions */
const openPositions = (all: string[], drawPositions: string[] | null) =>
  !drawPositions || !drawPositions.length ? all : all.filter((p) => drawPositions.includes(p));

async function buildContext(campusId: string, programCourse: string | null, schoolYear: string | null): Promise<Context> {
  const depts = await findVoterDepartments(campusId, programCourse);
  if (!depts.length) return { kind: 'NO_DEPARTMENT_MATCH' };

  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.school_year, e.start_at, e.end_at, e.draw_positions, e.parent_election_id, ed.department_id
       FROM election_departments ed JOIN elections e ON e.id = ed.election_id
      WHERE ed.department_id = ANY($1::uuid[]) AND e.status::text = 'ACTIVE'`,
    [depts.map((d) => d.id)],
  );

  let best: any = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const r of rows) {
    if (!sameSchoolYear(r.school_year, schoolYear)) continue;
    const rank = RANK[calculateVoterPhase(r.start_at, r.end_at)];
    if (rank < 0) continue;
    if (!best || rank < bestRank || (rank === bestRank && r.end_at.getTime() > best.end_at.getTime())) {
      best = r;
      bestRank = rank;
    }
  }
  if (!best) return { kind: 'NO_ELECTION' };

  // the voter's departments that are linked to the chosen election (resolveVoterDepartmentsForElection)
  const linked = new Set(rows.filter((r) => r.id === best.id).map((r) => r.department_id as string));
  const electionDepts = depts.filter((d) => linked.has(d.id));
  if (!electionDepts.length) return { kind: 'NO_DEPARTMENT_MATCH' };
  const primary = electionDepts[0];

  const cand = await pool.query(
    `SELECT id, first_name, middle_name, last_name, position, photo_image_url, campaign_image_url, background_image_url, department_id
       FROM candidates WHERE election_id = $1::uuid AND department_id = ANY($2::uuid[])`,
    [best.id, electionDepts.map((d) => d.id)],
  );
  const candRows: CandRow[] = cand.rows.map((r) => ({
    id: r.id, firstName: r.first_name, middleName: r.middle_name ?? null, lastName: r.last_name, position: r.position ?? null,
    photoImageUrl: r.photo_image_url ?? null, campaignImageUrl: r.campaign_image_url ?? null,
    backgroundImageUrl: r.background_image_url ?? null, departmentId: r.department_id,
  }));

  const byId = new Map(candRows.map((c) => [c.id, c]));
  const candidates: unknown[] = [];
  const partylists: unknown[] = [];

  for (const dept of electionDepts) {
    const members: unknown[] = [];
    for (const c of candRows.filter((x) => x.departmentId === dept.id)) {
      candidates.push({
        id: c.id, firstName: c.firstName, middleName: c.middleName, lastName: c.lastName, position: c.position,
        photoImageUrl: c.photoImageUrl, campaignImageUrl: c.campaignImageUrl, backgroundImageUrl: c.backgroundImageUrl,
        departmentId: dept.id, partylistName: dept.title,
      });
      members.push({
        position: c.position, name: fullNameOf(c), photoImageUrl: c.photoImageUrl,
        campaignImageUrl: c.campaignImageUrl, backgroundImageUrl: c.backgroundImageUrl,
      });
    }
    partylists.push({ id: dept.id, name: dept.title, posterImageUrl: dept.posterImageUrl, logoImageUrl: dept.posterLogoUrl, members });
  }

  const positions = openPositions(primary.positions, best.draw_positions ?? null);

  return {
    kind: 'ELECTION',
    election: { id: best.id, title: best.title, schoolYear: best.school_year, startAt: best.start_at, endAt: best.end_at },
    primary,
    byId,
    positions,
    base: {
      electionId: best.id,
      electionName: best.title,
      schoolYear: best.school_year,
      scheduledStartAt: best.start_at,
      scheduledEndAt: best.end_at,
      department: primary.name,
      campus: primary.campusName,
      votingType: primary.votingType,
      positions,
      isDrawElection: best.parent_election_id !== null,
      candidates,
      partylists,
    },
  };
}

const contextFor = (campusId: string, programCourse: string | null, schoolYear: string | null) =>
  contextCache.get(`${campusId}|${programCourse ?? ''}|${schoolYear ?? ''}`, () => buildContext(campusId, programCourse, schoolYear));

// ---------------------------------------------------------------- GET /voter/api/department-elections/current

export async function getCurrentDepartmentElection(authUserId: string): Promise<Record<string, unknown>> {
  let voter;
  try {
    voter = await getVoter(authUserId);
  } catch (e) {
    if (e instanceof IllegalStateError) return { status: 'NOT_A_VOTER' };
    throw e;
  }

  const ctx = await contextFor(voter.campusId, voter.programCourse, voter.schoolYear);
  if (ctx.kind !== 'ELECTION') return { status: ctx.kind };

  return {
    ...ctx.base,
    status: calculateVoterPhase(ctx.election.startAt, ctx.election.endAt), // per request, never cached
    hasVoted: await hasVoted(ctx.election.id, voter.id),
  };
}

// ---------------------------------------------------------------- POST /voter/api/department-elections/vote

/** only reached when the cached context does not match the election the voter tried to vote in (rare) */
async function explainIneligible(electionId: string, kind: Context['kind'], voterSchoolYear: string | null): Promise<never> {
  const { rows } = await pool.query(`SELECT start_at, end_at, school_year FROM elections WHERE id = $1::uuid LIMIT 1`, [electionId]);
  if (!rows[0]) throw new IllegalArgumentError('Election not found.');
  if (!sameSchoolYear(rows[0].school_year, voterSchoolYear)) {
    throw new IllegalStateError("Your school year does not match this election's school year.");
  }
  if (calculateVoterPhase(rows[0].start_at, rows[0].end_at) !== 'ONGOING') {
    throw new IllegalStateError('Voting is not currently open for this election.');
  }
  if (kind === 'NO_DEPARTMENT_MATCH') {
    throw new IllegalStateError('You do not belong to a department eligible for this election.');
  }
  throw new IllegalStateError('You are not eligible to vote in this election.');
}

export async function submitDepartmentVote(authUserId: string, body: any) {
  const electionId = body?.electionId;
  if (typeof electionId !== 'string' || !UUID_RE.test(electionId)) throw new IllegalArgumentError('Election not found.');

  const voter = await getVoter(authUserId);
  const votedKey = `${electionId}:${voter.id}`;
  if (votedCache.peek(votedKey) === true) throw new IllegalStateError('You have already voted in this election.');

  const ctx = await contextFor(voter.campusId, voter.programCourse, voter.schoolYear);
    if (ctx.kind !== 'ELECTION' || ctx.election.id !== electionId) await explainIneligible(electionId, ctx.kind, voter.schoolYear);
  if (ctx.kind !== 'ELECTION') throw new IllegalStateError('You are not eligible to vote in this election.'); // narrows the type

  if (calculateVoterPhase(ctx.election.startAt, ctx.election.endAt) !== 'ONGOING') {
    throw new IllegalStateError('Voting is not currently open for this election.');
  }

  const votes = body?.votes;
  if (!Array.isArray(votes) || votes.length === 0) throw new IllegalArgumentError('No votes submitted.');
  if (votes.length > 100) throw new IllegalArgumentError('Too many vote items.');

  const representative = ctx.primary.votingType === 'REPRESENTATIVE';
  const allowed = new Set(ctx.positions);
  const seenPositions = new Set<string>();
  const seenCandidates = new Set<string>();
  const candidateIds: string[] = [];
  const positions: (string | null)[] = [];

  for (const v of votes) {
    const position = v?.position;
    if (typeof position !== 'string' || !position.trim()) throw new IllegalArgumentError('Vote item missing position.');
    if (!seenPositions.add(position)) throw new IllegalArgumentError('Duplicate position in submission: ' + position);
    if (v.skipped || v.candidateId == null) continue;

    const candidate = ctx.byId.get(String(v.candidateId));
    if (!candidate) throw new IllegalArgumentError('Invalid candidate selection.');
    if (!seenCandidates.add(candidate.id)) throw new IllegalArgumentError('A candidate can only be selected once.');
    if (!allowed.has(position)) throw new IllegalArgumentError('Position is not open for voting: ' + position);
    if (!representative && position !== candidate.position) {
      throw new IllegalArgumentError('Candidate does not match the declared position.');
    }
    candidateIds.push(candidate.id);
    positions.push(representative ? position : null); // same as Java: only REPRESENTATIVE ballots store the position
  }

  const result = await castBallot({
    electionId,
    voterId: voter.id,
    electionName: ctx.election.title,
    electionCategory: 'DEPARTMENT',
    candidateIds,
    positions,
  });

  votedCache.set(votedKey, true);
  return { referenceNumber: result.ballotId, votedAt: result.votedAt.toISOString() };
}