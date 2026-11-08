import { Db, DepartmentRow } from './electionRepository';

export interface CampusRow { id: string; name: string }

export interface AnalyticsCandidate {
  id: string;
  firstName: string;
  lastName: string;
  position: string | null;
  photo: string | null;
}

const toCountMap = (rows: any[]) => new Map<string, number>(rows.map((r) => [r.id as string, Number(r.votes)]));

// ---------------- campuses ----------------

/** campusRepository.findByStatus(ACTIVE) */
export async function activeCampuses(db: Db): Promise<CampusRow[]> {
  const { rows } = await db.query(`SELECT id, name FROM campuses WHERE CAST(status AS text) = 'ACTIVE'`);
  return rows;
}

/** campusRepository.findById (no status filter, same as Java) */
export async function findCampus(db: Db, id: string): Promise<CampusRow | null> {
  const { rows } = await db.query(`SELECT id, name FROM campuses WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// ---------------- voters ----------------

/** program_course of every ACTIVE voter of a campus (counting is done in code with the normalizer, like Java) */
export async function activeVoterPrograms(db: Db, campusId: string): Promise<(string | null)[]> {
  const { rows } = await db.query(
    `SELECT program_course FROM voters WHERE campus_id = $1 AND CAST(status AS text) = 'ACTIVE'`, [campusId]);
  return rows.map((r) => r.program_course);
}

// ---------------- candidates + votes ----------------

/** candidateRepository.findByElectionId (no ORDER BY, same as Java) */
export async function analyticsCandidates(db: Db, electionId: string): Promise<AnalyticsCandidate[]> {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, position, photo_image_url FROM candidates WHERE election_id = $1`, [electionId]);
  return rows.map((r) => ({
    id: r.id, firstName: r.first_name, lastName: r.last_name, position: r.position, photo: r.photo_image_url,
  }));
}

/** countVotesByCandidateForElection */
export async function votesByCandidate(db: Db, electionId: string): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT bv.candidate_id AS id, COUNT(*)::int AS votes
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id
      WHERE c.election_id = $1 GROUP BY bv.candidate_id`, [electionId]);
  return toCountMap(rows);
}

/** countVotesByPartylistForElection */
export async function votesByPartylist(db: Db, electionId: string): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT c.partylist_id AS id, COUNT(*)::int AS votes
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id
      WHERE c.election_id = $1 AND c.partylist_id IS NOT NULL GROUP BY c.partylist_id`, [electionId]);
  return toCountMap(rows);
}

/** countDistinctBallotsForElection */
export async function countDistinctBallots(db: Db, electionId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT bv.ballot_id)::int AS n
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id
      WHERE c.election_id = $1`, [electionId]);
  return rows[0].n;
}

/**
 * findByElection_IdOrderBySubmittedAtAsc, reduced to the timestamp only.
 * (Your BallotRepository comment forbids anything that links a voter to a ballot, so voter_id is never selected.)
 */
export async function ballotTimes(db: Db, electionId: string): Promise<Date[]> {
  const { rows } = await db.query(
    `SELECT submitted_at FROM ballots WHERE election_id = $1 ORDER BY submitted_at ASC`, [electionId]);
  return rows.map((r) => r.submitted_at);
}

// ---------------- vote_logs ----------------
// Same as VoteLogRepository.countByElectionIdGroupByProgram / ...GroupByYearLevel:
// no vote_status filter, and the year-level query has no ORDER BY (so row order is up to Postgres).

export async function voteLogProgramCounts(db: Db, electionId: string): Promise<{ program: string | null; votes: number }[]> {
  const { rows } = await db.query(
    `SELECT program_course AS program, COUNT(*)::int AS votes FROM vote_logs WHERE election_id = $1 GROUP BY program_course`,
    [electionId]);
  return rows.map((r) => ({ program: r.program, votes: Number(r.votes) }));
}

export async function voteLogYearCounts(db: Db, electionId: string): Promise<{ label: string | null; votes: number }[]> {
  const { rows } = await db.query(
    `SELECT year_level AS label, COUNT(*)::int AS votes FROM vote_logs WHERE election_id = $1 GROUP BY year_level`,
    [electionId]);
  return rows.map((r) => ({ label: r.label, votes: Number(r.votes) }));
}
// ---------------- departments (admin-dept) ----------------

export async function activeDepartmentsOfCampus(db: Db, campusId: string): Promise<(DepartmentRow & { createdAt: Date })[]> {
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.title, d.code, d.campus_id, d.voting_type, d.positions, d.created_at
       FROM departments d WHERE d.campus_id = $1 AND CAST(d.status AS text) = 'ACTIVE'`, [campusId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, title: r.title, code: r.code, campusId: r.campus_id, votingType: r.voting_type,
    positions: Array.isArray(r.positions) ? r.positions : [], createdAt: r.created_at as Date,
  }));
}