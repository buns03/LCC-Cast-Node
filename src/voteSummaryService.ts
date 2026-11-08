import { pool } from './db';

/** Port of VoteSummaryService + VoteSummaryDTO + CandidateVoteDTO. VOTER-ONLY: pass the logged-in voter's own id. */

export interface CandidateVote {
  position: string | null;
  candidateName: string;
  affiliationName: string | null;
  image: string | null;
}

export interface VoteSummary {
  id: string;                 // ballot id
  type: 'ssc' | 'department';
  votingType: string | null;  // REPRESENTATIVE / PARTYLIST / null for SSC
  electionTitle: string;
  electionLabel: string;
  campus: string | null;
  department: string | null;  // null for SSC
  votedAt: Date;
  candidates: CandidateVote[];
}

const buildName = (r: any) =>
  `${r.first_name}${r.middle_name && String(r.middle_name).trim() ? ' ' + r.middle_name : ''} ${r.last_name}`;

const buildImageUrl = (storagePath: unknown) =>
  storagePath && String(storagePath).trim() ? '/files/' + storagePath : null;

export async function getVoteSummariesForVoter(voterId: string, campus: string | null): Promise<VoteSummary[]> {
  // only ballots of ACTIVE elections (archived / deleted elections are hidden, same as the Java loop)
  const ballots = (
    await pool.query(
      `SELECT b.id AS ballot_id, b.submitted_at, e.title, e.category::text AS category
         FROM ballots b JOIN elections e ON e.id = b.election_id
        WHERE b.voter_id = $1::uuid AND e.status::text = 'ACTIVE'
        ORDER BY b.submitted_at DESC`,
      [voterId],
    )
  ).rows;
  if (!ballots.length) return [];

  const votes = (
    await pool.query(
      `SELECT bv.ballot_id, bv."position" AS vote_position, c.position AS candidate_position,
              c.first_name, c.middle_name, c.last_name, c.photo_image_url, c.partylist_id, c.department_id,
              p.name AS partylist_name, d.name AS department_name, d.voting_type AS voting_type
         FROM ballot_votes bv
         JOIN candidates c ON c.id = bv.candidate_id
         LEFT JOIN partylists p ON p.id = c.partylist_id
         LEFT JOIN departments d ON d.id = c.department_id
        WHERE bv.ballot_id = ANY($1::uuid[])`,
      [ballots.map((b) => b.ballot_id)],
    )
  ).rows;

  const byBallot = new Map<string, any[]>();
  for (const v of votes) {
    if (!byBallot.has(v.ballot_id)) byBallot.set(v.ballot_id, []);
    byBallot.get(v.ballot_id)!.push(v);
  }

  return ballots.map((b) => {
    const isSsc = b.category === 'SSC';
    let votingType: string | null = null;
    let departmentName: string | null = null;

    const candidates: CandidateVote[] = (byBallot.get(b.ballot_id) ?? []).map((v) => {
      let affiliationName: string | null = null;
      if (v.partylist_id) {
        affiliationName = v.partylist_name ?? 'Independent';
      } else if (v.department_id && v.department_name) {
        departmentName = v.department_name; // same for every candidate of a department ballot
        votingType = v.voting_type ?? null;
        affiliationName = v.department_name;
      }
      return {
        position: v.vote_position ?? v.candidate_position ?? null,
        candidateName: buildName(v),
        affiliationName,
        image: buildImageUrl(v.photo_image_url),
      };
    });

    return {
      id: String(b.ballot_id),
      type: isSsc ? 'ssc' : 'department',
      votingType: isSsc ? null : votingType,
      electionTitle: b.title,
      electionLabel: isSsc ? 'SSC Election' : 'Department Election',
      campus,
      department: isSsc ? null : departmentName,
      votedAt: b.submitted_at,
      candidates,
    };
  });
}