import { Db, Election, DepartmentRow, departmentLinks, phaseOf } from './electionRepository';
import { candidatesFull, votesByCandidate, votesByCandidateAndPosition } from './electionEmailRepository';

/**
 * Port of DrawDetectionService.
 * tiedByPosition: position -> candidates sharing the top vote count.
 * winnersByPosition: only filled for REPRESENTATIVE elections.
 */
export interface DrawOutcome {
  tiedByPosition: Map<string, string[]>;
  winnersByPosition: Map<string, string>;
}

const none = (): DrawOutcome => ({ tiedByPosition: new Map(), winnersByPosition: new Map() });
export const hasDraw = (o: DrawOutcome) => o.tiedByPosition.size > 0;
export const drawPositions = (o: DrawOutcome) => [...o.tiedByPosition.keys()];

export async function detect(db: Db, election: Election): Promise<DrawOutcome> {
  if (phaseOf(election) !== 'CONCLUDED') return none();

  if (election.category === 'DEPARTMENT') {
    const depts = await departmentLinks(db, election.id);
    if (depts.length && depts[0].votingType === 'REPRESENTATIVE') return detectRepresentative(db, election, depts[0]);
  }
  return detectByCandidatePosition(db, election); // SSC + PARTYLIST-type department
}

/** Positions still "open" (a draw election only settles its draw positions). */
export function openPositions(election: Election, dept: DepartmentRow): string[] {
  const all = dept.positions ?? [];
  const drawPos = election.drawPositions;
  if (!drawPos || !drawPos.length) return all;
  return all.filter((p) => drawPos.includes(p));
}

// ---------- SSC / PARTYLIST: candidate.position decides the race ----------
async function detectByCandidatePosition(db: Db, election: Election): Promise<DrawOutcome> {
  const counts = await votesByCandidate(db, election.id);
  const candidates = (await candidatesFull(db, election.id)).filter((c) => c.position !== null);

  const byPosition = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const key = c.position as string;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key)!.push(c);
  }

  const tied = new Map<string, string[]>();
  for (const [position, group] of byPosition) {
    if (group.length < 2) continue; // unopposed
    const top = Math.max(...group.map((c) => counts.get(c.id) ?? 0));
    if (top === 0) continue; // nobody voted for this position
    const leaders = group.filter((c) => (counts.get(c.id) ?? 0) === top).map((c) => c.id);
    if (leaders.length > 1) tied.set(position, leaders);
  }
  return { tiedByPosition: tied, winnersByPosition: new Map() };
}

// ---------- REPRESENTATIVE: position lives on ballot_votes.position ----------
async function detectRepresentative(db: Db, election: Election, dept: DepartmentRow): Promise<DrawOutcome> {
  const open = openPositions(election, dept);

  const pairs = (await votesByCandidateAndPosition(db, election.id, dept.id)).filter(
    (p): p is { candidateId: string; position: string; votes: number } => p.position !== null && open.includes(p.position),
  );

  const setAside = new Set<string>(); // candidates already placed or tied
  const closed = new Set<string>(); // positions already won or tied
  const tied = new Map<string, string[]>();
  const winners = new Map<string, string>();

  // Highest vote first, one seat per candidate; a tie for the top spot of a position is a draw, not a pick.
  for (;;) {
    const available = pairs.filter((p) => !setAside.has(p.candidateId) && !closed.has(p.position));
    if (!available.length) break;

    const top = Math.max(...available.map((p) => p.votes));
    const leaders = new Map<string, typeof pairs>();
    for (const p of available.filter((x) => x.votes === top)) {
      if (!leaders.has(p.position)) leaders.set(p.position, []);
      leaders.get(p.position)!.push(p);
    }

    for (const [position, group] of leaders) {
      // ties first
      if (group.length > 1) {
        tied.set(position, group.map((g) => g.candidateId));
        closed.add(position);
        group.forEach((g) => setAside.add(g.candidateId));
      }
    }
    for (const [position, group] of leaders) {
      // then clear winners
      if (group.length === 1 && !closed.has(position) && !setAside.has(group[0].candidateId)) {
        winners.set(position, group[0].candidateId);
        closed.add(position);
        setAside.add(group[0].candidateId);
      }
    }
  }
  return { tiedByPosition: tied, winnersByPosition: winners };
}
