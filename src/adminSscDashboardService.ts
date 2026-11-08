import * as repo from './dashboardRepository';

/** Port of DashboardService.getDashboardForAdminSsc: campus only, no program filter, no campus/department graphs. */
export async function getDashboardForAdminSsc(campusId: string) {
  const [totalVoters, totalVoted, activeElections, totalCandidates] = await Promise.all([
    repo.countVoters(campusId, null),
    repo.countVoted(campusId, null),
    repo.countActiveElections(campusId, null),
    repo.countCandidates(campusId, null),
  ]);

  return {
    statistics: { totalVoters, totalVoted, activeElections, totalCandidates },
    campusVotes: [],
    departmentVotes: [],
    sscVotes: [
      { program: 'Voted', votes: totalVoted },
      { program: 'Not Voted', votes: Math.max(0, totalVoters - totalVoted) },
    ],
  };
}