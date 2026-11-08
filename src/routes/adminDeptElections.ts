import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { pool } from '../db';
import { findProfilePictureUrl } from '../repositories';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as repo from '../electionRepository';
import { extractProgramCode } from '../departmentUtils';
import {
  ElectionInput,
  archiveElection,
  createElection,
  deleteElection,
  getByCampus,
  getById,
  toResponse,
  updateElection,
} from '../electionService';
import { cancelScheduled, getEmailStatus, progressTracker, schedule, sendNow } from '../electionEmailService';

export const adminDeptElectionsRouter = Router();

// every /admin-dept/* URL (pages AND api) is Department-Admin only
adminDeptElectionsRouter.use('/admin-dept', requireAny('ROLE_ADMIN_DEPARTMENT'));

// ---------- helpers ----------

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Java: sessionCampusId / sessionDepartmentCode (trim + UPPER CASE) / sessionUserId. Scope comes ONLY from the session. */
function scopeOf(req: Request) {
  const u = req.session.user!;
  return {
    userId: u.userId ?? null,
    campusId: u.campusId ?? null,
    deptCode: u.programCourse == null ? null : u.programCourse.trim().toUpperCase(),
  };
}

/** Java @ExceptionHandler: IllegalArgument -> 400 {message}, IllegalState -> 409 {message}. */
function fail(res: Response, e: unknown) {
  if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
  if (e instanceof IllegalStateError) return res.status(409).json({ message: e.message });
  console.error('Admin-dept elections error:', e);
  return res.status(500).json({ message: 'Something went wrong.' });
}

