import fs from 'fs';
import { pool } from '../../db';
import * as supabaseAuth from '../../supabaseAuth';
import * as plRepo from '../../partylistRepository';
import { CAMPUS_NAME, STATE_FILE, createTestElection, parseArgs, runPool, sleep, studentIdOf, writeState } from './common';

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last;
}

async function main() {
  const a = parseArgs();
  const users = Number(a.users ?? 1000);
  const concurrency = Number(a.concurrency ?? 6);
  const password = String(a.password ?? 'LoadTest!2026');
  const hours = Number(a.hours ?? 8);

  if (!a.confirm) {
    console.log('This creates a test campus, ~' + users + ' voters and Supabase auth users in YOUR database.\nRe-run with --confirm to proceed.');
    process.exit(1);
  }
  if (fs.existsSync(STATE_FILE)) { console.log('A load-test dataset already exists. Run: npm run lt:cleanup'); process.exit(1); }
  if (users < 6) { console.log('--users must be at least 6'); process.exit(1); }

  const campus = await pool.query(
    `INSERT INTO campuses (id, name, description, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id`,
    [CAMPUS_NAME, 'Created by the load-test seed script'],
  );
  const campusId: string = campus.rows[0].id;
  const state = { campusId, users, password, partylistIds: [] as string[], electionId: null as string | null };
  writeState(state); // written early so lt:cleanup works even if this script dies halfway
  console.log('Campus created:', campusId);

  let done = 0;
  const failed: string[] = [];
  const errors = await runPool(Array.from({ length: users }, (_, i) => i + 1), concurrency, async (i) => {
    const sid = studentIdOf(i);
    const first = 'Load' + String(i).padStart(5, '0');
    const email = sid.toLowerCase() + '@voter.local';
    try {
      const auth = await retry(() => supabaseAuth.createUser(email, password));
      if (!auth?.id) throw new Error('no auth id');
      await pool.query(
        `INSERT INTO voters (student_id, last_name, first_name, middle_name, full_name, email, program_course, year_level, section,
                             campus_id, voting_status, time_voted, status, auth_user_id)
         VALUES ($1, 'Tester', $2, NULL, $3, $4, 'LOADTEST', '1', 'A', $5::uuid, 'NOT_VOTED', NULL, 'ACTIVE', $6::uuid)`,
        [sid, first, `${first} Tester`, email, campusId, auth.id],
      );
      await pool.query(
        `INSERT INTO user_profiles (auth_user_id, role, campus_id, school_id, email, first_name, last_name, is_active, must_change_password)
         VALUES ($1::uuid, 'STUDENT', $2::uuid, $3, $4, $5, 'Tester', true, false)`,
        [auth.id, campusId, sid, email, first],
      );
    } catch (e) {
      failed.push(sid);
      throw e;
    } finally {
      if (++done % 100 === 0) console.log(`  voters: ${done}/${users}`);
    }
  });
  console.log(`Voters created: ${users - failed.length}/${users}`);
  if (errors.length) console.log('First error:', (errors[0] as Error).message);
  if (failed.some((s) => Number(s.slice(2)) <= 6)) {
    console.log('One of the first 6 voters failed (they become candidates). Run lt:cleanup and try again.');
    process.exit(1);
  }

  // 2 partylists x 3 positions; the first 6 test voters are the candidates
  const positions = ['President', 'Vice President', 'Secretary'];
  let k = 1;
  for (const name of ['LOADTEST Alpha', 'LOADTEST Beta']) {
    const id = await plRepo.insert(pool, { name, description: null, campusId, schoolYear: 'LOADTEST', posterImageUrl: null, posterLogoUrl: null, status: 'ACTIVE' });
    state.partylistIds.push(id);
    for (const position of positions) {
      await plRepo.insertMember(pool, id, {
        studentId: studentIdOf(k), lastName: 'Tester', firstName: 'Load' + String(k).padStart(5, '0'), middleName: null,
        position, campaignImageUrl: null, backgroundImageUrl: null, photoImageUrl: null,
      });
      k++;
    }
  }

  state.electionId = await createTestElection(pool, campusId, state.partylistIds, hours);
  writeState(state);
  console.log(`\nDone. Election ${state.electionId} is ONGOING for the next ${hours}h.\nNext: npm run lt:run -- --base http://localhost:8080 --users ${users}`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end().catch(() => undefined); process.exit(1); });