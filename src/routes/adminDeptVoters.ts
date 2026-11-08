import { Request, Response, Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { requireAny } from '../auth/guards';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import * as voters from '../voterService';
import * as svc from '../adminDeptVoterService';
import { VoterScope } from '../adminDeptVoterService';
import { chunks, detachRequest, startJob } from '../jobs'; // ← CHECK PATH (file that exports startJob / detachRequest / chunks)

/** Port of AdminDeptVotersController + AdminDeptVoterApiController. */

export const adminDeptVotersRouter = Router();

const PAGE = '/admin-dept/voters';
const API = '/admin-dept/api/voters';

adminDeptVotersRouter.use(PAGE, requireAny('ROLE_ADMIN_DEPARTMENT'));
adminDeptVotersRouter.use(API, requireAny('ROLE_ADMIN_DEPARTMENT'));

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const qs = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function sendError(res: Response, e: unknown) {
  if (res.headersSent) return res.end();
  const message = (e instanceof Error && e.message) || 'Something went wrong.';
  if (e instanceof IllegalStateError) return res.status(403).json({ success: false, message });
  if (e instanceof IllegalArgumentError) return res.status(400).json({ success: false, message });
  console.error(e);
  return res.status(500).json({ success: false, message: 'Something went wrong.' });
}
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => sendError(res, e));
};

/** the session is the ONLY source of scope (never the client) */
function requireScope(req: Request): VoterScope {
  const u = req.session.user;
  if (!u?.campusId || !u.programCourse || !u.programCourse.trim()) {
    throw new IllegalStateError('Missing campusId/programCourse in session — admin-dept user not properly scoped.');
  }
  return { campusId: u.campusId, programCourse: u.programCourse };
}
function jobOwner(req: Request): string {
  const id = req.session.user?.userId;
  if (!id) throw new IllegalStateError('Session expired. Please log in again.');
  return id;
}

// ============================================================
// PAGE
// ============================================================

