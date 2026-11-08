import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as service from '../partylistService';
import { findVoterByStudentId } from '../partylistRepository';
import { pool } from '../db';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { renderView } from '../render';
import { serve } from './storage';
import { uploadFile } from '../storage';

/** Superadmin > Partylists. Guarded by the /superadmin role check in superadminRouter (mounted first). */
export const superadminPartylistsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string => {
  if (!UUID_RE.test(String(v))) throw new IllegalArgumentError('Invalid id.');
  return String(v).toLowerCase();
};

/** The page shows the response TEXT as the error message, so errors go back as plain text. */
const route = (h: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await h(req, res);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    const status = e instanceof IllegalArgumentError ? 400 : e instanceof IllegalStateError ? 409 : 500;
    if (status === 500) console.error('Partylists API error:', e);
    res.status(status).type('text').send(message);
  }
};

// ---------- page ----------
superadminPartylistsRouter.get('/superadmin/partylists', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch {
    /* no avatar */
  }
  try {
    res.send(renderView('superadmin/partylists.html', { displayName, html_avatar: avatar }));
  } catch {
    res.status(500).send('views/superadmin/partylists.html is missing.');
  }
});

// PartylistMemberController: student lookup that fills the member row
superadminPartylistsRouter.get('/superadmin/partylists/members/student/:studentId', route(async (req, res) => {
  const campusId = uuid(req.query.campusId);
  const voter = await findVoterByStudentId(pool, String(req.params.studentId).trim());
  if (!voter || voter.campusId !== campusId) return res.status(404).end();
  res.json(voter);
}));

// ---------- API ----------
const base = '/superadmin/api/partylists';

superadminPartylistsRouter.get(base, route(async (_req, res) => res.json(await service.getActive())));
superadminPartylistsRouter.get(`${base}/archived`, route(async (_req, res) => res.json(await service.getArchived())));
superadminPartylistsRouter.get(`${base}/trash`, route(async (_req, res) => res.json(await service.getDeleted())));
superadminPartylistsRouter.get(`${base}/campuses`, route(async (_req, res) => res.json(await service.getCampuses())));

superadminPartylistsRouter.get(`${base}/file`, async (req: Request, res: Response) => {
  if (typeof req.query.path !== 'string' || !req.query.path) return res.status(400).end();
  return serve(res, req.query.path);
});

// file upload (multipart: file + type) -> { success, path }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
superadminPartylistsRouter.post(`${base}/upload`, (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: unknown) => {
    try {
      if (err) throw err;
      const path = await uploadFile(req.file, String(req.body?.type ?? ''));
      res.json({ success: true, path });
    } catch (e) {
      res.status(400).json({ success: false, error: e instanceof Error && e.message ? e.message : 'File upload failed.' });
    }
  });
});

superadminPartylistsRouter.post(`${base}/validate-members`, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    await service.validateMembers(pool, b.id ?? null, b.campus?.id ?? null, b.schoolYear ?? null, b.members);
    res.json({ valid: true });
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).json({ valid: false, error: e.message });
    console.error(e);
    res.status(500).json({ valid: false, error: 'Validation failed.' });
  }
});

superadminPartylistsRouter.get(`${base}/:id`, route(async (req, res) => res.json((await service.withMembers([await service.getById(uuid(req.params.id))]))[0])));
superadminPartylistsRouter.get(`${base}/:id/members`, route(async (req, res) => res.json(await service.getMembers(uuid(req.params.id)))));

superadminPartylistsRouter.get(`${base}/:id/file/:type`, route(async (req, res) => {
  const p = await service.getById(uuid(req.params.id));
  const t = String(req.params.type).toLowerCase();
  if (t !== 'poster' && t !== 'logo') throw new IllegalArgumentError('Invalid partylist file type.');
  return serve(res, (t === 'poster' ? p.posterImageUrl : p.posterLogoUrl) ?? '');
}));

superadminPartylistsRouter.get(`${base}/:partylistId/members/:memberId/file/:type`, route(async (req, res) => {
  const m = await service.getMember(uuid(req.params.partylistId), uuid(req.params.memberId));
  const t = String(req.params.type).toLowerCase();
  const path = t === 'campaign' ? m.campaignImageUrl : t === 'background' ? m.backgroundImageUrl : t === 'photo' ? m.photoImageUrl : undefined;
  if (path === undefined) throw new IllegalArgumentError('Invalid member file type.');
  return serve(res, path ?? '');
}));

superadminPartylistsRouter.post(base, route(async (req, res) => res.json((await service.withMembers([await service.save(req.body, req)]))[0])));
superadminPartylistsRouter.put(`${base}/:id`, route(async (req, res) => res.json((await service.withMembers([await service.update(uuid(req.params.id), req.body, req)]))[0])));
superadminPartylistsRouter.put(`${base}/:id/archive`, route(async (req, res) => { await service.archive(uuid(req.params.id), req); res.status(200).end(); }));
superadminPartylistsRouter.delete(`${base}/:id`, route(async (req, res) => { await service.remove(uuid(req.params.id), req); res.status(200).end(); }));
superadminPartylistsRouter.put(`${base}/:id/restore`, route(async (req, res) => { await service.restore(uuid(req.params.id), req); res.status(200).end(); }));
superadminPartylistsRouter.delete(`${base}/:id/permanent`, route(async (req, res) => { await service.permanentlyDelete(uuid(req.params.id)); res.status(200).end(); }));
