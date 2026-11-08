import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { IllegalArgumentError } from '../errors';
import { isUuid } from '../voterService'; // ← CHECK PATH
import { chunks, detachRequest, startJob } from '../jobs';
import { getAuthUserId } from '../auth/sessionUser';
import * as svc from '../adminSscVoterService';

export const adminSscVotersRouter = Router();

const guard = requireAny('ROLE_ADMIN_SSC');
const API = '/admin-ssc/api/voters';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------- helpers

class SessionError extends Error {}

function campusIdOf(req: Request): string {
  const id = req.session.user?.campusId;
  if (!id || !id.trim()) throw new SessionError('No campus is associated with this account.');
  if (!isUuid(id)) throw new SessionError('Invalid session campusId.');
  return id;
}

/** same lookup src/routes/jobs.ts uses, so the job card and download find the job */
function jobOwnerId(req: Request): string {
  const id = getAuthUserId(req);
  if (!id) throw new SessionError('Session expired. Please log in again.');
  return id;
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const wrap = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof SessionError) return res.status(401).json({ success: false, message: e.message });
    console.error('[admin-ssc voters]', e);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

const intParam = (v: unknown, def: number) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x)).filter((x) => x.trim());

const bodyFilter = (req: Request): svc.BulkFilter => {
  const b = (req.body ?? {}) as Record<string, unknown>;
    return { program: b.program, yearLevel: b.yearLevel, section: b.section, search: b.search, schoolYear: b.schoolYear };
};
const queryFilter = (req: Request): svc.BulkFilter => ({
  program: str(req.query.program),
  yearLevel: str(req.query.yearLevel),
  section: str(req.query.section),
  search: str(req.query.search),
    schoolYear: str(req.query.schoolYear),
});

// ---------------------------------------------------------------- PAGE  (AdminVotersController)

