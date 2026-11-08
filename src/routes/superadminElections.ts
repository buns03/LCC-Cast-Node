import { Request, Response, Router } from 'express';
import * as service from '../electionService';
import * as emailService from '../electionEmailService';
import { ElectionCategory } from '../electionRepository';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { renderView } from '../render';

/**
 * Superadmin > Elections. Guarded by the /superadmin role check in superadminRouter (mounted first).
 */
export const superadminElectionsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!UUID_RE.test(s)) throw new IllegalArgumentError('Invalid id.');
  return s.toLowerCase();
}

function uuidList(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new IllegalArgumentError('Invalid id list.');
  return value.map((v) => uuid(v)!).filter(Boolean);
}

function instant(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) throw new IllegalArgumentError('Invalid date.');
  return d;
}

function category(value: unknown): ElectionCategory | null {
  if (value === undefined || value === null || value === '') return null;
  if (value !== 'SSC' && value !== 'DEPARTMENT') throw new IllegalArgumentError('Invalid election category.');
  return value;
}

function readInput(body: any): service.ElectionInput {
  return {
    title: typeof body?.title === 'string' ? body.title : null,
    category: category(body?.category),
    campusId: uuid(body?.campusId),
    schoolYear: typeof body?.schoolYear === 'string' ? body.schoolYear : null,
    startAt: instant(body?.startAt),
    endAt: instant(body?.endAt),
    partylistIds: uuidList(body?.partylistIds),
    departmentIds: uuidList(body?.departmentIds),
  };
}

/** Same as the controller's @ExceptionHandlers: bad input -> 400, conflict -> 409. */
function fail(res: Response, e: unknown) {
  if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
  if (e instanceof IllegalStateError) return res.status(409).json({ message: e.message });
  console.error('Elections API error:', e);
  return res.status(500).json({ message: e instanceof Error ? e.message : 'Something went wrong.' });
}

const route = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await handler(req, res);
  } catch (e) {
    fail(res, e);
  }
};

// ---------- page: GET /superadmin/elections ----------
superadminElectionsRouter.get('/superadmin/elections', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }
  try {
    res.send(renderView('superadmin/elections.html', { displayName, html_avatar: avatar }));
  } catch {
    res.status(500).send('views/superadmin/elections.html is missing - copy your converted Elections template there.');
  }
});

// ---------- API ----------
const base = '/superadmin/api/elections';

superadminElectionsRouter.get(base, route(async (req, res) => {
  const campusId = uuid(req.query.campusId);
  const elections = campusId ? await service.getByCampus(campusId) : await service.getAllActive();
  res.json(await Promise.all(elections.map(service.toResponse)));
}));

superadminElectionsRouter.get(`${base}/:id`, route(async (req, res) => {
  res.json(await service.toResponse(await service.getById(uuid(req.params.id)!)));
}));

superadminElectionsRouter.post(base, route(async (req, res) => {
  const createdBy = req.session.user?.userId;
  if (!createdBy) return res.status(401).end();
  const election = await service.createElection(readInput(req.body), createdBy, req);
  res.json(await service.toResponse(election));
}));

superadminElectionsRouter.put(`${base}/:id`, route(async (req, res) => {
  const election = await service.updateElection(uuid(req.params.id)!, readInput(req.body), req);
  res.json(await service.toResponse(election));
}));

superadminElectionsRouter.put(`${base}/:id/archive`, route(async (req, res) => {
  await service.archiveElection(uuid(req.params.id)!, req);
  res.status(200).end();
}));

superadminElectionsRouter.delete(`${base}/:id`, route(async (req, res) => {
  await service.deleteElection(uuid(req.params.id)!, req);
  res.status(200).end();
}));

// NOTE: kept exactly like the Java controller, whose class-level path + this path make this long URL.
superadminElectionsRouter.post(`${base}/superadmin/elections/:id/resync-images`, route(async (req, res) => {
  await service.resyncCandidateImages(uuid(req.params.id)!);
  res.status(200).end();
}));

// ---------- election email dialog ----------
const email = `${base}/:electionId/email`;

superadminElectionsRouter.get(`${email}/status`, route(async (req, res) => {
  res.json(await emailService.getEmailStatus(uuid(req.params.electionId)!));
}));

superadminElectionsRouter.post(`${email}/send`, route(async (req, res) => {
  const adminId = req.session.user?.userId;
  if (!adminId) return res.status(401).end();
  const jobId = typeof req.query.jobId === 'string' && req.query.jobId ? req.query.jobId : null;
  const campaign = await emailService.sendNow(uuid(req.params.electionId)!, adminId, req, jobId);
  res.json({ status: campaign.status, sentAt: campaign.sentAt });
}));

superadminElectionsRouter.get(`${email}/progress/:jobId`, route(async (req, res) => {
  if (!req.session.user?.userId) return res.status(401).end();
  const progress = emailService.progressTracker.get(req.params.jobId);
  if (!progress) return res.status(404).end();
  res.json(progress);
}));

superadminElectionsRouter.post(`${email}/schedule`, route(async (req, res) => {
  const adminId = req.session.user?.userId;
  if (!adminId) return res.status(401).end();
  const campaign = await emailService.schedule(uuid(req.params.electionId)!, instant(req.body?.scheduledAt), adminId, req);
  res.json({ status: campaign.status, scheduledAt: campaign.scheduledAt });
}));

superadminElectionsRouter.delete(`${email}/schedule`, route(async (req, res) => {
  await emailService.cancelScheduled(uuid(req.params.electionId)!, req);
  res.status(200).end();
}));
