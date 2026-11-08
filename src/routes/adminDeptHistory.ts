import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as history from '../historyService';
import { isUuid } from '../historyRepository';

export const adminDeptHistoryRouter = Router();

// every /api/admin-dept/history/* call is Department-Admin only
adminDeptHistoryRouter.use('/api/admin-dept/history', requireAny('ROLE_ADMIN_DEPARTMENT'));

const q = (req: Request, name: string): string | undefined => {
  const v = req.query[name];
  return typeof v === 'string' ? v : undefined;
};
const pageOf = (req: Request) => {
  const n = parseInt(q(req, 'page') ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
};
const isAll = (req: Request) => q(req, 'all')?.toLowerCase() === 'true';

const sessionCampusId = (req: Request): string | null => {
  const v = req.session.user?.campusId;
  return v ? String(v) : null;
};
const sessionProgramCourse = (req: Request): string | null => {
  const v = req.session.user?.programCourse;
  return v ? String(v) : null;
};

const emptyPage = { items: [], page: 1, totalPages: 1, totalItems: 0 };

/** same mapping as AdminDeptHistoryApiController's @ExceptionHandlers: 404 / 409 / 403 */
function fail(res: Response, e: unknown) {
  if (e instanceof history.NotFoundError) return res.status(404).send(e.message);
  if (e instanceof IllegalStateError) return res.status(409).send(e.message);
  if (e instanceof IllegalArgumentError) return res.status(403).send(e.message);
  console.error('Admin-dept history API error:', e);
  return res.status(500).send('Something went wrong on the server.');
}

// ---------------- vote logs ----------------

adminDeptHistoryRouter.get('/api/admin-dept/history/vote-logs', async (req: Request, res: Response) => {
  try {
    const campusId = sessionCampusId(req);
    const programCourse = sessionProgramCourse(req);
    if (!campusId || !programCourse) return res.json(emptyPage);

    res.json(
      await history.getVoteLogsForAdminDept(
        campusId, programCourse,
        { search: q(req, 'search'), ballotRef: q(req, 'ballotRef'), section: q(req, 'section'), year: q(req, 'year') },
        q(req, 'sort') ?? 'time-down', pageOf(req), isAll(req),
      ),
    );
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.get('/api/admin-dept/history/vote-logs/filter-options', async (req: Request, res: Response) => {
  try {
    const campusId = sessionCampusId(req);
    const programCourse = sessionProgramCourse(req);
    if (!campusId || !programCourse) return res.json({ sections: [], yearLevels: [] });

    res.json(await history.getVoteLogFilterOptionsForAdminDept(campusId, programCourse));
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- actions ----------------

adminDeptHistoryRouter.get('/api/admin-dept/history/actions/filter-options', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.json([]);
    res.json(await history.getActionFilterOptionsForUser(userId));
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.get('/api/admin-dept/history/actions', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.json(emptyPage);
    res.json(await history.getActionsForAdminDept(userId, q(req, 'search'), q(req, 'action'), pageOf(req), isAll(req)));
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.get('/api/admin-dept/history/actions/:id/details', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(403).end();
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).send('Invalid id.');
    res.json(await history.getActionDetails(id, userId));
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- archives ----------------

adminDeptHistoryRouter.get('/api/admin-dept/history/archives', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.json(emptyPage);
    res.json(await history.getArchivesForAdminDept(userId, q(req, 'search'), q(req, 'type'), pageOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.get('/api/admin-dept/history/archives/:id/details', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw new IllegalArgumentError('Session expired. Please log in again.');
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).send('Invalid id.');
    res.json(await history.getArchiveDetailsForAdminDept(id, userId));
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.post('/api/admin-dept/history/archives/:id/restore', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(403).end();
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).send('Invalid id.');
    await history.restoreArchiveForAdminDept(id, userId, req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- trash ----------------

adminDeptHistoryRouter.get('/api/admin-dept/history/trash', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.json(emptyPage);
    res.json(await history.getTrashForAdminDept(userId, q(req, 'search'), q(req, 'type'), pageOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.post('/api/admin-dept/history/trash/:id/restore', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(403).end();
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).send('Invalid id.');
    await history.restoreTrashForAdminDept(id, userId, req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.delete('/api/admin-dept/history/trash/:id', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(403).end();
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).send('Invalid id.');
    await history.deleteTrashPermanentlyForAdminDept(id, userId, req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

adminDeptHistoryRouter.delete('/api/admin-dept/history/trash', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(403).end();
    await history.emptyTrashForAdminDept(userId, req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});