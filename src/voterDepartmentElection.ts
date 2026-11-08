import { Db } from './electionRepository';
import { programCourseMatches } from './programCourse';
import { electionMatchesTerm, Term } from './schoolTerm';

type VoterPhase = 'ONGOING' | 'UPCOMING' | 'CONCLUDED' | 'HIDDEN';

/** Exact port of ElectionService.calculateVoterPhase */
function voterPhase(startAt: Date | null, endAt: Date | null): VoterPhase {
  if (!startAt || !endAt) return 'HIDDEN';
  const now = Date.now();
  if (now > endAt.getTime()) return 'CONCLUDED';
  if (now >= startAt.getTime()) return 'ONGOING';
  if (now >= startAt.getTime() - 5 * 86_400_000) return 'UPCOMING';
  return 'HIDDEN';
}

const RANK: Record<VoterPhase, number> = { ONGOING: 0, UPCOMING: 1, CONCLUDED: 2, HIDDEN: -1 };

/** every ACTIVE election linked to a department that matches this program */
async function linkedElections(db: Db, campusId: string, programCourse: string | null) {
  const depts = (
    await db.query(`SELECT id, name FROM departments WHERE campus_id = $1::uuid AND status::text = 'ACTIVE'`, [campusId])
  ).rows.filter((d) => programCourseMatches(programCourse, d.name));
  if (!depts.length) return [];

  return (
    await db.query(
      `SELECT e.id, e.start_at, e.end_at, e.school_year, e.semester
         FROM election_departments ed JOIN elections e ON e.id = ed.election_id
        WHERE ed.department_id = ANY($1::uuid[]) AND e.status::text = 'ACTIVE'`,
      [depts.map((d) => d.id)],
    )
  ).rows;
}

/** ALL linked election ids (any school year). The voters search SQL does the term matching per voter. */
export async function listDepartmentElectionIds(
  db: Db,
  campusId: string,
  programCourse: string | null,
): Promise<string[]> {
  if (!campusId || !programCourse) return [];
  return (await linkedElections(db, campusId, programCourse)).map((e) => e.id as string);
}

/** Port of VoterDepartmentElectionService.resolveElectionForStatus (concluded elections included).
 *  `term` = the voter's school year / semester; elections of other terms are ignored. */
export async function resolveDepartmentElectionId(
  db: Db,
  campusId: string,
  programCourse: string | null,
  term: Term | null = null,
): Promise<string | null> {
  if (!campusId || !programCourse) return null;

  let best: { id: string; endAt: Date } | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const e of await linkedElections(db, campusId, programCourse)) {
    if (term && !electionMatchesTerm(e, term)) continue;
    const rank = RANK[voterPhase(e.start_at, e.end_at)];
    if (rank < 0) continue;
    if (!best || rank < bestRank || (rank === bestRank && e.end_at.getTime() > best.endAt.getTime())) {
      best = { id: e.id, endAt: e.end_at };
      bestRank = rank;
    }
  }
  return best ? best.id : null;
}