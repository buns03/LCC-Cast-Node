import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as service from '../departmentService';
import { findVoterByStudentId } from '../partylistRepository';
import { pool } from '../db';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { renderView } from '../render';
import { serve } from './storage';
import { uploadFile } from '../storage';

/** Superadmin > Departments. Guarded by the /superadmin role check in superadminRouter (mounted first). */
export const superadminDepartmentsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string => {
  if (!UUID_RE.test(String(v))) throw new IllegalArgumentError('Invalid id.');
  return String(v).toLowerCase();
};

/** plain-text errors: the page shows the response text as the message */
const route = (h: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await h(req, res);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    const status = e instanceof IllegalArgumentError ? 400 : e instanceof IllegalStateError ? 409 : 500;
    if (status === 500) console.error('Departments API error:', e);
    res.status(status).type('text').send(message);
  }
};

/** the student lookups answer { success:false, message } on bad input (what the page reads) */
const lookup = (h: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json(await h(req, res));
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).json({ success: false, message: e.message });
    console.error('Departments lookup error:', e);
    res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

// ---------- page ----------
superadminDepartmentsRouter.get('/superadmin/departments', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch {
    /* no avatar */
  }
  try {
    res.send(renderView('superadmin/departments.html', { displayName, html_avatar: avatar }));
  } catch {
    res.status(500).send('views/superadmin/departments.html is missing.');
  }
});

// DepartmentMemberController
superadminDepartmentsRouter.get('/superadmin/departments/members/student/:studentId', route(async (req, res) => {
  const voter = await findVoterByStudentId(pool, String(req.params.studentId).trim());
  if (!voter) return res.status(404).end();
  res.json(voter);
}));

// ---------- API ----------
const base = '/superadmin/api/departments';

superadminDepartmentsRouter.get(base, route(async (_req, res) => res.json(await service.getActive())));
superadminDepartmentsRouter.get(`${base}/archived`, route(async (_req, res) => res.json(await service.getArchived())));
superadminDepartmentsRouter.get(`${base}/trash`, route(async (_req, res) => res.json(await service.getDeleted())));
superadminDepartmentsRouter.get(`${base}/campuses`, route(async (_req, res) => res.json(await service.getCampuses())));

superadminDepartmentsRouter.get(`${base}/file`, async (req: Request, res: Response) => {
  if (typeof req.query.path !== 'string' || !req.query.path) return res.status(400).end();
  return serve(res, req.query.path);
});

// student lookups used while filling member rows
superadminDepartmentsRouter.get(`${base}/members/student/:studentId/school-year/:schoolYear`, lookup(async (req) =>
  service.getStudentMembershipsBySchoolYear(req.params.studentId, req.params.schoolYear,
    typeof req.query.excludeDepartmentId === 'string' && req.query.excludeDepartmentId ? uuid(req.query.excludeDepartmentId) : null)));

superadminDepartmentsRouter.get(`${base}/members/student/:studentId/campus/:campusId/department/:departmentId`, lookup(async (req) =>
  service.getStudentByCampusAndDepartment(req.params.studentId, uuid(req.params.campusId), uuid(req.params.departmentId))));

superadminDepartmentsRouter.get(`${base}/members/student/:studentId/campus/:campusId/department-name/:departmentName`, lookup(async (req) =>
  service.getStudentByCampusAndName(req.params.studentId, uuid(req.params.campusId), req.params.departmentName)));

superadminDepartmentsRouter.get(`${base}/:departmentId/members/student/:studentId`, lookup(async (req) =>
  service.getStudentForDepartmentMember(req.params.studentId, uuid(req.params.departmentId))));

// file upload (multipart: file + type) -> { success, path }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
superadminDepartmentsRouter.post(`${base}/upload`, (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: unknown) => {
    try {
      if (err) throw err;
      res.json({ success: true, path: await uploadFile(req.file, String(req.body?.type ?? '')) });
    } catch (e) {
      res.status(400).json({ success: false, error: e instanceof Error && e.message ? e.message : 'File upload failed.' });
    }
  });
});

superadminDepartmentsRouter.get(`${base}/:id`, route(async (req, res) =>
  res.json((await service.withMembers([await service.getById(uuid(req.params.id))]))[0])));
superadminDepartmentsRouter.get(`${base}/:id/members`, route(async (req, res) => res.json(await service.getMembers(uuid(req.params.id)))));

superadminDepartmentsRouter.get(`${base}/:id/file/:type`, route(async (req, res) => {
  const d = await service.getById(uuid(req.params.id));
  const t = String(req.params.type).toLowerCase();
  if (t !== 'poster' && t !== 'logo') throw new IllegalArgumentError('Invalid department file type.');
  return serve(res, (t === 'poster' ? d.posterImageUrl : d.posterLogoUrl) ?? '');
}));

superadminDepartmentsRouter.get(`${base}/:departmentId/members/:memberId/file/:type`, route(async (req, res) => {
  const m = await service.getMember(uuid(req.params.departmentId), uuid(req.params.memberId));
  const t = String(req.params.type).toLowerCase();
  const path = t === 'campaign' ? m.campaignImageUrl : t === 'background' ? m.backgroundImageUrl : t === 'photo' ? m.photoImageUrl : undefined;
  if (path === undefined) throw new IllegalArgumentError('Invalid member file type.');
  return serve(res, path ?? '');
}));

// create answers bad input as JSON { success:false, message } (like the Java controller)
superadminDepartmentsRouter.post(base, async (req: Request, res: Response) => {
  try {
    res.json((await service.withMembers([await service.save(req.body, req)]))[0]);
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).json({ success: false, message: e.message });
    console.error('Departments API error:', e);
    res.status(e instanceof IllegalStateError ? 409 : 500).type('text').send(e instanceof Error ? e.message : 'Something went wrong.');
  }
});
superadminDepartmentsRouter.put(`${base}/:id`, route(async (req, res) =>
  res.json((await service.withMembers([await service.update(uuid(req.params.id), req.body, req)]))[0])));
superadminDepartmentsRouter.put(`${base}/:id/archive`, route(async (req, res) => { await service.archive(uuid(req.params.id), req); res.status(200).end(); }));
superadminDepartmentsRouter.delete(`${base}/:id`, route(async (req, res) => { await service.remove(uuid(req.params.id), req); res.status(200).end(); }));
superadminDepartmentsRouter.put(`${base}/:id/restore`, route(async (req, res) => { await service.restore(uuid(req.params.id), req); res.status(200).end(); }));
superadminDepartmentsRouter.delete(`${base}/:id/permanent`, route(async (req, res) => { await service.permanentlyDelete(uuid(req.params.id)); res.status(200).end(); }));
