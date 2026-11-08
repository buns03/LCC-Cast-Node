import * as repo from './dashboardRepository';

const POSITION_ORDER = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'PRO Internal', 'PRO External'];

// unknown positions go last (Java: Integer.MAX_VALUE); Array.sort is stable, so they keep query order
const rank = (position: string) => {
  const i = POSITION_ORDER.indexOf(position);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** Port of DashboardService.getDashboardForAdminDept. Field names match AdminDeptDashboardResponse exactly. */
export async function getDashboardForAdminDept(campusId: string, program: string) {
  const code = program.trim();

  const [totalVoters, totalVoted, activeElection, totalCandidates, positions] = await Promise.all([
    repo.countVoters(campusId, code),
    repo.countVoted(campusId, code),
    repo.countActiveElections(campusId, code),
    repo.countCandidates(campusId, code),
    repo.votesByPosition(campusId, code), // <-- added in Part C
  ]);

  return {
    statistics: { totalVoters, totalVoted, activeElection, totalCandidates },
    departmentVotes: [...positions].sort((a, b) => rank(a.position) - rank(b.position)),
  };
}