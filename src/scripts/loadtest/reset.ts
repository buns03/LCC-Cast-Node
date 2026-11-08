import { pool } from '../../db';
import { createTestElection, readState, writeState } from './common';

async function main() {
  const state = readState();
  const c = state.campusId;
  const els = `(SELECT id FROM elections WHERE campus_id = $1::uuid)`;

  await pool.query(`DELETE FROM vote_logs WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM ballot_votes WHERE ballot_id IN (SELECT id FROM ballots WHERE election_id IN ${els})`, [c]);
  await pool.query(`DELETE FROM ballots WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM candidates WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM election_partylists WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM elections WHERE campus_id = $1::uuid`, [c]);
  await pool.query(
    `UPDATE voters SET voting_status = 'NOT_VOTED'::voting_status, time_voted = NULL, updated_at = now()
      WHERE campus_id = $1::uuid AND student_id LIKE 'LT%'`, [c]);

  state.electionId = await createTestElection(pool, c, state.partylistIds, 8);
  writeState(state);
  console.log(`Reset done. New election ${state.electionId}. Wait ~15 seconds (server cache), then: npm run lt:run -- --reuse-sessions`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => undefined); process.exit(1); });