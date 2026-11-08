import { Db } from './electionRepository';

// ---------------- candidates (read) ----------------

export interface CandidateRow {
  id: string;
  electionId: string;
  partylistId: string | null;
  departmentId: string | null;
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  position: string | null;
  campaignImageUrl: string | null;
  backgroundImageUrl: string | null;
  photoImageUrl: string | null;
}

const CAND_COLS = `id, election_id, partylist_id, department_id, student_id, last_name, first_name, middle_name,
  position, campaign_image_url, background_image_url, photo_image_url`;

const mapCandidate = (r: any): CandidateRow => ({
  id: r.id, electionId: r.election_id, partylistId: r.partylist_id, departmentId: r.department_id,
  studentId: r.student_id, lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name,
  position: r.position, campaignImageUrl: r.campaign_image_url, backgroundImageUrl: r.background_image_url,
  photoImageUrl: r.photo_image_url,
});

export async function candidatesFull(db: Db, electionId: string): Promise<CandidateRow[]> {
  const { rows } = await db.query(`SELECT ${CAND_COLS} FROM candidates WHERE election_id = $1`, [electionId]);
  return rows.map(mapCandidate);
}

export async function candidatesByIds(db: Db, ids: string[]): Promise<CandidateRow[]> {
  if (!ids.length) return [];
  const { rows } = await db.query(`SELECT ${CAND_COLS} FROM candidates WHERE id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapCandidate);
}

// ---------------- ballot votes (BallotVoteRepository) ----------------

export async function votesByCandidate(db: Db, electionId: string): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT bv.candidate_id, COUNT(*)::int AS votes
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id
      WHERE c.election_id = $1 GROUP BY bv.candidate_id`,
    [electionId],
  );
  return new Map(rows.map((r) => [r.candidate_id as string, Number(r.votes)]));
}

export async function votesByCandidateAndPosition(
  db: Db, electionId: string, departmentId: string,
): Promise<{ candidateId: string; position: string | null; votes: number }[]> {
  const { rows } = await db.query(
    `SELECT bv.candidate_id, bv.position, COUNT(*)::int AS votes
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id
      WHERE c.election_id = $1 AND c.department_id = $2
      GROUP BY bv.candidate_id, bv.position`,
    [electionId, departmentId],
  );
  return rows.map((r) => ({ candidateId: r.candidate_id, position: r.position, votes: Number(r.votes) }));
}

// ---------------- partylists ----------------

export async function findPartylistName(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT name FROM partylists WHERE id = $1`, [id]);
  return rows[0]?.name ?? null;
}

// ---------------- voters (eligibility) ----------------

export interface VoterRef {
  id: string;
  email: string | null;
}

export async function votersByCampus(db: Db, campusId: string): Promise<VoterRef[]> {
  const { rows } = await db.query(
    `SELECT id, email FROM voters WHERE campus_id = $1 AND CAST(status AS text) = 'ACTIVE'`, [campusId]);
  return rows;
}

export async function votersByCampusAndPrograms(db: Db, campusId: string, codesLower: string[]): Promise<VoterRef[]> {
  const { rows } = await db.query(
    `SELECT id, email FROM voters
      WHERE campus_id = $1 AND LOWER(program_course) = ANY($2::text[]) AND CAST(status AS text) = 'ACTIVE'`,
    [campusId, codesLower],
  );
  return rows;
}

// ---------------- email campaigns / recipients ----------------

export interface Campaign {
  id: string;
  electionId: string;
  subject: string;
  body: string;
  sendType: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
}

const CAMP_COLS = 'id, election_id, subject, body, send_type, scheduled_at, sent_at, status, created_by, created_at';
const mapCampaign = (r: any): Campaign => ({
  id: r.id, electionId: r.election_id, subject: r.subject, body: r.body, sendType: r.send_type,
  scheduledAt: r.scheduled_at, sentAt: r.sent_at, status: r.status, createdBy: r.created_by, createdAt: r.created_at,
});

export async function insertCampaign(
  db: Db,
  c: { electionId: string; subject: string; body: string; sendType: string; scheduledAt?: Date | null; status: string; createdBy: string | null },
): Promise<Campaign> {
  const { rows } = await db.query(
    `INSERT INTO election_email_campaigns (election_id, subject, body, send_type, scheduled_at, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CAMP_COLS}`,
    [c.electionId, c.subject, c.body, c.sendType, c.scheduledAt ?? null, c.status, c.createdBy],
  );
  return mapCampaign(rows[0]);
}

export async function setCampaignStatus(db: Db, id: string, status: string, sentAt: Date | null = null): Promise<Campaign> {
  const { rows } = await db.query(
    `UPDATE election_email_campaigns SET status = $2, sent_at = COALESCE($3, sent_at), updated_at = now()
      WHERE id = $1 RETURNING ${CAMP_COLS}`,
    [id, status, sentAt],
  );
  return mapCampaign(rows[0]);
}

export async function findScheduledCampaign(db: Db, electionId: string): Promise<Campaign | null> {
  const { rows } = await db.query(
    `SELECT ${CAMP_COLS} FROM election_email_campaigns
      WHERE election_id = $1 AND status = 'SCHEDULED' ORDER BY created_at DESC LIMIT 1`,
    [electionId],
  );
  return rows[0] ? mapCampaign(rows[0]) : null;
}

export async function listDueScheduledCampaigns(db: Db, now: Date): Promise<Campaign[]> {
  const { rows } = await db.query(
    `SELECT ${CAMP_COLS} FROM election_email_campaigns WHERE status = 'SCHEDULED' AND scheduled_at <= $1`, [now]);
  return rows.map(mapCampaign);
}

export async function existsCampaign(db: Db, electionId: string, sendType: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM election_email_campaigns WHERE election_id = $1 AND send_type = $2 LIMIT 1`, [electionId, sendType]);
  return rows.length > 0;
}

export async function insertRecipient(db: Db, campaignId: string, voterId: string, email: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO election_email_recipients (campaign_id, voter_id, email, status) VALUES ($1, $2, $3, 'PENDING') RETURNING id`,
    [campaignId, voterId, email],
  );
  return rows[0].id;
}

export const setRecipientResult = (db: Db, id: string, status: 'SENT' | 'FAILED', errorMessage: string | null) =>
  db.query(
    `UPDATE election_email_recipients SET status = $2::text, sent_at = CASE WHEN $2::text = 'SENT' THEN now() ELSE sent_at END, error_message = $3 WHERE id = $1`,
    [id, status, errorMessage],
  );

// ---------------- live results helpers ----------------

export async function candidatesByElectionAndDepartment(db: Db, electionId: string, departmentId: string): Promise<CandidateRow[]> {
  const { rows } = await db.query(
    `SELECT ${CAND_COLS} FROM candidates WHERE election_id = $1 AND department_id = $2`, [electionId, departmentId]);
  return rows.map(mapCandidate);
}

/** ballots that contain at least one vote for a candidate of this election */
export async function countDistinctBallots(db: Db, electionId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT bv.ballot_id)::int AS n
       FROM ballot_votes bv JOIN candidates c ON c.id = bv.candidate_id WHERE c.election_id = $1`, [electionId]);
  return rows[0].n;
}

export async function partylistNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query(`SELECT id, name FROM partylists WHERE id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}
