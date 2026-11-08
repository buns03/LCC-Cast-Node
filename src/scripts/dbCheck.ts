import { pool } from '../db';
import { config } from '../config';
import { T, USER_PROFILE_COLUMNS } from '../schema';
import { verifyMailLogin } from '../mailer';

const expected: Record<string, string[]> = {
  [T.userProfiles]: [...USER_PROFILE_COLUMNS, 'created_at', 'updated_at'],
  [T.voters]: Object.values(T.voterCols),
  [T.emailOtps]: ['id', 'auth_user_id', 'email', 'otp_hash', 'purpose', 'expires_at', 'verified_at', 'attempts', 'created_at'],
  [T.campuses]: Object.values(T.campusCols),
  elections: ['id', 'title', 'category', 'campus_id', 'school_year', 'start_at', 'end_at', 'status', 'is_active', 'created_by', 'created_at', 'updated_at', 'parent_election_id', 'draw_positions', 'draw_checked_at'],
  election_partylists: ['id', 'election_id', 'partylist_id', 'created_at'],
  election_departments: ['id', 'election_id', 'department_id', 'created_at'],
  partylists: ['id', 'name', 'description', 'campus_id', 'school_year', 'poster_image_url', 'poster_logo_url', 'status', 'created_by', 'created_at', 'updated_at'],
  partylist_members: ['id', 'partylist_id', 'student_id', 'last_name', 'first_name', 'middle_name', 'position', 'campaign_image_url', 'background_image_url', 'photo_image_url'],
  departments: ['id', 'name', 'title', 'code', 'campus_id', 'voting_type'],
  department_members: ['id', 'department_id', 'student_id', 'position', 'last_name', 'first_name', 'middle_name', 'campaign_image_url', 'background_image_url', 'photo_image_url'],
  candidates: ['id', 'election_id', 'partylist_id', 'department_id', 'voter_id', 'student_id', 'last_name', 'first_name', 'middle_name', 'position', 'campaign_image_url', 'background_image_url', 'photo_image_url', 'created_at'],
  ballots: ['id', 'election_id', 'voter_id', 'submitted_at'],
  ballot_votes: ['id', 'ballot_id', 'candidate_id', 'position'],
  archive_records: ['id', 'entity_type', 'entity_id', 'entity_name', 'data', 'archived_by', 'archived_at', 'is_restored'],
  trash_records: ['id', 'entity_type', 'entity_id', 'entity_name', 'data', 'deleted_by', 'deleted_at', 'is_restored'],
  election_email_campaigns: ['id', 'election_id', 'scheduled_at', 'status', 'created_at'],
};
expected[T.voters].push('voting_status', 'time_voted', 'updated_at');

