import { pool } from './db';

let byName = new Map<string, string>();      // UPPERCASE acronym or spelling -> acronym
let namesByCode = new Map<string, string[]>(); // acronym -> [acronym, ...spellings]
let namesLongestFirst: string[] = [];
let loaded = false;

const SEPARATOR = /^\s*[-–—:(]/;

export async function refreshProgramResolver(): Promise<void> {
  const { rows } = await pool.query(`SELECT acronym, aliases FROM programs ORDER BY sort_order, acronym`);
  const map = new Map<string, string>();
  const byCode = new Map<string, string[]>();

  for (const r of rows) {
    const acronym = String(r.acronym).toUpperCase();
    map.set(acronym, acronym);
    byCode.set(acronym, [acronym]);
  }
  for (const r of rows) {
    const acronym = String(r.acronym).toUpperCase();
    for (const a of (r.aliases ?? []) as string[]) {
      const key = String(a).trim().toUpperCase();
      if (key && !map.has(key)) {
        map.set(key, acronym);
        byCode.get(acronym)!.push(key);
      }
    }
  }

  byName = map;
  namesByCode = byCode;
  namesLongestFirst = [...map.keys()].sort((a, b) => b.length - a.length);
  loaded = true;
}

export const programsLoaded = () => loaded;

/** "BSBA - MKT" -> "BSBA"; "AB English" -> "BAEL"; "BSIS - Test 1" -> "BSIS"; unknown or blank -> null */
export function programCodeOf(value: string | null | undefined): string | null {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) return null;
  const exact = byName.get(s);
  if (exact) return exact;
  for (const name of namesLongestFirst) {
    if (s.startsWith(name) && SEPARATOR.test(s.slice(name.length))) return byName.get(name) ?? null;
  }
  return null;
}

/** does a voter's program_course belong to this program/department name? */
export function sameProgram(programCourse: string | null | undefined, programOrDepartment: string | null | undefined): boolean {
  const a = programCodeOf(programCourse);
  return !!a && a === programCodeOf(programOrDepartment);
}

/** every UPPERCASE name a program goes by ("BAEL" -> ["BAEL","AB ENGLISH","ABENGLISH"]); unknown values return themselves */
export function namesOfProgram(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return [];
  const code = programCodeOf(raw);
  return code ? (namesByCode.get(code) ?? [code]) : [raw];
}