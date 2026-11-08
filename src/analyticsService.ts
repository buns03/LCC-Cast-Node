import { pool } from './db';
import * as repo from './electionRepository';
import { DepartmentRow, Election, isDrawElection, phaseOf } from './electionRepository';
import { detect, drawPositions as tiedPositions } from './drawDetection';
import { extractProgramCode } from './departmentUtils';
import { programCourseMatches, toDepartmentCode } from './programCourse';
import * as ar from './analyticsRepository';
import { CampusRow } from './analyticsRepository';

/** Port of AnalyticsService.java (superadmin + admin-ssc + admin-dept builders). */

// ============================================================
// JSON shapes (names taken from what analytics.js reads; AnalyticsDTO.java was not shared)
// ============================================================

export interface LabeledSeries { labels: (string | null)[]; values: number[] }
export interface CandidateVotes { name: string; votes: number; position: string | null; photo: string | null }
export interface PartylistVotes { name: string; votes: number }
export interface ProgramVotes { program: string; votes: number; color: string | null }

export interface CampusAnalytics {
  campus: string;
  electionId: string | null;
  electionTitle: string | null;
  schoolYear: string | null;
  phase: string | null;
  parentElectionId: string | null;
  drawElection: boolean;
  drawPositions: string[];
  totalVoters: number;
  votesCast: number;
  candidates: CandidateVotes[];
    partyLists: PartylistVotes[] | null; // null for department
  programVotes: ProgramVotes[] | null; // null for department
  programNotVoted: ProgramVotes[] | null; // null for department
  yearLevel: LabeledSeries;
  activity: LabeledSeries;
  status: LabeledSeries | null;
  votingType: string | null;
}

export interface SSCAnalytics {
  campuses: Record<string, CampusAnalytics>; // campusKey -> latest (non-draw) election
  elections: Record<string, Record<string, CampusAnalytics>>; // electionId -> campusKey -> analytics
}
export interface DepartmentAnalytics { departments: Record<string, Record<string, CampusAnalytics>> } // electionId -> campusKey
export interface FullAnalytics { ssc: SSCAnalytics; departments: DepartmentAnalytics }

export interface AdminDeptAnalyticsResponse {
  departmentId: string | null;
  departmentName: string | null;
  departmentTitle: string | null;
  votingType: string | null;
  hasActiveElection: boolean;
  analytics: CampusAnalytics | null;
  history: CampusAnalytics[] | null;
}

/** one getFullAnalytics() call asks the DB for a campus's voters only once */
type VoterCache = Map<string, Promise<(string | null)[]>>;
const votersOf = (cache: VoterCache, campusId: string) => {
  let p = cache.get(campusId);
  if (!p) { p = ar.activeVoterPrograms(pool, campusId); cache.set(campusId, p); }
  return p;
};

// ============================================================
// small helpers
// ============================================================

const campusKey = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
const sameCode = (a: string, b: string | null | undefined) => !!b && a.toLowerCase() === b.toLowerCase();

function rootStart(e: Election, byId: Map<string, Election>): number {
  let cur = e;
  for (let i = 0; i < 10 && cur.parentElectionId !== null && byId.has(cur.parentElectionId); i++) {
    cur = byId.get(cur.parentElectionId)!;
  }
  return (cur.startAt ?? cur.createdAt).getTime();
}

/** newest root start first; a draw election sits above its parent; then newest created first */
export function orderNewestFirst(elections: Election[]): Election[] {
  const byId = new Map(elections.map((e) => [e.id, e]));
  return [...elections].sort((a, b) => {
    const root = rootStart(b, byId) - rootStart(a, byId);
    if (root !== 0) return root;
    const draw = Number(isDrawElection(b)) - Number(isDrawElection(a));
    if (draw !== 0) return draw;
    const ca = a.createdAt?.getTime();
    const cb = b.createdAt?.getTime();
    if (ca == null && cb == null) return 0;
    if (ca == null) return 1;
    if (cb == null) return -1;
    return cb - ca;
  });
}