adminDeptVotersRouter.get(PAGE, async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    const picture = await findProfilePictureUrl(user.authUserId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(renderView('admin-dept/voters.html', {
      displayName, programCampus: `${programCourse} - ${campus}`, programCourse, campus, html_avatar,
    }));
  } catch (e) {
    console.error('Voters page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ============================================================
// API: literal paths FIRST, so "/page", "/bulk"... are never read as :id
// ============================================================

adminDeptVotersRouter.get(API, wrap(async (req, res) => {
  res.json(await svc.listScoped(requireScope(req)));
}));

adminDeptVotersRouter.get(`${API}/page`, wrap(async (req, res) => {
  const scope = requireScope(req);
  const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
  const size = Math.min(200, Math.max(1, parseInt(String(req.query.size ?? '20'), 10) || 20));
  res.json(await svc.getPage(scope, {
    page, size,
    yearLevel: voters.blankToNull(qs(req.query.yearLevel)), section: voters.blankToNull(qs(req.query.section)),
    search: voters.blankToNull(qs(req.query.search)?.toLowerCase()), departmentStatus: qs(req.query.departmentStatus),
        schoolYear: voters.blankToNull(qs(req.query.schoolYear)),
    nameSort: qs(req.query.nameSort) ?? 'default', timeSort: qs(req.query.timeSort) ?? 'default',
  }));
}));

adminDeptVotersRouter.get(`${API}/facets`, wrap(async (req, res) => {
  res.json(await svc.getFacets(requireScope(req)));
}));

adminDeptVotersRouter.get(`${API}/export`, wrap(async (req, res) => {
  const scope = requireScope(req);
  const ids = await svc.idsMatching(scope, { yearLevel: qs(req.query.yearLevel), section: qs(req.query.section), search: qs(req.query.search), schoolYear: qs(req.query.schoolYear) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lccast-voters.csv"');
  res.write(svc.CSV_HEADER);
  for (const chunk of chunks(ids, 200)) res.write(await svc.csvRowsFor(chunk));
  res.end();
}));

// ---- bulk by ids ----

adminDeptVotersRouter.patch(`${API}/archive`, wrap(async (req, res) => {
  const owned = await svc.filterToScope(req.body, requireScope(req));
  if (!owned.length) return res.status(400).json({ message: 'No voters selected.' });
  const count = await voters.moveVoters('archive', owned, req);
  res.json({ message: 'Voters archived successfully.', count });
}));

adminDeptVotersRouter.delete(`${API}/bulk`, wrap(async (req, res) => {
  const owned = await svc.filterToScope(req.body, requireScope(req));
  if (!owned.length) return res.status(400).json({ message: 'No voters selected.' });
  const count = await voters.moveVoters('trash', owned, req);
  res.json({ message: 'Voters moved to trash successfully.', count });
}));

// ---- bulk by filter (sync) ----

adminDeptVotersRouter.patch(`${API}/archive-matching`, wrap(async (req, res) => {
  const ids = await svc.idsMatching(requireScope(req), req.body ?? {});
  if (!ids.length) return res.json({ message: 'No matching voters.', count: 0 });
  res.json({ message: 'Voters archived successfully.', count: await voters.moveVoters('archive', ids, req) });
}));

adminDeptVotersRouter.delete(`${API}/delete-matching`, wrap(async (req, res) => {
  const ids = await svc.idsMatching(requireScope(req), req.body ?? {});
  if (!ids.length) return res.json({ message: 'No matching voters.', count: 0 });
  res.json({ message: 'Voters moved to trash successfully.', count: await voters.moveVoters('trash', ids, req) });
}));

// ---- import (sync) ----

adminDeptVotersRouter.post(`${API}/import`, wrap(async (req, res) => {
  const scope = requireScope(req);
  const rows = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'The import file contains no voter records.' });

  const { scopedRows, skipErrors, outOfScope } = await svc.scopeImportRows(rows, scope);
  const result = await voters.importVoters(scopedRows, req);
  res.json({
    success: true, added: result.added, updated: result.updated,
    skipped: result.skipped + outOfScope, errors: [...skipErrors, ...result.errors],
  });
}));

// ============================================================
// BACKGROUND JOBS (the admin-dept page uses these)
// ============================================================

adminDeptVotersRouter.post(`${API}/import-async`, wrap(async (req, res) => {
  const scope = requireScope(req);
  const rows = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ message: 'The import file contains no voter records.' });
  const ownerId = jobOwner(req);
  const detached = detachRequest(req);

  const { scopedRows, outOfScope } = await svc.scopeImportRows(rows, scope);

  const job = startJob(ownerId, 'VOTER_IMPORT', 'Importing voters', rows.length, async (j) => {
    let added = 0, updated = 0, skipped = outOfScope;
    if (outOfScope > 0) j.advance(0, outOfScope);

    for (const chunk of chunks(scopedRows, 25)) {
      const r = await voters.importVoters(chunk, detached);
      added += r.added; updated += r.updated; skipped += r.skipped;
      j.advance(r.added + r.updated, r.skipped);
      j.setMessage(`Added ${added} · Updated ${updated} · Skipped ${skipped}`);
    }
  });
  res.status(202).json(job.toMap());
}));

adminDeptVotersRouter.post(`${API}/export-async`, wrap(async (req, res) => {
  const scope = requireScope(req);
  const ownerId = jobOwner(req);
  const filter = { yearLevel: qs(req.query.yearLevel), section: qs(req.query.section), search: qs(req.query.search), schoolYear: qs(req.query.schoolYear) };

  const job = startJob(ownerId, 'VOTER_EXPORT', 'Exporting voters', 0, async (j) => {
    const ids = await svc.idsMatching(scope, filter);
    j.setTotal(ids.length);

    const file = path.join(os.tmpdir(), `lccast-voters-${randomUUID()}.csv`);
    await fs.promises.writeFile(file, svc.CSV_HEADER, 'utf8');
    for (const chunk of chunks(ids, 200)) {
      await fs.promises.appendFile(file, await svc.csvRowsFor(chunk), 'utf8');
      j.advance(chunk.length, 0);
    }
    j.setResult(file, 'lccast-voters.csv');
  });
  res.status(202).json(job.toMap());
}));

function bulkJob(kind: 'trash' | 'archive', type: string, title: string) {
  return wrap(async (req, res) => {
    const scope = requireScope(req);
    const ownerId = jobOwner(req);
    const detached = detachRequest(req);
    const filter = req.body ?? {};

    const job = startJob(ownerId, type, title, 0, async (j) => {
      const ids = await svc.idsMatching(scope, filter);
      j.setTotal(ids.length);
      if (!ids.length) j.setMessage('No matching voters.');
      for (const chunk of chunks(ids, 100)) {
        const ok = await voters.moveVoters(kind, chunk, detached);
        j.advance(ok, chunk.length - ok);
      }
    });
    res.status(202).json(job.toMap());
  });
}
adminDeptVotersRouter.delete(`${API}/delete-matching/async`, bulkJob('trash', 'VOTER_DELETE', 'Moving voters to trash'));
adminDeptVotersRouter.patch(`${API}/archive-matching/async`, bulkJob('archive', 'VOTER_ARCHIVE', 'Archiving voters'));

// ============================================================
// SINGLE VOTER (:id routes LAST). 404 (never 403) when outside scope.
// ============================================================

adminDeptVotersRouter.get(`${API}/:id`, wrap(async (req, res) => {
  const owned = await svc.findOwned(String(req.params.id), requireScope(req));
  if (!owned) return res.status(404).end();
  res.json((await svc.scopedResponses([owned]))[0]);
}));

adminDeptVotersRouter.put(`${API}/:id`, wrap(async (req, res) => {
  const r = await svc.updateOwned(String(req.params.id), (req.body ?? {}) as Record<string, unknown>, requireScope(req), req);
  if (r.status === 404) return res.status(404).end();
  if (r.status !== 200) return res.status(r.status).json({ message: r.message });
  res.json(r.voter);
}));

adminDeptVotersRouter.patch(`${API}/:id/archive`, wrap(async (req, res) => {
  const owned = await svc.findOwned(String(req.params.id), requireScope(req));
  if (!owned) return res.status(404).end();
  try {
    await voters.moveVoter('archive', owned.id, req);
    res.json({ message: 'Voter archived successfully.' });
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
}));

adminDeptVotersRouter.delete(`${API}/:id`, wrap(async (req, res) => {
  const owned = await svc.findOwned(String(req.params.id), requireScope(req));
  if (!owned) return res.status(404).end();
  try {
    await voters.moveVoter('trash', owned.id, req);
    res.json({ message: 'Voter moved to trash successfully.' });
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
}));

adminDeptVotersRouter.patch(`${API}/:id/restore`, wrap(async (req, res) => {
  const r = await svc.restoreScoped(String(req.params.id), requireScope(req), req);
  if (r.status === 404) return res.status(404).end();
  if (r.status !== 200) return res.status(r.status).json({ message: r.message });
  res.json(r.voter);
}));

// Permanent delete is intentionally NOT exposed here (superadmin only), same as Java.