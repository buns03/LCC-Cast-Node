export interface Term { schoolYear: string | null; semester: number | null }

/** "SY2026-2027-1", "2026-2027 1st Sem", or separate SY / semester columns. A separate semester column wins. */
export function parseTerm(sy: unknown, sem?: unknown): Term {
  let schoolYear: string | null = null;
  let semester: number | null = null;

  const m = String(sy ?? '').match(/(\d{4})\s*[-–/]\s*(\d{4})(?:\s*[-–/ ]\s*(\d))?/);
  if (m && Number(m[2]) === Number(m[1]) + 1) {
    schoolYear = `${m[1]}-${m[2]}`;
    if (m[3] && '123'.includes(m[3])) semester = Number(m[3]);
  }

  const s = String(sem ?? '').trim();
  if (/summer|mid/i.test(s)) semester = 3;
  else { const d = s.match(/[123]/); if (d) semester = Number(d[0]); }

  return { schoolYear, semester };
}

/** PH school year starts around June. */
export function currentSchoolYear(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 5 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function compareTerm(a: Term, b: Term): number {
  const sy = (a.schoolYear ?? '').localeCompare(b.schoolYear ?? '');
  if (sy !== 0) return sy;
  return a.semester != null && b.semester != null ? a.semester - b.semester : 0;
}
export const formatTerm = (t: Term) => `${t.schoolYear ?? '—'}${t.semester ? '-' + t.semester : ''}`;

export function electionMatchesTerm(e: { school_year: string | null }, t: Term): boolean {
  return !!t.schoolYear && e.school_year === t.schoolYear;
}

export const sameSchoolYear = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim() === b.trim();

/** SQL twin of electionMatchesTerm (v = voter-like alias with school_year/semester, e = elections alias) */
export const termMatchSql = (v: string, e: string) => `(${e}.school_year = ${v}.school_year)`;

// ---- campus from section: BSIS1A -> Kaypian, BSIS1-MZN -> Muzon ----
const CAMPUS_BY_CODE: Record<string, string> = { MZN: 'Muzon' }; // add e.g. FRN: '...' when a campus is added
const DEFAULT_CAMPUS = 'Kaypian';

/** null = cannot tell (empty section, or an unknown suffix like -XYZ) */
export function campusNameFromSection(section: string): string | null {
  const s = section.trim();
  if (!s) return null;
  const m = s.match(/-\s*([A-Za-z]{2,5})$/);
  if (!m) return DEFAULT_CAMPUS;
  return CAMPUS_BY_CODE[m[1].toUpperCase()] ?? null;
}

/** Reads school year / semester from an edit form. If the form doesn't send them, the current values are kept. */
export function termFromEdit(
  body: Record<string, unknown>,
  current: Term,
): { term: Term } | { error: string } {
  if (body.schoolYear === undefined) return { term: current };
  const sy = String(body.schoolYear ?? '').trim();
  const sem = String(body.semester ?? '').trim();
  if (!sy) return { error: 'School year is required.' };
  const t = parseTerm(sy, sem);
  if (!t.schoolYear) return { error: 'School year must look like 2026-2027.' };
  if (sem && t.semester === null) return { error: 'Semester must be 1, 2 or 3.' };
  return { term: t };
}