/** the slot the existing UI reads = newest NON-draw election */
const primaryIndex = (elections: Election[]) => {
  const i = elections.findIndex((e) => !isDrawElection(e));
  return i === -1 ? 0 : i;
};

// ============================================================
// shared builders
// ============================================================

async function buildCandidateVotes(electionId: string): Promise<CandidateVotes[]> {
  const [candidates, counts] = await Promise.all([ar.analyticsCandidates(pool, electionId), ar.votesByCandidate(pool, electionId)]);
  return candidates.map((c) => ({
    name: `${c.firstName} ${c.lastName}`.trim(),
    votes: counts.get(c.id) ?? 0,
    position: c.position,
    photo: c.photo,
  }));
}

async function buildPartylistVotes(electionId: string): Promise<PartylistVotes[]> {
  const [counts, links] = await Promise.all([ar.votesByPartylist(pool, electionId), repo.partylistLinks(pool, electionId)]);
  return links.map((p) => ({ name: p.name, votes: counts.get(p.id) ?? 0 }));
}

async function votedByCode(electionId: string): Promise<Map<string, number>> {
  const voted = new Map<string, number>();
  for (const r of await ar.voteLogProgramCounts(pool, electionId)) {
    if (r.program === null) continue;
    const code = toDepartmentCode(r.program).toUpperCase();
    if (!code) continue;
    voted.set(code, (voted.get(code) ?? 0) + r.votes);
  }
  return voted;
}

const sortedByProgram = (m: Map<string, number>): ProgramVotes[] =>
    [...m].sort(([a], [b]) => a.localeCompare(b)).map(([program, votes]) => ({ program, votes, color: null }));

async function buildProgramVotes(electionId: string): Promise<ProgramVotes[]> {
  return sortedByProgram(await votedByCode(electionId));
}

/** registered voters per program (this campus only) minus those who already voted */
async function buildProgramNotVoted(campusId: string, electionId: string, cache: VoterCache): Promise<ProgramVotes[]> {
  const [voted, voters] = await Promise.all([votedByCode(electionId), votersOf(cache, campusId)]);

  const total = new Map<string, number>();
  for (const pc of voters) {
    const code = toDepartmentCode(pc).toUpperCase();
    if (!code) continue;
    total.set(code, (total.get(code) ?? 0) + 1);
  }

  const notVoted = new Map<string, number>();
  for (const [code, n] of total) notVoted.set(code, Math.max(n - (voted.get(code) ?? 0), 0));
  return sortedByProgram(notVoted);
}

async function buildYearLevel(electionId: string): Promise<LabeledSeries> {
  const rows = await ar.voteLogYearCounts(pool, electionId);
  return { labels: rows.map((r) => r.label), values: rows.map((r) => r.votes) };
}

/**
 * Cumulative votes per hour-of-day label ("3 PM"), in first-seen order. Same as Java: the label has no date,
 * so the same hour on two different days lands in one bucket.
 * Time zone: Java used the server's default zone. Set ANALYTICS_TIME_ZONE (e.g. Asia/Manila); default is UTC.
 */
async function buildActivity(electionId: string): Promise<LabeledSeries> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: process.env.ANALYTICS_TIME_ZONE || 'UTC',
  });
  const hourly = new Map<string, number>();
  for (const t of await ar.ballotTimes(pool, electionId)) {
    const h = Number(fmt.format(t)) % 24;
    const label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
    hourly.set(label, (hourly.get(label) ?? 0) + 1);
  }
  const labels = [...hourly.keys()];
  let running = 0;
  return { labels, values: labels.map((l) => (running += hourly.get(l)!)) };
}

