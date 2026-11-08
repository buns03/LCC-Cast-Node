import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as svc from '../adminSscElectionService';
import * as emailService from '../electionEmailService'; // <-- confirm this filename (see "What I need")

export const adminSscElectionsRouter = Router();

// every /admin-ssc/* URL here (pages AND api) is SSC-admin only
adminSscElectionsRouter.use('/admin-ssc', requireAny('ROLE_ADMIN_SSC'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// :id must be a UUID (a bad id would otherwise crash the SQL cast and return 500)
adminSscElectionsRouter.param('id', (_req, res, next, id) => {
  if (UUID_RE.test(id)) return next();
  return res.status(400).json({ success: false, message: 'Invalid election ID.' });
});

// ---------------- helpers ----------------

function sessionCampusId(req: Request): string {
  const id = req.session.user?.campusId;
  if (!id || !UUID_RE.test(id)) throw new svc.ForbiddenError('No campus is associated with this account.');
  return id;
}

function sessionUserId(req: Request): string {
  const u = req.session.user;
  const id = u?.authUserId ?? u?.userId;
  if (!id) throw new svc.ForbiddenError('Not authenticated.');
  return id;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  if (Number.isNaN(d.getTime())) throw new IllegalArgumentError('Invalid date value.');
  return d;
}

function parsePayload(body: any): svc.SscElectionPayload {
  const b = body ?? {};
  let partylistIds: string[] | null = null;
  if (Array.isArray(b.partylistIds)) {
    const ids = b.partylistIds.map((x: unknown) => String(x));
    if (ids.some((x: string) => !UUID_RE.test(x))) throw new IllegalArgumentError('Invalid partylist ID.');
    partylistIds = [...new Set<string>(ids)];
  }
  return {
    title: typeof b.title === 'string' ? b.title : null,
    schoolYear: typeof b.schoolYear === 'string' ? b.schoolYear : null,
    startAt: toDate(b.startAt),
    endAt: toDate(b.endAt),
    partylistIds,
  };
}

function fail(res: Response, e: unknown, label: string) {
  if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
  if (e instanceof IllegalStateError) return res.status(409).json({ message: e.message });
  if (e instanceof svc.ForbiddenError) return res.status(403).json({ message: e.message });
  if (e instanceof svc.NotFoundError) return res.status(404).json({ message: e.message });
  console.error(`admin-ssc elections: ${label} failed:`, e);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
}

// ---------------- PAGE: AdminElectionController.elections ----------------

adminSscElectionsRouter.get('/admin-ssc/elections', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    const picture = await findProfilePictureUrl(user.authUserId ?? user.userId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/elections.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC elections page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ---------------- API: AdminSscElectionApiController ----------------

adminSscElectionsRouter.get('/admin-ssc/api/elections', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await svc.listForCampus(sessionCampusId(req)));
  } catch (e) { fail(res, e, 'list'); }
});

adminSscElectionsRouter.get('/admin-ssc/api/elections/:id', async (req, res) => {
  try {
    res.json(await svc.getForCampus(req.params.id, sessionCampusId(req)));
  } catch (e) { fail(res, e, 'get'); }
});

adminSscElectionsRouter.post('/admin-ssc/api/elections', async (req, res) => {
  try {
    res.json(await svc.create(parsePayload(req.body), sessionCampusId(req), sessionUserId(req), req));
  } catch (e) { fail(res, e, 'create'); }
});

adminSscElectionsRouter.put('/admin-ssc/api/elections/:id', async (req, res) => {
  try {
    res.json(await svc.update(req.params.id, parsePayload(req.body), sessionCampusId(req), req));
  } catch (e) { fail(res, e, 'update'); }
});

adminSscElectionsRouter.put('/admin-ssc/api/elections/:id/archive', async (req, res) => {
  try {
    await svc.archive(req.params.id, sessionCampusId(req), req);
    res.status(200).end();
  } catch (e) { fail(res, e, 'archive'); }
});

adminSscElectionsRouter.delete('/admin-ssc/api/elections/:id', async (req, res) => {
  try {
    await svc.remove(req.params.id, sessionCampusId(req), req);
    res.status(200).end();
  } catch (e) { fail(res, e, 'delete'); }
});

// ---------------- API: AdminSscElectionEmailApiController ----------------
// every email action first confirms the election belongs to this admin's campus

adminSscElectionsRouter.get('/admin-ssc/api/elections/:id/email/status', async (req, res) => {
  try {
    await svc.assertOwned(req.params.id, sessionCampusId(req));
    res.json(await emailService.getEmailStatus(req.params.id));
  } catch (e) { fail(res, e, 'email status'); }
});

adminSscElectionsRouter.post('/admin-ssc/api/elections/:id/email/send', async (req, res) => {
  try {
    await svc.assertOwned(req.params.id, sessionCampusId(req));
    const jobId = typeof req.query.jobId === 'string' && req.query.jobId ? req.query.jobId : null;
    const campaign = await emailService.sendNow(req.params.id, sessionUserId(req), req, jobId);
    res.json({ status: campaign.status, sentAt: campaign.sentAt });
  } catch (e) { fail(res, e, 'email send'); }
});

adminSscElectionsRouter.get('/admin-ssc/api/elections/:id/email/progress/:jobId', async (req, res) => {
  try {
    await svc.assertOwned(req.params.id, sessionCampusId(req));
    const progress = emailService.progressTracker.get(req.params.jobId);
    if (!progress) return res.status(404).end();
    return res.json(progress);
  } catch (e) { return fail(res, e, 'email progress'); }
});

adminSscElectionsRouter.post('/admin-ssc/api/elections/:id/email/schedule', async (req, res) => {
  try {
    await svc.assertOwned(req.params.id, sessionCampusId(req));
    const campaign = await emailService.schedule(req.params.id, toDate(req.body?.scheduledAt), sessionUserId(req), req);
    res.json({ status: campaign.status, scheduledAt: campaign.scheduledAt });
  } catch (e) { fail(res, e, 'email schedule'); }
});

adminSscElectionsRouter.delete('/admin-ssc/api/elections/:id/email/schedule', async (req, res) => {
  try {
    await svc.assertOwned(req.params.id, sessionCampusId(req));
    await emailService.cancelScheduled(req.params.id, req);
    res.status(200).end();
  } catch (e) { fail(res, e, 'email cancel'); }
});