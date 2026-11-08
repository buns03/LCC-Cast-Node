import { pool } from './db';
import { IllegalArgumentError, IllegalStateError } from './errors';
import { TtlCache } from './ttlCache';
import { castBallot } from './ballotCaster';
import { sameSchoolYear } from './schoolTerm';

/*
 * NAMES TO CONFIRM against Election.java (not seen): elections.title, elections.school_year
 * and table ballots (election_id, voter_id) used by hasVoted().
 * VERIFIED: elections.id/campus_id/category/status/start_at/end_at, candidates.*, partylists.*, voters.*
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPCOMING_VISIBILITY_MS = 5 * 24 * 60 * 60 * 1000; // UPCOMING_VISIBILITY_DAYS = 5

type Phase = 'UNSCHEDULED' | 'NOT_VISIBLE' | 'UPCOMING' | 'ONGOING' | 'CONCLUDED';

interface ElectionRow {
  id: string; campusId: string; category: string; status: string; title: string; schoolYear: string;
  startAt: Date | null; endAt: Date | null;
}
interface CandRow {
  id: string; partylistId: string | null; position: string; fullName: string;
  photoImageUrl: string | null; campaignImageUrl: string | null; backgroundImageUrl: string | null;
}
interface ElectionPayload { byId: Map<string, CandRow>; positions: unknown[]; partylists: unknown[] }

const ELECTION_COLS = `id, campus_id, category::text AS category, status::text AS status, title, school_year, start_at, end_at`;
const mapElection = (r: any): ElectionRow => ({
  id: r.id, campusId: r.campus_id, category: r.category, status: r.status, title: r.title, schoolYear: r.school_year,
  startAt: r.start_at ?? null, endAt: r.end_at ?? null,
});

// ---------------------------------------------------------------- caches (all short-lived on purpose)

export interface VoterIdentity { id: string; campusId: string; programCourse: string | null; schoolYear: string | null; votedElectionIds: string[] }
const voterCache = new TtlCache<VoterIdentity | null>(60_000, 20_000);
const electionCache = new TtlCache<ElectionRow | null>(10_000, 500);
const campusElectionsCache = new TtlCache<ElectionRow[]>(10_000, 100);
const payloadCache = new TtlCache<ElectionPayload>(10_000, 200);
export const votedCache = new TtlCache<boolean>(10 * 60_000, 50_000); // only "true" is ever stored: once voted, always voted

// ---------------------------------------------------------------- helpers

export function computePhase(e: ElectionRow, now = Date.now()): Phase {
  if (!e.startAt || !e.endAt) return 'UNSCHEDULED';
  const start = e.startAt.getTime();
  if (now < start - UPCOMING_VISIBILITY_MS) return 'NOT_VISIBLE';
  if (now < start) return 'UPCOMING';
  if (now <= e.endAt.getTime()) return 'ONGOING';
  return 'CONCLUDED';
}

export async function getVoter(authUserId: string): Promise<VoterIdentity> {
  const voter = await voterCache.get(
    authUserId,
    async () => {
      const { rows } = await pool.query(
        `SELECT v.id, v.campus_id, v.program_course, v.school_year,
                ARRAY(SELECT b.election_id::text FROM ballots b
                        JOIN elections e ON e.id = b.election_id
                       WHERE b.voter_id = v.id AND e.campus_id = v.campus_id) AS voted_ids
           FROM voters v WHERE v.auth_user_id = $1::uuid LIMIT 1`,
        [authUserId],
      );
      const r = rows[0];
      if (!r) return null;
      const votedIds = (r.voted_ids ?? []) as string[];
      for (const eid of votedIds) votedCache.set(`${eid}:${r.id}`, true);
      return {
        id: r.id as string,
        campusId: r.campus_id as string,
        programCourse: (r.program_course as string | null) ?? null,
        schoolYear: (r.school_year as string | null) ?? null,
        votedElectionIds: votedIds,
      };
    },
    (v) => v !== null,
  );
  if (!voter) throw new IllegalStateError('Voter record not found.');
  return voter;
}

export async function hasVoted(electionId: string, voterId: string): Promise<boolean> {
  return votedCache.get(
    `${electionId}:${voterId}`,
    async () => {
      const { rows } = await pool.query(`SELECT 1 FROM ballots WHERE election_id = $1::uuid AND voter_id = $2::uuid LIMIT 1`, [electionId, voterId]);
      return rows.length > 0;
    },
    (v) => v === true,
  );
}

const fullNameOf = (r: any) =>
  `${r.first_name}${r.middle_name && String(r.middle_name).trim() ? ' ' + r.middle_name : ''} ${r.last_name}`.trim();

/** Port of findRelevantSscElection: UPCOMING/ONGOING first (ONGOING before UPCOMING, then earliest start), else latest CONCLUDED. */
function findRelevant(elections: ElectionRow[], now = Date.now()): ElectionRow | null {
  const live = elections
    .filter((e) => {
      const p = computePhase(e, now);
      return p === 'UPCOMING' || p === 'ONGOING';
    })
    .sort((a, b) => {
      const ra = computePhase(a, now) === 'ONGOING' ? 0 : 1;
      const rb = computePhase(b, now) === 'ONGOING' ? 0 : 1;
      return ra - rb || (a.startAt as Date).getTime() - (b.startAt as Date).getTime();
    });
  if (live[0]) return live[0];

  const concluded = elections.filter((e) => computePhase(e, now) === 'CONCLUDED');
  concluded.sort((a, b) => (b.endAt as Date).getTime() - (a.endAt as Date).getTime());
  return concluded[0] ?? null;
}