async function buildCampusAnalytics(
  campus: CampusRow, election: Election, deptFilter: DepartmentRow[] | null, cache: VoterCache,
): Promise<CampusAnalytics> {
  const [voters, votesCast, draw, candidates, yearLevel, activity] = await Promise.all([
    votersOf(cache, campus.id),
    ar.countDistinctBallots(pool, election.id),
    detect(pool, election),
    buildCandidateVotes(election.id),
    buildYearLevel(election.id),
    buildActivity(election.id),
  ]);

  let totalVoters = voters.length;
  if (deptFilter && deptFilter.length) {
    const names = [...new Set(deptFilter.map((d) => d.name))];
    totalVoters = voters.filter((pc) => names.some((n) => programCourseMatches(pc, n))).length;
  }

  return {
    campus: campus.name,
    electionId: election.id,
    electionTitle: election.title,
    schoolYear: election.schoolYear,
    phase: phaseOf(election),
    parentElectionId: election.parentElectionId,
    drawElection: isDrawElection(election),
    drawPositions: tiedPositions(draw),
    totalVoters,
    votesCast,
    candidates,
    partyLists: null,
    programVotes: null,
    programNotVoted: null,
    yearLevel,
    activity,
    status: null,
    votingType: null,
  };
}

// ============================================================
// SSC
// ============================================================

async function buildSSCElectionAnalytics(campus: CampusRow, election: Election, cache: VoterCache): Promise<CampusAnalytics> {
  const ca = await buildCampusAnalytics(campus, election, null, cache);
  [ca.partyLists, ca.programVotes, ca.programNotVoted] = await Promise.all([
    buildPartylistVotes(election.id),
    buildProgramVotes(election.id),
    buildProgramNotVoted(campus.id, election.id, cache),
  ]);
  return ca;
}

function emptySscAnalytics(campus: CampusRow): CampusAnalytics {
  return {
    campus: campus.name, electionId: null, electionTitle: null, schoolYear: null, phase: null, parentElectionId: null,
    drawElection: false, drawPositions: [], totalVoters: 0, votesCast: 0,
    candidates: [], partyLists: [], programVotes: [], programNotVoted: [],
    yearLevel: { labels: [], values: [] }, activity: { labels: [], values: [] }, status: null, votingType: null,
  };
}

const sscElectionsNewestFirst = async (campusId: string) =>
  orderNewestFirst((await repo.listByCategoryAndStatus(pool, 'SSC', 'ACTIVE')).filter((e) => e.campusId === campusId));

async function buildSSCAnalytics(cache: VoterCache): Promise<SSCAnalytics> {
  const ssc: SSCAnalytics = { campuses: {}, elections: {} };
  const all = await repo.listByCategoryAndStatus(pool, 'SSC', 'ACTIVE');

  for (const campus of await ar.activeCampuses(pool)) {
    const key = campusKey(campus.name);
    const elections = orderNewestFirst(all.filter((e) => e.campusId === campus.id));

    if (!elections.length) {
      ssc.campuses[key] = emptySscAnalytics(campus);
      continue;
    }

    const primary = primaryIndex(elections);
    for (let i = 0; i < elections.length; i++) {
      const ca = await buildSSCElectionAnalytics(campus, elections[i], cache);
      if (i === primary) ssc.campuses[key] = ca; // original stays the "latest" slot
      (ssc.elections[elections[i].id] ??= {})[key] = ca;
    }
  }
  return ssc;
}

/** Latest SSC election for the campus (admin-ssc). */
export async function getSscAnalyticsForCampus(campusId: string): Promise<CampusAnalytics> {
  const campus = await ar.findCampus(pool, campusId);
  if (!campus) throw new Error('Campus not found.');
  const elections = await sscElectionsNewestFirst(campusId);
  return elections.length
    ? buildSSCElectionAnalytics(campus, elections[primaryIndex(elections)], new Map())
    : emptySscAnalytics(campus);
}

/** Every SSC election of the campus (all school years), newest first. */
export async function getSscAnalyticsHistoryForCampus(campusId: string): Promise<CampusAnalytics[]> {
  const campus = await ar.findCampus(pool, campusId);
  if (!campus) throw new Error('Campus not found.');
  const cache: VoterCache = new Map();
  const out: CampusAnalytics[] = [];
  for (const election of await sscElectionsNewestFirst(campusId)) out.push(await buildSSCElectionAnalytics(campus, election, cache));
  return out;
}

