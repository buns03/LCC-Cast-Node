import { Db } from './electionRepository';

/**
 * Port of CandidateRoleSyncService.demoteAllIfNoLongerCandidate / demoteToVoterIfNoLongerCandidate.
 *
 * A CANDIDATE goes back to STUDENT unless the student still has ANY candidacy:
 *   - a candidate row in an ACTIVE election, or
 *   - a member of an ACTIVE partylist, or
 *   - a member of an ACTIVE department.
 *
 * The three "exists" checks match CandidateRepository.existsByStudentIdAndElectionStatus,
 * PartylistMemberRepository.existsByStudentIdAndPartylistStatus and DepartmentMemberRepository.existsByStudentIdAndDepartmentStatus.
 */
export async function demoteAllIfNoLongerCandidate(db: Db, studentIds: string[]): Promise<void> {
  for (const studentId of studentIds) await demoteToVoterIfNoLongerCandidate(db, studentId);
}

async function demoteToVoterIfNoLongerCandidate(db: Db, studentId: string): Promise<void> {
  if (!studentId || !studentId.trim()) return;

  // voters.student_id -> auth_user_id -> user_profiles
  const voter = await db.query(`SELECT auth_user_id FROM voters WHERE student_id = $1 LIMIT 1`, [studentId]);
  const authUserId = voter.rows[0]?.auth_user_id;
  if (!authUserId) return;

  const profile = await db.query(`SELECT id, role::text AS role FROM user_profiles WHERE auth_user_id = $1 LIMIT 1`, [authUserId]);
  if (!profile.rows[0] || profile.rows[0].role !== 'CANDIDATE') return;

  const still = await db.query(
    `SELECT (
        EXISTS (SELECT 1 FROM candidates c JOIN elections e ON e.id = c.election_id
                 WHERE c.student_id = $1 AND CAST(e.status AS text) = 'ACTIVE')
     OR EXISTS (SELECT 1 FROM partylist_members pm JOIN partylists p ON p.id = pm.partylist_id
                 WHERE pm.student_id = $1 AND CAST(p.status AS text) = 'ACTIVE')
     OR EXISTS (SELECT 1 FROM department_members dm JOIN departments d ON d.id = dm.department_id
                 WHERE dm.student_id = $1 AND CAST(d.status AS text) = 'ACTIVE')
     ) AS still`,
    [studentId],
  );

  if (!still.rows[0].still) {
    await db.query(`UPDATE user_profiles SET role = 'STUDENT', updated_at = now() WHERE id = $1`, [profile.rows[0].id]);
  }
}

// ---------------- partylist (SSC) helpers ----------------

async function resolveProfile(db: Db, studentId: string): Promise<{ id: string; role: string } | null> {
  if (!studentId || !studentId.trim()) return null;
  const voter = await db.query(`SELECT auth_user_id FROM voters WHERE student_id = $1 LIMIT 1`, [studentId]);
  const authUserId = voter.rows[0]?.auth_user_id;
  if (!authUserId) return null;
  const profile = await db.query(`SELECT id, role::text AS role FROM user_profiles WHERE auth_user_id = $1 LIMIT 1`, [authUserId]);
  return profile.rows[0] ?? null;
}

/** STUDENT -> CANDIDATE (promoteToCandidate / promoteAll) */
export async function promoteToCandidate(db: Db, studentId: string): Promise<void> {
  const profile = await resolveProfile(db, studentId);
  if (profile && profile.role === 'STUDENT') {
    await db.query(`UPDATE user_profiles SET role = 'CANDIDATE', updated_at = now() WHERE id = $1`, [profile.id]);
  }
}

export async function promoteAll(db: Db, studentIds: string[]): Promise<void> {
  for (const s of studentIds) await promoteToCandidate(db, s);
}

/** SSC and Department are separate: only an SSC candidacy (active partylist, or candidate of an ACTIVE election via a partylist) keeps the role. */
export async function demoteSscMember(db: Db, studentId: string): Promise<void> {
  const profile = await resolveProfile(db, studentId);
  if (!profile || profile.role !== 'CANDIDATE') return;

  const still = await db.query(
    `SELECT (
        EXISTS (SELECT 1 FROM partylist_members pm JOIN partylists p ON p.id = pm.partylist_id
                 WHERE pm.student_id = $1 AND CAST(p.status AS text) = 'ACTIVE')
     OR EXISTS (SELECT 1 FROM candidates c WHERE c.student_id = $1 AND c.partylist_id IS NOT NULL
                   AND c.election_id IN (SELECT e.id FROM elections e WHERE CAST(e.status AS text) = 'ACTIVE'))
     ) AS still`,
    [studentId],
  );
  if (!still.rows[0].still) {
    await db.query(`UPDATE user_profiles SET role = 'STUDENT', updated_at = now() WHERE id = $1`, [profile.id]);
  }
}

export async function demoteSscMembers(db: Db, studentIds: string[]): Promise<void> {
  for (const s of studentIds) await demoteSscMember(db, s);
}

export async function demoteDepartmentMember(db: Db, studentId: string): Promise<void> {
  const profile = await resolveProfile(db, studentId);
  if (!profile || profile.role !== 'CANDIDATE') return;

  const still = await db.query(
    `SELECT (
        EXISTS (SELECT 1 FROM department_members dm JOIN departments d ON d.id = dm.department_id
                 WHERE dm.student_id = $1 AND CAST(d.status AS text) = 'ACTIVE')
     OR EXISTS (SELECT 1 FROM candidates c WHERE c.student_id = $1 AND c.department_id IS NOT NULL
                   AND c.election_id IN (SELECT e.id FROM elections e WHERE CAST(e.status AS text) = 'ACTIVE'))
     ) AS still`,
    [studentId],
  );
  if (!still.rows[0].still) {
    await db.query(`UPDATE user_profiles SET role = 'STUDENT', updated_at = now() WHERE id = $1`, [profile.id]);
  }
}

export async function demoteDepartmentMembers(db: Db, studentIds: string[]): Promise<void> {
  for (const s of studentIds) await demoteDepartmentMember(db, s);
}
