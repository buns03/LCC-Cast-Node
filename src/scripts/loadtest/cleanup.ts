import fs from 'fs';
import { pool } from '../../db';
import * as supabaseAuth from '../../supabaseAuth';
import { CAMPUS_NAME, SESSIONS_FILE, STATE_FILE, readState, runPool } from './common';

async function main() {
  const { campusId: c } = readState();
  const campus = await pool.query(`SELECT name FROM campuses WHERE id = $1::uuid`, [c]);
  if (campus.rows[0] && campus.rows[0].name !== CAMPUS_NAME) {
    console.log('Refusing to delete: that campus is not the load-test campus.');
    process.exit(1);
  }
  const els = `(SELECT id FROM elections WHERE campus_id = $1::uuid)`;

  await pool.query(`DELETE FROM vote_logs WHERE election_id IN ${els} OR campus_id = $1::uuid`, [c]);
  await pool.query(`DELETE FROM ballot_votes WHERE ballot_id IN (SELECT id FROM ballots WHERE election_id IN ${els})`, [c]);
  await pool.query(`DELETE FROM ballots WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM candidates WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM election_partylists WHERE election_id IN ${els}`, [c]);
  await pool.query(`DELETE FROM elections WHERE campus_id = $1::uuid`, [c]);
  await pool.query(`DELETE FROM partylist_members WHERE partylist_id IN (SELECT id FROM partylists WHERE campus_id = $1::uuid)`, [c]);
  await pool.query(`DELETE FROM partylists WHERE campus_id = $1::uuid`, [c]);

  const authIds = (await pool.query(
    `SELECT auth_user_id FROM voters WHERE campus_id = $1::uuid AND student_id LIKE 'LT%' AND auth_user_id IS NOT NULL`, [c])).rows.map((r) => r.auth_user_id as string);
  await pool.query(`DELETE FROM user_profiles WHERE campus_id = $1::uuid AND school_id LIKE 'LT%'`, [c]);
  await pool.query(`DELETE FROM voters WHERE campus_id = $1::uuid AND student_id LIKE 'LT%'`, [c]);

  let n = 0;
  const errors = await runPool(authIds, 6, async (id) => {
    await supabaseAuth.deleteUser(id);
    if (++n % 200 === 0) console.log(`  auth users deleted: ${n}/${authIds.length}`);
  });
  if (errors.length) console.log(`${errors.length} auth users could not be deleted (delete them in Supabase > Authentication, emails ending @voter.local that start with lt).`);

  await pool.query(`DELETE FROM campuses WHERE id = $1::uuid`, [c]);
  for (const f of [STATE_FILE, SESSIONS_FILE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('Cleanup complete.');
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => undefined); process.exit(1); });