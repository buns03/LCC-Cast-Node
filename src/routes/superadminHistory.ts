import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as history from '../historyService';
import { isUuid } from '../historyRepository';

export const superadminHistoryRouter = Router();

const q = (req: Request, name: string): string | undefined => {
  const v = req.query[name];
  return typeof v === 'string' ? v : undefined;
};
const pageOf = (req: Request) => {
  const n = parseInt(q(req, 'page') ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
};
const idOf = (req: Request): string => {
  const id = req.params.id;
  if (!isUuid(id)) throw new IllegalArgumentError('Invalid id.');
  return id;
};

/** same mapping as the controller's @ExceptionHandlers (404 / 409), plus 400 for bad input */
function fail(res: Response, e: unknown) {
  if (e instanceof history.NotFoundError) return res.status(404).send(e.message);
  if (e instanceof IllegalStateError) return res.status(409).send(e.message);
  if (e instanceof IllegalArgumentError) return res.status(400).send(e.message);
  console.error('History API error:', e);
  return res.status(500).send('Something went wrong on the server.');
}

// GET /superadmin/history  (SuperadminHistoryController)
superadminHistoryRouter.get('/superadmin/history', requireAny('ROLE_SUPERADMIN'), async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;

  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }

  res.send(renderView('superadmin/history.html', { displayName, html_avatar: avatar }));
});

superadminHistoryRouter.use('/superadmin/api/history', requireAny('ROLE_SUPERADMIN'));

// ---------------- vote logs ----------------

superadminHistoryRouter.get('/superadmin/api/history/vote-logs', async (req: Request, res: Response) => {
  try {
    const campusId = q(req, 'campusId');
    if (campusId && !isUuid(campusId)) throw new IllegalArgumentError('Invalid campusId.');

    res.json(
      await history.getVoteLogs(
        {
          search: q(req, 'search'), ballotRef: q(req, 'ballotRef'), program: q(req, 'program'), section: q(req, 'section'),
          year: q(req, 'year'), category: q(req, 'category'), campusId: campusId || undefined,
        },
        q(req, 'sort') ?? 'time-down',
        pageOf(req),
        q(req, 'all')?.toLowerCase() === 'true',
      ),
    );
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.get('/superadmin/api/history/vote-logs/filter-options', async (_req, res) => {
  try {
    res.json(await history.getVoteLogFilterOptions());
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- actions ----------------

superadminHistoryRouter.get('/superadmin/api/history/actions/filter-options', async (_req, res) => {
  try {
    res.json(await history.getActionFilterOptions());
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.get('/superadmin/api/history/actions/:id/details', async (req: Request, res: Response) => {
  try {
    res.json(await history.getActionDetails(idOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.get('/superadmin/api/history/actions', async (req: Request, res: Response) => {
  try {
    res.json(await history.getActions(q(req, 'search'), q(req, 'role'), q(req, 'action'), pageOf(req), q(req, 'all')?.toLowerCase() === 'true'));
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- archives ----------------

superadminHistoryRouter.get('/superadmin/api/history/archives', async (req: Request, res: Response) => {
  try {
    res.json(await history.getArchives(q(req, 'search'), q(req, 'type'), pageOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.get('/superadmin/api/history/archives/:id/details', async (req: Request, res: Response) => {
  try {
    res.json(await history.getArchiveDetails(idOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.post('/superadmin/api/history/archives/:id/restore', async (req: Request, res: Response) => {
  try {
    await history.restoreArchive(idOf(req), req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

// ---------------- trash ----------------

superadminHistoryRouter.get('/superadmin/api/history/trash', async (req: Request, res: Response) => {
  try {
    res.json(await history.getTrash(q(req, 'search'), q(req, 'type'), pageOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.post('/superadmin/api/history/trash/:id/restore', async (req: Request, res: Response) => {
  try {
    await history.restoreTrash(idOf(req), req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.delete('/superadmin/api/history/trash/:id', async (req: Request, res: Response) => {
  try {
    await history.deleteTrashPermanently(idOf(req), req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

superadminHistoryRouter.delete('/superadmin/api/history/trash', async (req: Request, res: Response) => {
  try {
    await history.emptyTrash(req);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});