async function buildPayload(electionId: string): Promise<ElectionPayload> {
  const { rows } = await pool.query(
    `SELECT id, partylist_id, position, first_name, middle_name, last_name,
            photo_image_url, campaign_image_url, background_image_url
       FROM candidates WHERE election_id = $1::uuid`,
    [electionId],
  );

  const partylistIds = [...new Set(rows.map((r) => r.partylist_id).filter(Boolean))] as string[];
  const partylistsById = new Map<string, any>();
  if (partylistIds.length) {
    const pl = await pool.query(
      `SELECT id, name, poster_image_url, poster_logo_url FROM partylists WHERE id = ANY($1::uuid[])`,
      [partylistIds],
    );
    for (const p of pl.rows) partylistsById.set(p.id, p);
  }

  const byId = new Map<string, CandRow>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, partylistId: r.partylist_id ?? null, position: r.position ?? '', fullName: fullNameOf(r),
      photoImageUrl: r.photo_image_url ?? null, campaignImageUrl: r.campaign_image_url ?? null, backgroundImageUrl: r.background_image_url ?? null,
    });
  }

  // by position (same order the candidates came back)
  const grouped = new Map<string, CandRow[]>();
  for (const c of byId.values()) {
    if (!grouped.has(c.position)) grouped.set(c.position, []);
    grouped.get(c.position)!.push(c);
  }
  const positions = [...grouped.entries()].map(([name, list]) => ({
    name,
    candidates: list.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      partylistName: c.partylistId ? (partylistsById.get(c.partylistId)?.name ?? null) : null,
      photoImageUrl: c.photoImageUrl,
      campaignImageUrl: c.campaignImageUrl,
      backgroundImageUrl: c.backgroundImageUrl,
    })),
  }));

  // by partylist (for the "View Candidates" modal)
  const byParty = new Map<string, CandRow[]>();
  for (const c of byId.values()) {
    if (!c.partylistId) continue;
    if (!byParty.has(c.partylistId)) byParty.set(c.partylistId, []);
    byParty.get(c.partylistId)!.push(c);
  }
  const partylists = [...byParty.entries()].map(([id, list]) => {
    const p = partylistsById.get(id);
    return {
      id,
      name: p ? p.name : 'Partylist',
      posterImageUrl: p?.poster_image_url ?? null,
      logoImageUrl: p?.poster_logo_url ?? null,
      members: list.map((c) => ({
        position: c.position, name: c.fullName, photoImageUrl: c.photoImageUrl,
        campaignImageUrl: c.campaignImageUrl, backgroundImageUrl: c.backgroundImageUrl,
      })),
    };
  });

  return { byId, positions, partylists };
}

