import fs from 'fs';
import { SESSIONS_FILE, parseArgs, pct, readState, runPool, sleep, studentIdOf } from './common';

interface Res { status: number; ms: number; json: any; setCookie: string[]; error?: string }
interface Metric { name: string; ms: number[]; codes: Map<string, number> }
interface User { id: string; cookie: string }

const a = parseArgs();
const base = String(a.base ?? 'http://localhost:8080').replace(/\/+$/, '');
const N = Number(a.users ?? 1000);
const loginConcurrency = Number(a['login-concurrency'] ?? 5);
const rampMs = Number(a['ramp-ms'] ?? 0);        // 0 = every voter votes at the same instant (worst case)
const dupVoters = Number(a['dup-voters'] ?? 100); // voters who double/triple-submit
const dupFactor = Number(a['dup-factor'] ?? 5);   // parallel identical submits for those voters
const skipRate = Number(a['skip-rate'] ?? 0.1);   // chance a voter skips a position
const timeoutMs = Number(a.timeout ?? 30_000);

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method,
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    const setCookie: string[] = (res.headers as any).getSetCookie?.() ?? [];
    return { status: res.status, ms: performance.now() - t0, json, setCookie };
  } catch (e) {
    const err = e as Error;
    return { status: 0, ms: performance.now() - t0, json: null, setCookie: [], error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const metric = (name: string): Metric => ({ name, ms: [], codes: new Map() });
function record(m: Metric, r: Res) {
  m.ms.push(r.ms);
  const key = r.status === 0 ? `ERR:${r.error}` : String(r.status);
  m.codes.set(key, (m.codes.get(key) ?? 0) + 1);
}
function print(m: Metric, wallMs: number) {
  const s = [...m.ms].sort((x, y) => x - y);
  const f = (n: number) => n.toFixed(0).padStart(6) + ' ms';
  console.log(`\n== ${m.name} ==  ${s.length} requests in ${(wallMs / 1000).toFixed(1)}s (${(s.length / (wallMs / 1000)).toFixed(0)} req/s)`);
  console.log(`   p50 ${f(pct(s, 50))}   p90 ${f(pct(s, 90))}   p95 ${f(pct(s, 95))}   p99 ${f(pct(s, 99))}   max ${f(s[s.length - 1] ?? 0)}`);
  console.log('   status: ' + [...m.codes.entries()].map(([k, v]) => `${k} x${v}`).join(', '));
}

// ---------------------------------------------------------------- websocket (same STOMP-over-SockJS path your browsers use)
async function startWs() {
  const stats = { connected: false, messages: 0, firstAt: 0, lastAt: 0, error: '' };
  try {
    const mod: any = await import('ws');
    const WS = mod.default ?? mod;
    const sid = Math.random().toString(36).slice(2, 10);
const ws = new WS(base.replace(/^http/, 'ws') + `/ws-analytics/000/${sid}/websocket`);
    ws.on('message', (data: Buffer) => {
      const s = data.toString();
      if (s === 'o') { ws.send(JSON.stringify(['CONNECT\naccept-version:1.1\nheart-beat:0,0\n\n\0'])); return; }
      if (s[0] !== 'a') return;
      let frames: string[] = [];
      try { frames = JSON.parse(s.slice(1)); } catch { /* ignore */ }
      for (const f of frames) {
        if (f.startsWith('CONNECTED')) {
          stats.connected = true;
          ws.send(JSON.stringify(['SUBSCRIBE\nid:lt-0\ndestination:/topic/history/vote-logs\n\n\0']));
        } else if (f.startsWith('MESSAGE')) {
          const now = Date.now();
          stats.messages++;
          stats.firstAt ||= now;
          stats.lastAt = now;
        }
      }
    });
    ws.on('error', (e: Error) => { stats.error = e.message; });
    return { stats, stop: () => ws.close() };
  } catch (e) {
    stats.error = 'ws package not installed (npm i -D ws @types/ws) or connection failed: ' + (e as Error).message;
    return { stats, stop: () => undefined };
  }
}

function buildBallot(data: any) {
  let picked = 0;
  const votes = data.positions.map((p: any) => {
    if (!p.candidates.length || Math.random() < skipRate) return { position: p.name, candidateId: null, skipped: true };
    picked++;
    const c = p.candidates[Math.floor(Math.random() * p.candidates.length)];
    return { position: p.name, candidateId: c.id, skipped: false };
  });
  return { body: { electionId: data.electionId, votes }, picked };
}

async function main() {
  const state = readState();
  const isLocal = /localhost|127\.0\.0\.1/.test(base);
  if (!isLocal && !a.yes) {
    console.log(`${base} is not localhost: this will hit that server with ${N} simultaneous voters and slow it for real users.\nRe-run with --yes to continue.`);
    process.exit(1);
  }

  const users: User[] = Array.from({ length: N }, (_, i) => ({ id: studentIdOf(i + 1), cookie: '' }));
  console.log(`Target ${base} | ${N} virtual voters | ramp ${rampMs} ms | ${dupVoters} voters x${dupFactor} duplicate submits`);

   // ---- 1. login (real POST /login); with --reuse-sessions keep saved sessions and only log in the missing voters
  if (a['inject-sessions']) {
    const r = await http('POST', '/__loadtest/sessions', { body: { count: N, key: String(a['inject-sessions']) } });
    if (r.status !== 200 || !r.json?.sessions) { console.log('Session injection failed: ' + r.status + ' ' + (r.error ?? '')); process.exit(1); }
    for (const u of users) u.cookie = r.json.sessions[u.id] ?? '';
    console.log(`Injected ${users.filter((x) => x.cookie).length} sessions (real login skipped)`);
  } else if (a['reuse-sessions'] && fs.existsSync(SESSIONS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, string>;
    for (const u of users) u.cookie = saved[u.id] ?? '';
    console.log(`Reusing ${users.filter((u) => u.cookie).length} saved sessions`);
  }
  const need = users.filter((u) => !u.cookie);
  if (need.length) {
    const m = metric('LOGIN  POST /login');
    const fails = new Map<string, number>();
    const t0 = performance.now();
    await runPool(need, loginConcurrency, async (u) => {
      const r = await http('POST', '/login', { body: { schoolId: u.id, password: state.password } });
      record(m, r);
      if (r.status === 200 && r.json?.success) {
        const sid = r.setCookie.find((c) => c.startsWith('lccast.sid='));
        if (sid) u.cookie = sid.split(';')[0];
      } else {
        const k = `${r.status} ${r.json?.code ?? r.error ?? ''}`;
        fails.set(k, (fails.get(k) ?? 0) + 1);
      }
    });
    print(m, performance.now() - t0);
    for (const [k, v] of fails) console.log(`   login failure: ${k} x${v}`);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(users.filter((u) => u.cookie).map((u) => [u.id, u.cookie]))));
  }
  const active = users.filter((u) => u.cookie);
  console.log(`\nLogged-in voters: ${active.length}/${N}`);
  if (!active.length) { console.log('No sessions: nothing to vote with. Check the login errors above.'); process.exit(1); }
  console.log(`\nLogged-in voters: ${active.length}/${N}`);
  if (!active.length) { console.log('No sessions: nothing to vote with. Check the login errors above.'); process.exit(1); }

  // ---- 2. everybody opens the election page at the same moment
  const pageM = metric('PAGE   GET /voter/api/elections/ssc  (all voters at once)');
  let data: any = null;
  let t0 = performance.now();
  await runPool(active, active.length, async (u) => {
    const r = await http('GET', '/voter/api/elections/ssc', { cookie: u.cookie });
    record(pageM, r);
    if (r.status === 200 && r.json?.found && !data) data = r.json;
  });
  print(pageM, performance.now() - t0);
  if (!data || data.phase !== 'ONGOING' || data.hasVoted) {
    console.log('\nThe test election is not open for voting (phase=' + data?.phase + ', hasVoted=' + data?.hasVoted + ').\nAfter lt:reset wait ~15 s for the server cache, then run again.');
    process.exit(1);
  }

  // ---- 3. vote storm
  const ws = a['skip-ws'] ? null : await startWs();
  await sleep(500);

  const voteM = metric('VOTE   POST /voter/api/elections/vote');
  const perUser = new Map<string, { ok: number; picked: number }>();
  const dupSet = new Set(active.slice(0, dupVoters).map((u) => u.id));
  const stormStart = performance.now();
  await runPool(active, active.length, async (u, i) => {
    if (rampMs > 0) await sleep((i / active.length) * rampMs);
    const { body, picked } = buildBallot(data);
    const copies = dupSet.has(u.id) ? dupFactor : 1;
    const results = await Promise.all(Array.from({ length: copies }, () => http('POST', '/voter/api/elections/vote', { cookie: u.cookie, body })));
    let ok = 0;
    for (const r of results) { record(voteM, r); if (r.status === 200) ok++; }
    perUser.set(u.id, { ok, picked });
  });
  const stormMs = performance.now() - stormStart;
  print(voteM, stormMs);

  await sleep(2500); // let the batched websocket message arrive
  ws?.stop();

  // ---- 4. checks
  const checks: [string, boolean, string][] = [];
  const votedUsers = [...perUser.entries()].filter(([, v]) => v.ok >= 1);
  const doubled = [...perUser.entries()].filter(([, v]) => v.ok > 1);
  const dupNoWin = [...dupSet].filter((id) => (perUser.get(id)?.ok ?? 0) === 0);
  const serverErrors = [...voteM.codes.entries()].filter(([k]) => k.startsWith('5') || k.startsWith('ERR')).reduce((s, [, v]) => s + v, 0);

  checks.push(['No voter got two successful ballots from duplicate submits', doubled.length === 0, `${doubled.length} voters with more than one 200`]);
  checks.push(['Every duplicate-submitting voter still got exactly one ballot', dupNoWin.length === 0, `${dupNoWin.length} voters got none`]);
  checks.push(['No 5xx / network errors / timeouts on voting', serverErrors === 0, `${serverErrors} failed requests`]);

  if (!a['no-db-check']) {
    const { pool } = await import('../../db');
    const q = async (sql: string) => Number((await pool.query(sql, [state.campusId])).rows[0].n);
    const ballots = await q(`SELECT COUNT(*) AS n FROM ballots b JOIN elections e ON e.id = b.election_id WHERE e.campus_id = $1::uuid`);
    const bvotes = await q(`SELECT COUNT(*) AS n FROM ballot_votes bv JOIN ballots b ON b.id = bv.ballot_id JOIN elections e ON e.id = b.election_id WHERE e.campus_id = $1::uuid`);
    const logs = await q(`SELECT COUNT(*) AS n FROM vote_logs WHERE campus_id = $1::uuid`);
    const votedFlag = await q(`SELECT COUNT(*) AS n FROM voters WHERE campus_id = $1::uuid AND voting_status::text = 'VOTED'`);
    const dupBallots = await q(`SELECT COUNT(*) AS n FROM (SELECT b.election_id, b.voter_id FROM ballots b JOIN elections e ON e.id = b.election_id WHERE e.campus_id = $1::uuid GROUP BY 1, 2 HAVING COUNT(*) > 1) x`);
    const expectedRows = votedUsers.reduce((s, [, v]) => s + v.picked, 0);

    checks.push([`Ballots in DB = voters who got a 200 (${votedUsers.length})`, ballots === votedUsers.length, `DB has ${ballots}`]);
    checks.push([`Ballot rows = selections made (${expectedRows})`, bvotes === expectedRows, `DB has ${bvotes}`]);
    checks.push(['Vote logs = ballots', logs === ballots, `${logs} logs vs ${ballots} ballots`]);
    checks.push(['Voters marked VOTED = ballots', votedFlag === ballots, `${votedFlag} voted vs ${ballots} ballots`]);
    checks.push(['No duplicate ballots in DB', dupBallots === 0, `${dupBallots} duplicates`]);
    await pool.end();
  }

  console.log('\n== REALTIME (websocket) ==');
  if (!ws) console.log('   skipped');
  else if (ws.stats.error) console.log('   ' + ws.stats.error);
  else {
    const span = ws.stats.messages ? (ws.stats.lastAt - ws.stats.firstAt) / 1000 : 0;
    console.log(`   connected: ${ws.stats.connected} | VOTE_CAST messages: ${ws.stats.messages} over ${span.toFixed(1)}s`);
    console.log('   (the server batches to at most one message per 750 ms, so thousands of votes should not mean thousands of messages)');
    checks.push(['Websocket delivered live vote events', ws.stats.messages >= 1, `${ws.stats.messages} messages`]);
    checks.push(['Websocket events were batched (not one per vote)', ws.stats.messages < Math.max(10, votedUsers.length / 4), `${ws.stats.messages} messages for ${votedUsers.length} votes`]);
  }

  console.log('\n== CHECKS ==');
  for (const [name, ok, detail] of checks) console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  const failed = checks.some(([, ok]) => !ok);
  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });