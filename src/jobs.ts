import { randomUUID } from 'crypto';
import fs from 'fs';
import type { Request } from 'express';

export type JobStatus = 'RUNNING' | 'DONE' | 'FAILED';

export class BackgroundJob {
  readonly id = randomUUID();
  total: number;
  processed = 0;
  succeeded = 0;
  failed = 0;
  status: JobStatus = 'RUNNING';
  message = '';
  resultFile: string | null = null;
  resultName: string | null = null;
  finishedAt: Date | null = null;

  constructor(readonly ownerId: string, readonly type: string, readonly title: string, total: number) {
    this.total = total;
  }

  setTotal(n: number) { this.total = n; }
  setMessage(m: string) { this.message = m; }
  advance(ok: number, bad: number) {
    this.succeeded += ok;
    this.failed += bad;
    this.processed += ok + bad;
  }
  setResult(file: string, name: string) {
    this.resultFile = file;
    this.resultName = name;
  }

  /** same keys the browser's job-progress.js expects (BackgroundJob.toMap in Java) */
  toMap() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      status: this.status,
      total: this.total,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      message: this.message,
      downloadable: this.resultFile !== null && this.status === 'DONE',
    };
  }
}

// ---------------------------------------------------------------- registry + runner

const jobs = new Map<string, BackgroundJob>();
const MAX_CONCURRENT = 2; // Executors.newFixedThreadPool(2)
const queue: Array<() => Promise<void>> = [];
let running = 0;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const next = queue.shift()!;
    running++;
    next().finally(() => {
      running--;
      pump();
    });
  }
}

export function startJob(
  ownerId: string,
  type: string,
  title: string,
  total: number,
  task: (job: BackgroundJob) => Promise<void>,
): BackgroundJob {
  const job = new BackgroundJob(ownerId, type, title, total);
  jobs.set(job.id, job);

  queue.push(async () => {
    try {
      await task(job);
      job.status = 'DONE';
    } catch (e) {
      console.error('[jobs] job failed:', e);
      job.status = 'FAILED';
      job.message = (e as Error).message || 'Unexpected error.';
    } finally {
      job.finishedAt = new Date();
    }
  });
  pump();
  return job;
}

export function dismissJob(job: BackgroundJob): void {
  jobs.delete(job.id);
  if (job.resultFile) fs.promises.unlink(job.resultFile).catch(() => undefined);
}

/** finished jobs older than 1 hour are removed (cleanup() in Java) */
function cleanup() {
  const limit = Date.now() - 60 * 60 * 1000;
  for (const j of [...jobs.values()]) {
    if (j.finishedAt && j.finishedAt.getTime() < limit) dismissJob(j);
  }
}

export function activeFor(ownerId: string): BackgroundJob[] {
  cleanup();
  return [...jobs.values()].filter((j) => j.ownerId === ownerId);
}

export function findJob(id: string, ownerId: string): BackgroundJob | null {
  const j = jobs.get(id);
  return j && j.ownerId === ownerId ? j : null;
}

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Port of DetachedRequest: a copy of the values auditLog() and getAuthUserId() read
 * (session user, user-agent / forwarded headers, IP) so a job can keep using them
 * after the real HTTP request has finished.
 */
export function detachRequest(req: Request): Request {
  const user = req.session?.user ? { ...req.session.user } : undefined;
  const headers: Record<string, string> = {};
  for (const h of ['user-agent', 'x-forwarded-for', 'x-real-ip']) {
    const v = req.headers[h];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) headers[h] = value;
  }
  return {
    session: { user },
    headers,
    socket: { remoteAddress: req.socket?.remoteAddress },
  } as unknown as Request;
}