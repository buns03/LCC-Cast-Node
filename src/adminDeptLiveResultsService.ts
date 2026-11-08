import { pool } from './db';
import { extractProgramCode } from './departmentUtils';
import { activeDepartmentsOfCampus } from './analyticsRepository';
import { EntityResult, getDepartmentLiveResults } from './liveResultsService';
import { programCourseMatches } from './programCourse';

/** Port of AdminDeptLiveResultsService.java */

const sameText = (a: string, b: string | null | undefined) => !!b && a.toLowerCase() === b.toLowerCase();

/** getDepartmentLiveResultsForAdmin: only elections that include this department AND belong to this campus */
export async function getDepartmentLiveResultsForAdmin(
  campusId: string | null | undefined,
  departmentId: string | null | undefined,
): Promise<EntityResult[]> {
  if (!campusId || !departmentId) return [];
  const all = await getDepartmentLiveResults();
  return all.filter((dto) => dto.departmentIds.includes(departmentId) && dto.campusId === campusId);
}

/** resolveDepartmentId: ACTIVE department of the campus whose NAME or program code equals the session's
 *  programCourse (case-insensitive); the newest created one wins (Java: max by createdAt) */
export async function resolveDepartmentId(
  campusId: string | null | undefined,
  adminDepartmentCode: string | null | undefined,
): Promise<string | null> {
  if (!campusId || !adminDepartmentCode) return null;
  const departments = await activeDepartmentsOfCampus(pool, campusId);
  const newest = departments
       .filter((d) => programCourseMatches(adminDepartmentCode, d.name) || sameText(adminDepartmentCode, extractProgramCode(d)))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
  return newest?.id ?? null;
}