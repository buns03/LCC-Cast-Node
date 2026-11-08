import { pool } from './db';
import { IllegalStateError } from './errors';
import { publish, emitVoteCast } from './realtime';

/*
 * NAMES TO CONFIRM against Ballot.java / BallotVote.java / VoteLog.java (I have not seen these entities):
 *   table  ballots      -> election_id, voter_id, submitted_at, created_at
 *   table  ballot_votes -> ballot_id, candidate_id, position, created_at
 *   table  vote_logs    -> election_id, voter_id, ballot_id, student_id, full_name, email, program_course, year_level,
 *                          campus_id, section, vote_status, voted_at, election_name, election_category, campus_name
 * REQUIRED: a UNIQUE index on ballots (election_id, voter_id)  (ON CONFLICT below needs exactly these columns)
 */

export interface CastInput {
  electionId: string;
  voterId: string;
  electionName: string | null;
  electionCategory: string | null;
  candidateIds: string[];
  positions: (string | null)[]; // same length/order as candidateIds (null for SSC)
}

export interface CastResult { ballotId: string; votedAt: Date }

/** one statement = one round trip = atomic (all or nothing). No rows returned = this voter already has a ballot. */
const CAST_SQL = `
WITH ins AS (
  INSERT INTO ballots (id, election_id, voter_id, submitted_at, created_at)
  SELECT gen_random_uuid(), e.id, v.id, now(), now()
    FROM voters v JOIN elections e ON e.id = $1::uuid
   WHERE v.id = $2::uuid AND v.school_year = e.school_year
  ON CONFLICT (election_id, voter_id) DO NOTHING
  RETURNING id, submitted_at
),
votes AS (
  INSERT INTO ballot_votes (id, ballot_id, candidate_id, "position", created_at)
  SELECT gen_random_uuid(), ins.id, x.candidate_id, x."position", now()
    FROM ins CROSS JOIN unnest($3::uuid[], $4::text[]) AS x(candidate_id, "position")
  RETURNING 1
),
vstat AS (
  UPDATE voters SET voting_status = 'VOTED'::voting_status, time_voted = now(), updated_at = now()
   WHERE id = $2::uuid AND EXISTS (SELECT 1 FROM ins)
  RETURNING 1
),
vlog AS (
  INSERT INTO vote_logs (id, election_id, voter_id, ballot_id, student_id, full_name, email, program_course,
                         year_level, campus_id, section, vote_status, voted_at, election_name, election_category, campus_name)
  SELECT gen_random_uuid(), $1::uuid, v.id, ins.id, v.student_id, v.full_name, v.email, v.program_course,
         v.year_level, v.campus_id, v.section, 'VOTED'::voting_status, now(), $5::text, $6::text,
         (SELECT c.name FROM campuses c WHERE c.id = v.campus_id)
    FROM ins JOIN voters v ON v.id = $2::uuid
  RETURNING id
)
SELECT ins.id AS ballot_id, ins.submitted_at, (SELECT id FROM vlog) AS vote_log_id FROM ins`;

/** layer 2 of the double-submit protection: a second request from the same voter while the first is running */
const inFlight = new Set<string>();

// ---- realtime: at most one batch per window, so 1,000 votes in 10 s do not mean 1,000 re-fetches in every open dashboard
const ANNOUNCE_WINDOW_MS = 750;
let announceTimer: NodeJS.Timeout | null = null;
let lastVoteLogId: string | null = null;

function announce(voteLogId: string | null): void {
  lastVoteLogId = voteLogId;
  if (announceTimer) return;
  announceTimer = setTimeout(() => {
    announceTimer = null;
    try {
      publish('/topic/history/vote-logs', { action: 'VOTE_CAST', id: lastVoteLogId, count: null });
      emitVoteCast(); // live results + analytics broadcasters
    } catch (e) {
      console.warn('Post-commit vote notification failed:', (e as Error).message); // never fails the voter
    }
  }, ANNOUNCE_WINDOW_MS);
}

export async function castBallot(input: CastInput): Promise<CastResult> {
  const key = `${input.electionId}:${input.voterId}`;
  if (inFlight.has(key)) throw new IllegalStateError('Your vote is already being submitted.');
  inFlight.add(key);
  try {
    const { rows } = await pool.query(CAST_SQL, [
      input.electionId,
      input.voterId,
      input.candidateIds,
      input.positions,
      input.electionName,
      input.electionCategory,
    ]);
    const row = rows[0];
        if (!row) throw new IllegalStateError('You have already voted in this election, or your school year does not match it.');

    announce(row.vote_log_id ?? null); // runs only after the statement has committed
    return { ballotId: row.ballot_id, votedAt: row.submitted_at };
  } finally {
    inFlight.delete(key);
  }
}