import fs from 'fs';
import path from 'path';
import * as repo from '../../electionRepository';
import type { Db } from '../../electionRepository';

export const CAMPUS_NAME = 'LOADTEST CAMPUS (safe to delete)';
export const STATE_FILE = path.join(__dirname, '.loadtest-state.json');
export const SESSIONS_FILE = path.join(__dirname, '.loadtest-sessions.json');

export interface State { campusId: string; users: number; password: string; partylistIds: string[]; electionId: string | null }

export const readState = (): State => {
  if (!fs.existsSync(STATE_FILE)) throw new Error('No load-test dataset found. Run: npm run lt:seed -- --confirm');
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
};
export const writeState = (s: State) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

export const studentIdOf = (i: number) => 'LT' + String(i).padStart(5, '0');
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

/** runs `worker` over `items` with at most `concurrency` in flight; never throws, returns the errors */
export async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<unknown[]> {
  const errors: unknown[] = [];
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { await worker(items[i], i); } catch (e) { errors.push(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run));
  return errors;
}

export function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** a fresh ONGOING SSC election over the given partylists (same steps as ElectionService.createElection) */
export async function createTestElection(db: Db, campusId: string, partylistIds: string[], hours: number): Promise<string> {
  const election = await repo.insertElection(db, {
    title: 'LOADTEST SSC Election', category: 'SSC', campusId, schoolYear: 'LOADTEST',
    startAt: new Date(Date.now() - 3_600_000), endAt: new Date(Date.now() + hours * 3_600_000), createdBy: null,
  });
  for (const pid of partylistIds) {
    await repo.insertPartylistLink(db, election.id, pid);
    for (const member of await repo.partylistMembers(db, pid)) {
      await repo.insertCandidate(db, { electionId: election.id, partylistId: pid, member, position: member.position });
    }
  }
  return election.id;
}