// ---------------------------------------------------------------- GET /voter/api/elections/ssc

export async function getSscElection(authUserId: string) {
  const voter = await getVoter(authUserId);

  const elections = await campusElectionsCache.get(voter.campusId, async () => {
    const { rows } = await pool.query(
      `SELECT ${ELECTION_COLS} FROM elections WHERE campus_id = $1::uuid AND category::text = 'SSC' AND status::text = 'ACTIVE'`,
      [voter.campusId],
    );
    return rows.map(mapElection);
  });

    const election = findRelevant(elections.filter((e) => sameSchoolYear(e.schoolYear, voter.schoolYear)));
  if (!election) return { found: false };

  const payload = await payloadCache.get(election.id, () => buildPayload(election.id));

  return {
    found: true,
    electionId: election.id,
    title: election.title,
    schoolYear: election.schoolYear,
    startAt: election.startAt,
    endAt: election.endAt,
    phase: computePhase(election), // computed per request, never cached
        hasVoted: votedCache.peek(`${election.id}:${voter.id}`) === true || voter.votedElectionIds.includes(election.id),
    positions: payload.positions,
    partylists: payload.partylists,
  };
}

// ---------------------------------------------------------------- POST /voter/api/elections/vote

export async function submitSscVote(authUserId: string, body: any) {
  const electionId = body?.electionId;
  if (!electionId) throw new IllegalArgumentError('Election id is required.');
  if (typeof electionId !== 'string' || !UUID_RE.test(electionId)) throw new IllegalArgumentError('Election not found.');

  const votes = body?.votes;
  if (!Array.isArray(votes) || votes.length === 0) throw new IllegalArgumentError('No votes submitted.');
  if (votes.length > 100) throw new IllegalArgumentError('Too many vote items.');

  const voter = await getVoter(authUserId);
  const votedKey = `${electionId}:${voter.id}`;
  if (votedCache.peek(votedKey) === true) throw new IllegalStateError('You have already voted in this election.');

  const election = await electionCache.get(
    electionId,
    async () => {
      const { rows } = await pool.query(`SELECT ${ELECTION_COLS} FROM elections WHERE id = $1::uuid LIMIT 1`, [electionId]);
      return rows[0] ? mapElection(rows[0]) : null;
    },
    (e) => e !== null,
  );
  if (!election) throw new IllegalArgumentError('Election not found.');
  if (election.category !== 'SSC') throw new IllegalArgumentError('This endpoint only accepts SSC election votes.');
  if (election.status !== 'ACTIVE') throw new IllegalStateError('This election is no longer available.');
  if (election.campusId !== voter.campusId) throw new IllegalStateError('This election does not belong to your campus.');
    if (!sameSchoolYear(voter.schoolYear, election.schoolYear)) throw new IllegalStateError("Your school year does not match this election's school year.");
  if (computePhase(election) !== 'ONGOING') throw new IllegalStateError('Voting is not currently open for this election.');

  const payload = await payloadCache.get(election.id, () => buildPayload(election.id));

  const seenPositions = new Set<string>();
  const candidateIds: string[] = [];
  for (const item of votes) {
    const position = item?.position;
    if (typeof position !== 'string' || !position.trim()) throw new IllegalArgumentError('Vote item missing position.');
    if (!seenPositions.add(position)) throw new IllegalArgumentError('Duplicate position in submission: ' + position);
    if (item.skipped || item.candidateId == null) continue; // skipped position

    const candidate = payload.byId.get(String(item.candidateId));
    if (!candidate) throw new IllegalArgumentError('Candidate does not belong to this election.');
    if (candidate.position !== position) throw new IllegalArgumentError('Candidate does not match the declared position.');
    candidateIds.push(candidate.id);
  }

  const result = await castBallot({
    electionId: election.id,
    voterId: voter.id,
    electionName: election.title,
    electionCategory: election.category,
    candidateIds,
    positions: candidateIds.map(() => null), // SSC ballots store no position, same as Java
  });

  votedCache.set(votedKey, true);
  return { ballotId: result.ballotId, votedAt: result.votedAt, message: 'Your vote has been successfully recorded.' };
}