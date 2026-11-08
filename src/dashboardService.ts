import * as repo from './dashboardRepository';

/** Port of DashboardService.getDashboard (superadmin view). */
export async function getDashboard(campus: string | undefined) {
  const campusId = await resolveCampusId(campus);

  const [totalVoters, totalVoted, activeElections, totalCandidates, campusVotes, departmentVotes] = await Promise.all([
    repo.countVoters(campusId, null),
    repo.countVoted(campusId, null),
    repo.countActiveElections(campusId, null),
    repo.countCandidates(campusId, null),
    repo.votedByCampus(),
    repo.votedByProgram(campusId),
  ]);

  const turnout = totalVoters > 0 ? Math.round((totalVoted / totalVoters) * 100) : 0;

  return {
    statistics: { totalVoters, totalVoted, activeElections, totalCandidates, turnout },
    campusVotes,
    departmentVotes,
    sscVotes: [
      { program: 'Voted', votes: totalVoted },
      { program: 'Not Voted', votes: Math.max(0, totalVoters - totalVoted) },
    ],
  };
}

/** "all"/blank -> null (all campuses). An unknown campus name also falls back to all, like Java. */
async function resolveCampusId(campus: string | undefined): Promise<string | null> {
  if (!campus || !campus.trim() || campus.toLowerCase() === 'all') return null;
  return repo.findCampusIdByName(campus.trim());
}
