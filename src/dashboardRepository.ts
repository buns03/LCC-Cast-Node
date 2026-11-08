import { pool } from './db';
import { programCodeOf } from './programResolver';
import { programCourseMatches } from './programCourse';
import { namesOfProgram } from './programResolver';

/**
 * Port of DashboardRepository.java (same SQL, same rules).
 * campusId === null -> all campuses; program === null -> all programs.
 * Counted election = status ACTIVE (end_at is deliberately NOT checked).
 */
const NO_CAMPUS = '00000000-0000-0000-0000-000000000000';

/** every program_course spelling in the DB (majors, old spellings) that belongs to this program; null = no program filter */
async function voterPrograms(campusId: string | null, program: string | null): Promise<string[] | null> {
  if (program === null) return null;
  const { rows } = await pool.query(
    `SELECT DISTINCT UPPER(program_course) AS pc FROM voters
      WHERE program_course IS NOT NULL AND ($1::boolean = TRUE OR campus_id = $2::uuid)`,
    [campusId === null, campusId ?? NO_CAMPUS],
  );
  return rows.map((r) => r.pc as string).filter((pc) => programCourseMatches(pc, program));
}

const voterFlags = async (campusId: string | null, program: string | null) => {
  const list = await voterPrograms(campusId, program);
  return [campusId === null, campusId ?? NO_CAMPUS, list === null, list ?? []];
};

// department NAMES are acronyms, so match them against every name the program goes by
const deptFlags = (campusId: string | null, program: string | null) => [
  campusId === null,
  campusId ?? NO_CAMPUS,
  program === null,
  program === null ? [] : namesOfProgram(program),
];

async function one(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export const findCampusIdByName = async (name: string): Promise<string | null> => {
  const { rows } = await pool.query(`SELECT c.id FROM campuses c WHERE LOWER(c.name) = LOWER($1::text)`, [name]);
  return rows[0]?.id ?? null;
};

export const countVoters = async (campusId: string | null, program: string | null) =>
  one(
    `SELECT COUNT(*)::int AS n FROM voters v
      WHERE CAST(v.status AS text) = 'ACTIVE'
        AND ($1::boolean = TRUE OR v.campus_id = $2::uuid)
        AND ($3::boolean = TRUE OR UPPER(v.program_course) = ANY($4::text[]))`,
    await voterFlags(campusId, program),
  );

export const countVoted = async (campusId: string | null, program: string | null) =>
  one(
    `SELECT COUNT(DISTINCT b.voter_id)::int AS n
       FROM ballots b
       JOIN elections e ON e.id = b.election_id AND CAST(e.status AS text) = 'ACTIVE'
       JOIN voters v ON v.id = b.voter_id AND CAST(v.status AS text) = 'ACTIVE'
      WHERE ($1::boolean = TRUE OR v.campus_id = $2::uuid)
        AND ($3::boolean = TRUE OR UPPER(v.program_course) = ANY($4::text[]))`,
    await voterFlags(campusId, program),
  );

export const countActiveElections = (campusId: string | null, program: string | null) =>
  one(
    `SELECT COUNT(*)::int AS n FROM elections e
      WHERE CAST(e.status AS text) = 'ACTIVE'
        AND ($1::boolean = TRUE OR e.campus_id = $2::uuid)
        AND ($3::boolean = TRUE
             OR EXISTS (
                  SELECT 1 FROM election_departments ed
                  JOIN departments d ON d.id = ed.department_id
                  WHERE ed.election_id = e.id
                    AND ($1::boolean = TRUE OR d.campus_id = $2::uuid)
                    AND UPPER(d.name) = ANY($4::text[]))
             OR EXISTS (
                  SELECT 1 FROM candidates c
                  JOIN departments d ON d.id = c.department_id
                  WHERE c.election_id = e.id
                    AND ($1::boolean = TRUE OR d.campus_id = $2::uuid)
                    AND UPPER(d.name) = ANY($4::text[])))`,
    deptFlags(campusId, program),
  );

export const countCandidates = (campusId: string | null, program: string | null) =>
  one(
    `SELECT COUNT(*)::int AS n FROM candidates c
       JOIN elections e ON e.id = c.election_id AND CAST(e.status AS text) = 'ACTIVE'
      WHERE ($1::boolean = TRUE OR e.campus_id = $2::uuid)
        AND ($3::boolean = TRUE OR EXISTS (
              SELECT 1 FROM departments d
               WHERE d.id = c.department_id
                 AND ($1::boolean = TRUE OR d.campus_id = $2::uuid)
                 AND UPPER(d.name) = ANY($4::text[])))`,
    deptFlags(campusId, program),
  );

/** [{ campus, votes }] for every active campus (0 when nobody voted). */
export async function votedByCampus(): Promise<{ campus: string; votes: number }[]> {
  const { rows } = await pool.query(
    `SELECT ca.name AS campus, COUNT(DISTINCT b.voter_id)::int AS votes
       FROM campuses ca
       LEFT JOIN voters v ON v.campus_id = ca.id AND CAST(v.status AS text) = 'ACTIVE'
       LEFT JOIN ballots b ON b.voter_id = v.id
            AND b.election_id IN (SELECT e.id FROM elections e WHERE CAST(e.status AS text) = 'ACTIVE')
      WHERE CAST(ca.status AS text) = 'ACTIVE'
      GROUP BY ca.id, ca.name
      ORDER BY ca.name`,
  );
  return rows.map((r) => ({ campus: r.campus, votes: Number(r.votes) }));
}

/** [{ program, votes }]: majors and old spellings are counted under their program */
export async function votedByProgram(campusId: string | null): Promise<{ program: string; votes: number }[]> {
  const { rows } = await pool.query(
    `SELECT v.program_course AS program, COUNT(DISTINCT b.voter_id)::int AS votes
       FROM ballots b
       JOIN elections e ON e.id = b.election_id AND CAST(e.status AS text) = 'ACTIVE'
       JOIN voters v ON v.id = b.voter_id AND CAST(v.status AS text) = 'ACTIVE'
      WHERE v.program_course IS NOT NULL
        AND ($1::boolean = TRUE OR v.campus_id = $2::uuid)
      GROUP BY v.program_course`,
    [campusId === null, campusId ?? NO_CAMPUS],
  );

  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = programCodeOf(r.program) ?? String(r.program);
    totals.set(key, (totals.get(key) ?? 0) + Number(r.votes));
  }
  return [...totals]
    .map(([program, votes]) => ({ program, votes }))
    .sort((a, b) => a.program.localeCompare(b.program));
}

/**
 * Port of DashboardRepository.votesByPosition: votes per position for ONE department's candidates.
 * Counted elections only (status ACTIVE), matched by campus + department NAME (case-insensitive),
 * same as the other admin-dept counts above.
 */
export async function votesByPosition(
  campusId: string,
  program: string,
): Promise<{ position: string; votes: number }[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(bv.position, c.position) AS pos, COUNT(*)::int AS votes
       FROM ballot_votes bv
       JOIN ballots b ON b.id = bv.ballot_id
       JOIN elections e ON e.id = b.election_id AND CAST(e.status AS text) = 'ACTIVE'
       JOIN candidates c ON c.id = bv.candidate_id AND c.election_id = e.id
       JOIN departments d ON d.id = c.department_id
           WHERE d.campus_id = $1::uuid
        AND UPPER(d.name) = ANY($2::text[])
      GROUP BY COALESCE(bv.position, c.position)`,
    [campusId, namesOfProgram(program)],
  );
  return rows.map((r) => ({ position: r.pos, votes: Number(r.votes) }));
}