adminSscVotersRouter.get('/admin-ssc/voters', guard, async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    let html_avatar = '';
    try {
      const picture = await findProfilePictureUrl(user.authUserId ?? user.userId);
      if (picture) {
        html_avatar = `<img src="${esc('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      }
    } catch (e) {
      console.error('admin-ssc voters avatar lookup failed:', (e as Error).message);
    }

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/voters.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC voters page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ---------------------------------------------------------------- API: reads
// NOTE: fixed paths first, "/:id" routes LAST (Express matches in order, Spring picked the most specific).

adminSscVotersRouter.get(API, guard, wrap(async (req, res) => {
  res.json(await svc.getActiveForCampus(campusIdOf(req)));
}));

adminSscVotersRouter.get(`${API}/page`, guard, wrap(async (req, res) => {
  const page = Math.max(0, intParam(req.query.page, 0));
  const size = Math.min(200, Math.max(1, intParam(req.query.size, 20)));
  res.json(
    await svc.getPageForCampus({
      campusId: campusIdOf(req),
      page,
      size,
      program: str(req.query.program),
      yearLevel: str(req.query.yearLevel),
      section: str(req.query.section),
      search: str(req.query.search),
            schoolYear: str(req.query.schoolYear),
      sscStatus: str(req.query.sscStatus),
      nameSort: str(req.query.nameSort),
      timeSort: str(req.query.timeSort),
    }),
  );
}));

adminSscVotersRouter.get(`${API}/facets`, guard, wrap(async (req, res) => {
  res.json(await svc.getFacets(campusIdOf(req), strList(req.query.program)));
}));

adminSscVotersRouter.get(`${API}/student/:studentId`, guard, wrap(async (req, res) => {
  const v = await svc.getByStudentId(String(req.params.studentId), campusIdOf(req));
  return v ? res.json(v) : res.status(404).end();
}));

// ---------------------------------------------------------------- API: bulk (sync versions)

adminSscVotersRouter.patch(`${API}/archive-matching`, guard, wrap(async (req, res) => {
  const count = await svc.archiveAllMatching(campusIdOf(req), bodyFilter(req), req);
  res.json({ message: 'Voters archived successfully.', count });
}));

adminSscVotersRouter.delete(`${API}/delete-matching`, guard, wrap(async (req, res) => {
  const count = await svc.deleteAllMatching(campusIdOf(req), bodyFilter(req), req);
  res.json({ message: 'Voters moved to trash successfully.', count });
}));

adminSscVotersRouter.patch(`${API}/archive`, guard, wrap(async (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'No voters selected.' });
  const count = await svc.archiveAllInCampus(campusIdOf(req), ids.map(String), req);
  res.json({ message: 'Voters archived successfully.', count });
}));

adminSscVotersRouter.delete(`${API}/bulk`, guard, wrap(async (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'No voters selected.' });
  const count = await svc.deleteAllInCampus(campusIdOf(req), ids.map(String), req);
  res.json({ message: 'Voters moved to trash successfully.', count });
}));

// ---------------------------------------------------------------- API: import / export (sync versions)

adminSscVotersRouter.post(`${API}/import`, guard, wrap(async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ message: 'The import file contains no voter records.' });
  }
  const r = await svc.importForCampus(campusIdOf(req), rows as Record<string, unknown>[], req);
  res.json({ success: true, added: r.added, updated: r.updated, skipped: r.skipped, errors: r.errors });
}));

adminSscVotersRouter.get(`${API}/export`, guard, wrap(async (req, res) => {
  const rows = await svc.exportMatching(campusIdOf(req), queryFilter(req));
  res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lccast-voters.csv"');
  res.send(svc.VOTERS_CSV_HEADER + rows.map(svc.csvRow).join(''));
}));

// ---------------------------------------------------------------- API: BACKGROUND JOBS

adminSscVotersRouter.post(`${API}/import-async`, guard, wrap(async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ message: 'The import file contains no voter records.' });
  }
  const campusId = campusIdOf(req);
  const ownerId = jobOwnerId(req);
  const detached = detachRequest(req);
  const all = rows as Record<string, unknown>[];

  const job = startJob(ownerId, 'VOTER_IMPORT', 'Importing voters', all.length, async (j) => {
    let added = 0, updated = 0, skipped = 0;
    const problems: string[] = [];
    for (const chunk of chunks(all, 25)) {
      const r = await svc.importForCampus(campusId, chunk, detached);
      added += r.added;
      updated += r.updated;
      skipped += r.skipped;
      problems.push(...r.errors);
      j.advance(r.added + r.updated, r.skipped);
      let msg = `Added ${added} · Updated ${updated} · Skipped ${skipped}`;
      if (problems.length) msg += ` — ${problems[0]}`;
      j.setMessage(msg);
    }
    problems.forEach((p) => console.log('IMPORT PROBLEM:', p));
  });
  return res.status(202).json(job.toMap());
}));

adminSscVotersRouter.post(`${API}/export-async`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const ownerId = jobOwnerId(req);
  const filter = queryFilter(req);

  const job = startJob(ownerId, 'VOTER_EXPORT', 'Exporting voters', 0, async (j) => {
    const rows = await svc.exportMatching(campusId, filter);
    j.setTotal(rows.length);

    const file = path.join(os.tmpdir(), `lccast-voters-${randomUUID()}.csv`);
    await fs.promises.writeFile(file, svc.VOTERS_CSV_HEADER, 'utf8');
    for (const part of chunks(rows, 100)) {
      await fs.promises.appendFile(file, part.map(svc.csvRow).join(''), 'utf8');
      j.advance(part.length, 0);
    }
    j.setResult(file, 'lccast-voters.csv');
  });
  return res.status(202).json(job.toMap());
}));

adminSscVotersRouter.delete(`${API}/delete-matching/async`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const ownerId = jobOwnerId(req);
  const filter = bodyFilter(req);
  const detached = detachRequest(req);

  const job = startJob(ownerId, 'VOTER_DELETE', 'Moving voters to trash', 0, async (j) => {
    const ids = await svc.findIdsMatchingForCampus(campusId, filter);
    j.setTotal(ids.length);
    if (!ids.length) j.setMessage('No matching voters.');
    for (const chunk of chunks(ids, 100)) {
      const ok = await svc.deleteAllInCampus(campusId, chunk, detached);
      j.advance(ok, chunk.length - ok);
    }
  });
  return res.status(202).json(job.toMap());
}));

adminSscVotersRouter.patch(`${API}/archive-matching/async`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const ownerId = jobOwnerId(req);
  const filter = bodyFilter(req);
  const detached = detachRequest(req);

  const job = startJob(ownerId, 'VOTER_ARCHIVE', 'Archiving voters', 0, async (j) => {
    const ids = await svc.findIdsMatchingForCampus(campusId, filter);
    j.setTotal(ids.length);
    if (!ids.length) j.setMessage('No matching voters.');
    for (const chunk of chunks(ids, 100)) {
      const ok = await svc.archiveAllInCampus(campusId, chunk, detached);
      j.advance(ok, chunk.length - ok);
    }
  });
  return res.status(202).json(job.toMap());
}));

// ---------------------------------------------------------------- API: single voter ("/:id" LAST)

adminSscVotersRouter.get(`${API}/:id`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ message: 'Voter not found.' });
  try {
    return res.json(await svc.getById(id, campusId));
  } catch (e) {
    if (e instanceof svc.VoterAccessError) return res.status(404).json({ message: e.message });
    throw e;
  }
}));

adminSscVotersRouter.put(`${API}/:id`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ message: 'Voter not found.' });
  try {
    const r = await svc.update(id, campusId, (req.body ?? {}) as Record<string, unknown>, req);
    if (r.status === 200) return res.json(r.voter);
    return res.status(r.status).json({ message: r.message ?? 'Voter not found.' });
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
    if (e instanceof svc.VoterAccessError) return res.status(404).json({ message: e.message });
    throw e;
  }
}));

adminSscVotersRouter.patch(`${API}/:id/archive`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const id = String(req.params.id);
  try {
    if (!isUuid(id)) throw new Error('Voter not found.');
    await svc.archive(id, campusId, req);
    return res.json({ message: 'Voter archived successfully.' });
  } catch (e) {
    return res.status(400).json({ message: (e as Error).message }); // Java: any RuntimeException -> 400
  }
}));

adminSscVotersRouter.delete(`${API}/:id`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const id = String(req.params.id);
  try {
    if (!isUuid(id)) throw new Error('Voter not found.');
    await svc.trash(id, campusId, req);
    return res.json({ message: 'Voter moved to trash successfully.' });
  } catch (e) {
    return res.status(400).json({ message: (e as Error).message });
  }
}));

adminSscVotersRouter.patch(`${API}/:id/restore`, guard, wrap(async (req, res) => {
  const campusId = campusIdOf(req);
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ message: 'Voter not found.' });
  try {
    await svc.restore(id, campusId, req);
    return res.json({ message: 'Voter restored successfully.' });
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
    if (e instanceof svc.VoterAccessError) return res.status(404).json({ message: e.message });
    throw e;
  }
}));