const toDate = (v: unknown): Date | null => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Admin-dept elections are ALWAYS category DEPARTMENT with no partylists (the client's "category" is ignored, like Java). */
function parseInput(body: any): ElectionInput {
  return {
    title: body?.title == null ? null : String(body.title),
    category: 'DEPARTMENT',
    campusId: body?.campusId ? String(body.campusId) : null,
    schoolYear: body?.schoolYear == null ? null : String(body.schoolYear),
    startAt: toDate(body?.startAt),
    endAt: toDate(body?.endAt),
    partylistIds: [],
    departmentIds: toIds(body?.departmentIds),
  };
}

// ---------- scope checks (AdminElectionService) ----------

function assertCampusMatches(sessionCampusId: string | null, requestCampusId: string | null | undefined) {
  if (!sessionCampusId) throw new IllegalStateError('No campus is registered to this account.');
  if (sessionCampusId.toLowerCase() !== String(requestCampusId ?? '').toLowerCase()) {
    throw new IllegalArgumentError('You are not authorized to manage elections for that campus.');
  }
}

async function assertDepartmentsInScope(departmentIds: string[], adminDeptCode: string | null) {
  if (!adminDeptCode || !adminDeptCode.trim()) throw new IllegalStateError('No department is registered to this account.');
  if (!departmentIds.length) throw new IllegalArgumentError('Department election requires at least one department.');

  const departments = await repo.findDepartmentsByIds(pool, departmentIds);
  if (departments.length !== departmentIds.length) throw new IllegalArgumentError('One or more departments were not found.');

  for (const d of departments) {
    const code = extractProgramCode(d);
    if (code === null || code.toUpperCase() !== adminDeptCode.toUpperCase()) {
      throw new IllegalArgumentError(`You are not authorized to use department "${d.title}".`);
    }
  }
}

async function electionBelongsToDepartment(electionId: string, adminDeptCode: string): Promise<boolean> {
  const links = await repo.departmentLinks(pool, electionId);
  return links.some((d) => {
    const code = extractProgramCode(d);
    return code !== null && code.toUpperCase() === adminDeptCode.toUpperCase();
  });
}

async function getScopedById(id: string, sessionCampusId: string | null, adminDeptCode: string | null) {
  const election = await getById(id);
  assertCampusMatches(sessionCampusId, election.campusId);
  if (!adminDeptCode || !(await electionBelongsToDepartment(id, adminDeptCode))) {
    throw new IllegalArgumentError('Election not found for this account.');
  }
  return election;
}

/** Elections visible to this admin: DEPARTMENT category, same campus, department in scope. */
async function getScopedElections(sessionCampusId: string, adminDeptCode: string) {
  const scoped = [];
  for (const e of await getByCampus(sessionCampusId)) {
    if (e.category === 'DEPARTMENT' && (await electionBelongsToDepartment(e.id, adminDeptCode))) scoped.push(e);
  }
  return Promise.all(scoped.map(toResponse));
}

// ============================================================
// PAGE: GET /admin-dept/elections
// ============================================================

adminDeptElectionsRouter.get('/admin-dept/elections', async (req: Request, res: Response) => {
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
      renderView('admin-dept/elections.html', {
        displayName,
        campus,
        programCourse,
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
        adminCampusId: user.campusId ?? '',
      }),
    );
  } catch (e) {
    console.error('Elections page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ============================================================
// API: /admin-dept/api/elections  (AdminDeptElectionApiController)
// ============================================================

adminDeptElectionsRouter.get('/admin-dept/api/elections', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    if (!s.campusId || s.deptCode === null) return res.status(401).end();
    return res.json(await getScopedElections(s.campusId, s.deptCode));
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.get('/admin-dept/api/elections/:id', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    return res.json(await toResponse(await getScopedById(String(req.params.id), s.campusId, s.deptCode)));
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.post('/admin-dept/api/elections', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    if (!s.userId || !s.campusId || s.deptCode === null) return res.status(401).end();

    const input = parseInput(req.body);
    assertCampusMatches(s.campusId, input.campusId);
    await assertDepartmentsInScope(input.departmentIds ?? [], s.deptCode);

    const saved = await createElection(input, s.userId, req);
    return res.json(await toResponse(saved));
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.put('/admin-dept/api/elections/:id', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    if (!s.campusId || s.deptCode === null) return res.status(401).end();

    const id = String(req.params.id);
    // Reject if the election isn't in this admin's scope BEFORE mutating it.
    await getScopedById(id, s.campusId, s.deptCode);

    const input = parseInput(req.body);
    assertCampusMatches(s.campusId, input.campusId);
    await assertDepartmentsInScope(input.departmentIds ?? [], s.deptCode);

    const saved = await updateElection(id, input, req);
    return res.json(await toResponse(saved));
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.put('/admin-dept/api/elections/:id/archive', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    const id = String(req.params.id);
    await getScopedById(id, s.campusId, s.deptCode);
    await archiveElection(id, req);
    return res.status(200).end();
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.delete('/admin-dept/api/elections/:id', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    const id = String(req.params.id);
    await getScopedById(id, s.campusId, s.deptCode);
    await deleteElection(id, req);
    return res.status(200).end();
  } catch (e) {
    return fail(res, e);
  }
});

// ============================================================
// API: /admin-dept/api/elections/:id/email/*  (AdminDeptElectionEmailApiController)
// ============================================================

/** Java authorized(): false -> 401; also verifies the election belongs to this admin's campus + department. */
async function authorizedFor(req: Request, electionId: string): Promise<boolean> {
  const s = scopeOf(req);
  if (!s.campusId || s.deptCode === null) return false;
  await getScopedById(electionId, s.campusId, s.deptCode);
  return true;
}

adminDeptElectionsRouter.get('/admin-dept/api/elections/:id/email/status', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!(await authorizedFor(req, id))) return res.status(401).end();
    return res.json(await getEmailStatus(id));
  } catch (e) {
    return fail(res, e);
  }
});

// Sends the whole batch, then answers. The page polls /progress/:jobId while this request is still running.
adminDeptElectionsRouter.post('/admin-dept/api/elections/:id/email/send', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    if (!s.userId) return res.status(401).end();

    const id = String(req.params.id);
    if (!(await authorizedFor(req, id))) return res.status(401).end();

    const jobId = typeof req.query.jobId === 'string' && req.query.jobId ? req.query.jobId : null;
    const campaign = await sendNow(id, s.userId, req, jobId);

    return res.json({ message: 'Election email sent successfully.', campaignId: campaign.id, status: campaign.status });
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.get('/admin-dept/api/elections/:id/email/progress/:jobId', async (req: Request, res: Response) => {
  try {
    if (!(await authorizedFor(req, String(req.params.id)))) return res.status(401).end();
    const progress = progressTracker.get(String(req.params.jobId));
    return progress ? res.json(progress) : res.status(404).end();
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.post('/admin-dept/api/elections/:id/email/schedule', async (req: Request, res: Response) => {
  try {
    const s = scopeOf(req);
    if (!s.userId) return res.status(401).end();

    const id = String(req.params.id);
    if (!(await authorizedFor(req, id))) return res.status(401).end();

    const campaign = await schedule(id, toDate(req.body?.scheduledAt), s.userId, req);
    return res.json({
      message: 'Election email scheduled successfully.',
      campaignId: campaign.id,
      status: campaign.status,
      scheduledAt: campaign.scheduledAt,
    });
  } catch (e) {
    return fail(res, e);
  }
});

adminDeptElectionsRouter.delete('/admin-dept/api/elections/:id/email/schedule', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!(await authorizedFor(req, id))) return res.status(401).end();
    await cancelScheduled(id, req);
    return res.json({ message: 'Scheduled election email cancelled.' });
  } catch (e) {
    return fail(res, e);
  }
});