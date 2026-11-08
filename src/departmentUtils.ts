import { DepartmentRow } from './electionRepository';

/** Port of DepartmentUtils.extractProgramCode: department code, else the title before the first "-" (UPPER CASE). */
export function extractProgramCode(d: Pick<DepartmentRow, 'code' | 'title'>): string | null {
  if (d.code && d.code.trim()) return d.code.trim().toUpperCase();
  if (!d.title || !d.title.trim()) return null;
  const code = d.title.split('-', 2)[0].trim();
  return code ? code.toUpperCase() : null;
}
