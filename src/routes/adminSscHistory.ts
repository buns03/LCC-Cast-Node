import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as history from '../historyService';
import { isUuid } from '../historyRepository';

export const adminSscHistoryRouter = Router();

const guard = requireAny('ROLE_ADMIN_SSC');
const API = '/admin-ssc/api/history';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------- helpers

class SessionError extends Error {}

const q = (req: Request, name: string): string | undefined => {
  const v = req.query[name];
  return typeof v === 'string' ? v : undefined;
};
const pageOf = (req: Request) => {
  const n = parseInt(q(req, 'page') ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
};
const wantsAll = (req: Request) => q(req, 'all')?.toLowerCase() === 'true';

/** Java sessionUserId(): the logged-in admin's auth user id */
function sessionUserId(req: Request): string {
  const id = getAuthUserId(req);
  if (!id) throw new SessionError('Session expired. Please log in again.');
  return id;
}

/** Java sessionCampusId(): the campus registered on this account; a client-supplied campusId is never read */
function sessionCampusId(req: Request): string {
  const id = req.session.user?.campusId;
  if (!id || !id.trim()) throw new SessionError('Session expired. Please log in again.');
  if (!isUuid(id)) throw new SessionError('Invalid session campusId.');
  return id;
}

/** same mapping as AdminSscHistoryApiController's @ExceptionHandlers: 404 / 403 (ownership) / 409, plus 401 for the session */
function fail(res: Response, e: unknown) {
  if (e instanceof SessionError) return res.status(401).send(e.message);
  if (e instanceof history.NotFoundError) return res.status(404).send(e.message);
  if (e instanceof IllegalStateError) return res.status(409).send(e.message);
  if (e instanceof IllegalArgumentError) return res.status(403).send(e.message);
  console.error('[admin-ssc history]', e);
  return res.status(500).send('Something went wrong on the server.');
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const run = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    fail(res, e);
  }
};

// ---------------------------------------------------------------- PAGE  (AdminHistoryController)

adminSscHistoryRouter.get('/admin-ssc/history', guard, async (req: Request, res: Response) => {
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
      console.error('admin-ssc history avatar lookup failed:', (e as Error).message);
    }

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/history.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC history page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ---------------------------------------------------------------- VOTE LOGS (campus-scoped)

adminSscHistoryRouter.get(`${API}/vote-logs`, guard, run(async (req, res) => {
  res.json(
    await history.getVoteLogsForAdminSsc(
      sessionCampusId(req),
      {
        search: q(req, 'search'), ballotRef: q(req, 'ballotRef'), program: q(req, 'program'),
        section: q(req, 'section'), year: q(req, 'year'),
      },
      q(req, 'sort') ?? 'time-down',
      pageOf(req),
      wantsAll(req),
    ),
  );
}));

adminSscHistoryRouter.get(`${API}/vote-logs/filter-options`, guard, run(async (req, res) => {
  res.json(await history.getVoteLogFilterOptionsForAdminSsc(sessionCampusId(req)));
}));

// ---------------------------------------------------------------- ACTIONS (own user only)

adminSscHistoryRouter.get(`${API}/actions/filter-options`, guard, run(async (req, res) => {
  res.json(await history.getActionFilterOptionsForUser(sessionUserId(req)));
}));

adminSscHistoryRouter.get(`${API}/actions`, guard, run(async (req, res) => {
  res.json(
    await history.getActionsForAdminSsc(
      sessionUserId(req), q(req, 'search'), q(req, 'role'), q(req, 'action'), pageOf(req), wantsAll(req),
    ),
  );
}));


adminSscHistoryRouter.get(`${API}/actions/:id/details`, guard, run(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).send('Invalid id.');
  res.json(await history.getActionDetails(id, sessionUserId(req)));
}));
// ---------------------------------------------------------------- ARCHIVES (own user only)

adminSscHistoryRouter.get(`${API}/archives`, guard, run(async (req, res) => {
  res.json(await history.getArchivesForAdminDept(sessionUserId(req), q(req, 'search'), q(req, 'type'), pageOf(req)));
}));

adminSscHistoryRouter.get(`${API}/archives/:id/details`, guard, run(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).send('Invalid id.');
  res.json(await history.getArchiveDetailsForAdminDept(id, sessionUserId(req)));
}));

adminSscHistoryRouter.post(`${API}/archives/:id/restore`, guard, run(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).send('Invalid id.');
  await history.restoreArchiveForAdminDept(id, sessionUserId(req), req);
  res.status(204).end();
}));

// ---------------------------------------------------------------- TRASH (own user only)

adminSscHistoryRouter.get(`${API}/trash`, guard, run(async (req, res) => {
  res.json(await history.getTrashForAdminDept(sessionUserId(req), q(req, 'search'), q(req, 'type'), pageOf(req)));
}));

adminSscHistoryRouter.post(`${API}/trash/:id/restore`, guard, run(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).send('Invalid id.');
  await history.restoreTrashForAdminDept(id, sessionUserId(req), req);
  res.status(204).end();
}));

adminSscHistoryRouter.delete(`${API}/trash/:id`, guard, run(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).send('Invalid id.');
  await history.deleteTrashPermanentlyForAdminDept(id, sessionUserId(req), req);
  res.status(204).end();
}));

adminSscHistoryRouter.delete(`${API}/trash`, guard, run(async (req, res) => {
  await history.emptyTrashForAdminDept(sessionUserId(req), req);
  res.status(204).end();
}));