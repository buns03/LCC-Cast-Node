import { programCodeOf } from './programResolver';

/** "BSBA - MKT" -> "BSBA", "AB English" -> "BAEL", "BSED - Math" -> "EDUC". Unknown values stay as typed (UPPER CASE). */
export function toDepartmentCode(programCourse: string | null | undefined): string {
  if (!programCourse) return '';
  const raw = programCourse.trim().toUpperCase();
  if (!raw) return '';
  return programCodeOf(raw) ?? raw;
}

export function programCourseMatches(programCourse: string | null | undefined, departmentName: string | null | undefined): boolean {
  const a = toDepartmentCode(programCourse);
  return a !== '' && a === toDepartmentCode(departmentName);
}