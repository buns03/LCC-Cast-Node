import { Request, Response, NextFunction, Router } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { requireAny } from '../auth/guards';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { uploadFile } from '../storage';
import { serve } from './storage';
import * as repo from '../departmentRepository';
import * as service from '../departmentService';
import type { DepartmentJson } from '../departmentRepository';
import type { DepartmentInput } from '../departmentService';

/** Port of AdminDeptDepartmentController + AdminDeptDepartmentApiController. */

export const adminDeptDepartmentsRouter = Router();

const PAGE = '/admin-dept/departments';
const API = '/admin-dept/api/departments';

adminDeptDepartmentsRouter.use(PAGE, requireAny('ROLE_ADMIN_DEPARTMENT'));
adminDeptDepartmentsRouter.use(API, requireAny('ROLE_ADMIN_DEPARTMENT'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Same mapping as the Java @ExceptionHandlers: IllegalArgument -> 400, IllegalState -> 409, other runtime errors -> 400
function sendError(res: Response, e: unknown) {
  if (res.headersSent) return;
  const message = (e instanceof Error && e.message) || 'Something went wrong.';
  if (e instanceof IllegalStateError) return res.status(409).json({ success: false, message });
  if (e instanceof IllegalArgumentError) return res.status(400).json({ success: false, message });
  if (typeof (e as { code?: unknown } | null)?.code === 'string') {
    console.error(e); // database / network error: don't leak details
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
  return res.status(400).json({ success: false, message });
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((e) => sendError(res, e));
};

// ---------------- scope: the session is the ONLY source of truth ----------------

interface Scope { campusId: string; programCourse: string }

function requireScope(req: Request): Scope {
  const user = req.session.user;
  const campusId = user?.campusId;
  const programCourse = user?.programCourse;
  if (!campusId || !programCourse || !programCourse.trim()) {
    throw new IllegalStateError('Missing campusId/programCourse in session — admin-dept user not properly scoped.');
  }
  return { campusId, programCourse };
}

const inScope = (d: DepartmentJson, s: Scope) =>
  !!d.campus?.id && d.campus.id.toLowerCase() === s.campusId.toLowerCase() &&
  !!d.name && d.name.trim().toLowerCase() === s.programCourse.trim().toLowerCase();

/** the department of :id when it is in this admin's scope, else null (route answers 404) */
async function scopedDepartment(req: Request, id = String(req.params.id)): Promise<DepartmentJson | null> {
  const scope = requireScope(req);
  if (!UUID_RE.test(id)) return null;
  const d = await service.getById(id);
  return inScope(d, scope) ? d : null;
}

// ============================================================
// PAGE
// ============================================================

adminDeptDepartmentsRouter.get(PAGE, async (req: Request, res: Response) => {
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
    res.send(
      renderView('admin-dept/departments.html', {
        displayName,
        programCampus: `${programCourse} - ${campus}`,
        programCourse,
        campus,
        campusId: user.campusId ?? '',
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('Departments page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ============================================================
// API: literal paths first, so "/file" is never read as an :id
// ============================================================

// GET: only this admin's own campus + department
adminDeptDepartmentsRouter.get(API, wrap(async (req, res) => {
  const s = requireScope(req);
  const list = await repo.listByCampusNameStatus(pool, s.campusId, s.programCourse, 'ACTIVE');
  res.json(await service.withMembers(list));
}));

// GET /file?path=...
adminDeptDepartmentsRouter.get(`${API}/file`, wrap(async (req, res) => {
  const path = req.query.path;
  if (typeof path !== 'string' || !path) return res.status(400).end();
  return serve(res, path);
}));

// student lookup: campus + department are ALWAYS the session's
adminDeptDepartmentsRouter.get(`${API}/members/student/:studentId`, wrap(async (req, res) => {
  const s = requireScope(req);
  res.json(await service.getStudentByCampusAndName(String(req.params.studentId), s.campusId, s.programCourse));
}));

adminDeptDepartmentsRouter.get(`${API}/members/student/:studentId/school-year/:schoolYear`, wrap(async (req, res) => {
  requireScope(req);
  const exclude = typeof req.query.excludeDepartmentId === 'string' && UUID_RE.test(req.query.excludeDepartmentId)
    ? req.query.excludeDepartmentId : null;
  res.json(await service.getStudentMembershipsBySchoolYear(String(req.params.studentId), String(req.params.schoolYear), exclude));
}));

// POST /upload (multipart: file + type). Returns { success, path }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const uploadSingle = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) =>
    err ? res.status(400).json({ success: false, error: (err as Error).message || 'File upload failed.' }) : next());

adminDeptDepartmentsRouter.post(`${API}/upload`, uploadSingle, wrap(async (req, res) => {
  requireScope(req);
  try {
    const path = await uploadFile(req.file, String(req.body?.type ?? ''));
    res.json({ success: true, path });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message || 'File upload failed.' });
  }
}));

// ---------------- :id routes ----------------

adminDeptDepartmentsRouter.get(`${API}/:id`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  res.json((await service.withMembers([d]))[0]);
}));

adminDeptDepartmentsRouter.get(`${API}/:id/members`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  res.json(await service.getMembers(d.id));
}));

adminDeptDepartmentsRouter.get(`${API}/:id/file/:type`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  const type = String(req.params.type).toLowerCase();
  if (type !== 'poster' && type !== 'logo') throw new IllegalArgumentError('Invalid department file type.');
  return serve(res, (type === 'poster' ? d.posterImageUrl : d.posterLogoUrl) ?? '');
}));

adminDeptDepartmentsRouter.get(`${API}/:departmentId/members/:memberId/file/:type`, wrap(async (req, res) => {
  const d = await scopedDepartment(req, String(req.params.departmentId));
  if (!d) return res.status(404).end();
  const member = await service.getMember(d.id, String(req.params.memberId));
  const type = String(req.params.type).toLowerCase();
  const path = type === 'campaign' ? member.campaignImageUrl
    : type === 'background' ? member.backgroundImageUrl
    : type === 'photo' ? member.photoImageUrl
    : (() => { throw new IllegalArgumentError('Invalid member file type.'); })();
  return serve(res, path ?? '');
}));

// CREATE: campus and name are forced from the session, whatever the body says
adminDeptDepartmentsRouter.post(API, wrap(async (req, res) => {
  const s = requireScope(req);
  const body = (req.body ?? {}) as DepartmentInput;
  body.campus = { id: s.campusId };
  body.name = s.programCourse;
  res.json(await service.save(body, req));
}));

adminDeptDepartmentsRouter.put(`${API}/:id`, wrap(async (req, res) => {
  const s = requireScope(req);
  const existing = await scopedDepartment(req);
  if (!existing) return res.status(404).end();
  const body = (req.body ?? {}) as DepartmentInput;
  body.campus = { id: s.campusId };
  body.name = s.programCourse;
  res.json(await service.update(existing.id, body, req));
}));

adminDeptDepartmentsRouter.put(`${API}/:id/archive`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  await service.archive(d.id, req);
  res.status(200).end();
}));

adminDeptDepartmentsRouter.delete(`${API}/:id`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  await service.remove(d.id, req);
  res.status(200).end();
}));

adminDeptDepartmentsRouter.put(`${API}/:id/restore`, wrap(async (req, res) => {
  const d = await scopedDepartment(req);
  if (!d) return res.status(404).end();
  await service.restore(d.id, req);
  res.status(200).end();
}));

// Permanent delete is intentionally NOT exposed here (superadmin only), same as Java.