async function main() {
  let problems = 0;

  console.log('\n1) Database connection');
  const now = await pool.query('select now() as now');
  console.log('   ✅ connected, server time:', now.rows[0].now);

  console.log('\n2) Tables & columns the login needs');
  for (const [table, cols] of Object.entries(expected)) {
    const { rows } = await pool.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [table],
    );
    if (rows.length === 0) {
      problems++;
      console.log(`   ❌ table "${table}" NOT FOUND in schema public`);
      const all = await pool.query(
        `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
      );
      console.log('      tables that do exist:', all.rows.map((r) => r.table_name).join(', '));
      console.log(`      -> fix the name in src/schema.ts`);
      continue;
    }
    const have = new Set(rows.map((r) => r.column_name));
    const missing = cols.filter((c) => !have.has(c));
    if (missing.length) {
      problems++;
      console.log(`   ❌ "${table}" is missing columns: ${missing.join(', ')}`);
      console.log(`      columns that do exist: ${[...have].join(', ')}`);
      console.log(`      -> fix the names in src/schema.ts`);
    } else {
      const count = await pool.query(`select count(*)::int as n from public.${table}`);
      console.log(`   ✅ "${table}" OK (${count.rows[0].n} rows)`);
    }
  }

  console.log('\n2b) Enum values the code relies on');
  const wanted: Record<string, string[]> = {
    user_role: ['SUPERADMIN', 'ADMIN', 'CANDIDATE', 'STUDENT'],
    record_status: ['ACTIVE', 'ARCHIVED', 'DELETED'],
    voting_status: ['VOTED', 'NOT_VOTED'],
  };
  for (const [type, labels] of Object.entries(wanted)) {
    const { rows } = await pool.query(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1`,
      [type],
    );
    const have = rows.map((r) => r.enumlabel);
    const missing = labels.filter((l) => !have.includes(l));
    if (missing.length) {
      problems++;
      console.log(`   ❌ enum ${type} is missing: ${missing.join(', ')} (it has: ${have.join(', ') || 'nothing'})`);
    } else {
      console.log(`   ✅ enum ${type}: ${have.join(', ')}`);
    }
  }

  const colEnums: [string, string, string[]][] = [['audit_logs', 'action', ['CREATE', 'UPDATE', 'ARCHIVE', 'DELETE', 'RESTORE']]];
  for (const [table, column, labels] of colEnums) {
    const { rows } = await pool.query(
      `select e.enumlabel from information_schema.columns c
         join pg_type t on t.typname = c.udt_name join pg_enum e on e.enumtypid = t.oid
        where c.table_schema = 'public' and c.table_name = $1 and c.column_name = $2`, [table, column]);
    const have = rows.map((r) => r.enumlabel);
    const missing = labels.filter((l) => !have.includes(l));
    if (missing.length) {
      problems++;
      console.log(`   ❌ ${table}.${column} is missing values: ${missing.join(', ')} (it has: ${have.join(', ') || 'nothing / not an enum'})`);
    } else {
      console.log(`   ✅ ${table}.${column}: ${have.join(', ')}`);
    }
  }

  console.log('\n3) Supabase Auth reachable');
  try {
    const r = await fetch(`${config.supabase.url}/auth/v1/settings`, { headers: { apikey: config.supabase.anonKey } });
    if (r.ok) console.log('   ✅ SUPABASE_URL + SUPABASE_ANON_KEY accepted');
    else {
      problems++;
      console.log(`   ❌ Supabase answered HTTP ${r.status} - check SUPABASE_URL / SUPABASE_ANON_KEY`);
    }
  } catch (e) {
    problems++;
    console.log('   ❌ could not reach Supabase:', (e as Error).message);
  }

  console.log('\n3b) Gmail SMTP login (for the OTP email)');
  try {
    await verifyMailLogin();
    console.log('   ✅ MAIL_USERNAME / MAIL_PASSWORD accepted by Gmail');
  } catch (e) {
    problems++;
    console.log('   ❌', (e as Error).message);
  }

  console.log('\n4) One sample ACTIVE account per role (use these to test login)');
  try {
    const { rows } = await pool.query(`
      select distinct on (role, admin_type)
             role::text as role, admin_type, school_id, email, must_change_password
        from public.${T.userProfiles}
       where is_active = true
       order by role, admin_type, school_id`);
    if (rows.length === 0) console.log('   (no active accounts found)');
    for (const r of rows) {
      console.log(
        `   ${String(r.role).padEnd(10)} ${String(r.admin_type ?? '-').padEnd(11)} school_id=${r.school_id}  email=${r.email}  mustChangePassword=${r.must_change_password}`,
      );
    }
  } catch (e) {
    problems++;
    console.log('   ❌', (e as Error).message);
  }

  console.log('\n5) Election emails');
  try {
    console.log(`   Background jobs: ${config.enableSchedulers ? 'ON' : 'OFF (set ENABLE_SCHEDULERS=true in .env for scheduled emails to be sent)'}`);
    const { rows } = await pool.query(
      `select status, count(*)::int as n, min(scheduled_at) filter (where status = 'SCHEDULED') as next_due
         from public.election_email_campaigns group by status order by status`);
    if (!rows.length) console.log('   (no email campaigns yet)');
    for (const r of rows) {
      console.log(`   ${String(r.status).padEnd(10)} ${r.n}${r.next_due ? `   next due: ${new Date(r.next_due).toString()}` : ''}`);
      if (r.status === 'SCHEDULED' && new Date(r.next_due).getTime() < Date.now() && !config.enableSchedulers) {
        problems++;
        console.log('   ❌ a scheduled email is overdue and nothing will send it: background jobs are OFF');
      }
    }
  } catch (e) {
    problems++;
    console.log('   ❌', (e as Error).message);
  }

  console.log(problems ? `\n⚠️  ${problems} problem(s) found - see above.\n` : '\n🎉 Everything looks good.\n');
  await pool.end();
  process.exit(problems ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n❌ Could not run the check:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