// ============================================================
// DEPARTMENT
// ============================================================

function withDeptStatus(ca: CampusAnalytics, depts: DepartmentRow[]): CampusAnalytics {
  ca.status = { labels: ['Voted', 'Not Yet Voted'], values: [ca.votesCast, Math.max(ca.totalVoters - ca.votesCast, 0)] };
  ca.votingType = depts[0]?.votingType ?? null;
  return ca;
}

async function buildDepartmentAnalytics(cache: VoterCache): Promise<DepartmentAnalytics> {
  const da: DepartmentAnalytics = { departments: {} };

  for (const election of await repo.listByCategoryAndStatus(pool, 'DEPARTMENT', 'ACTIVE')) {
    const campus = await ar.findCampus(pool, election.campusId);
    if (!campus) continue;

    const depts = await repo.departmentLinks(pool, election.id);
    if (!depts.length) continue;

    const ca = withDeptStatus(await buildCampusAnalytics(campus, election, depts, cache), depts);
    (da.departments[election.id] ??= {})[campusKey(campus.name)] = ca;
  }
  return da;
}

async function buildDeptElectionAnalytics(campus: CampusRow, election: Election, departmentCode: string, cache: VoterCache) {
  const depts = (await repo.departmentLinks(pool, election.id)).filter((d) => sameCode(departmentCode, extractProgramCode(d)));
  return withDeptStatus(await buildCampusAnalytics(campus, election, depts, cache), depts);
}

const emptyAdminDept = (): AdminDeptAnalyticsResponse => ({
  departmentId: null, departmentName: null, departmentTitle: null, votingType: null,
  hasActiveElection: false, analytics: null, history: [],
});

export async function getAdminDeptAnalytics(campusId: string | null, departmentCode: string | null): Promise<AdminDeptAnalyticsResponse> {
  const response = emptyAdminDept();
  if (!campusId || !departmentCode) return response;

  const campus = await ar.findCampus(pool, campusId);
  if (!campus) return response;

  // resolve the Department row by its derived program code (newest created wins), not by raw name
  const department = (await ar.activeDepartmentsOfCampus(pool, campusId))
    .filter((d) => sameCode(departmentCode, extractProgramCode(d)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!department) return response;

  response.departmentId = department.id;
  response.departmentName = department.name;
  response.departmentTitle = department.title;
  response.votingType = department.votingType;

  // every ACTIVE election of this program code (all school years), newest first
  const mine: Election[] = [];
  for (const e of (await repo.listByCategoryAndStatus(pool, 'DEPARTMENT', 'ACTIVE')).filter((x) => x.campusId === campusId)) {
    if ((await repo.departmentLinks(pool, e.id)).some((d) => sameCode(departmentCode, extractProgramCode(d)))) mine.push(e);
  }
  const elections = orderNewestFirst(mine);
  if (!elections.length) return response;

  response.hasActiveElection = true;
  const cache: VoterCache = new Map();
  const history: CampusAnalytics[] = [];
  for (const e of elections) history.push(await buildDeptElectionAnalytics(campus, e, departmentCode, cache));

  response.analytics = history[primaryIndex(elections)];
  response.history = history;
  return response;
}

// ============================================================
// entry points used by the superadmin routes
// ============================================================

export async function getFullAnalytics(): Promise<FullAnalytics> {
  const cache: VoterCache = new Map();
  const ssc = await buildSSCAnalytics(cache);
  const departments = await buildDepartmentAnalytics(cache);
  return { ssc, departments };
}

/** SuperadminAnalyticsApiController.getElectionDepartments */
export async function getElectionDepartmentList() {
  const elections = await repo.listByCategoryAndStatus(pool, 'DEPARTMENT', 'ACTIVE');
  return Promise.all(
    elections.map(async (e) => {
      const first = (await repo.departmentLinks(pool, e.id))[0];
      return {
        id: e.id,
        name: e.title,
        title: e.title,
        votingType: first?.votingType ?? '',
        departmentName: first?.name ?? '', // e.g. "BSIS - Test 1"
      };
    }),
  );
}