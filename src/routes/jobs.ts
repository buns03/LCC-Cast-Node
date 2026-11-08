import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { activeFor, dismissJob, findJob } from '../jobs';

export const jobsRouter = Router();

// any logged-in user (requireAny() with no roles); not logged in -> 401 JSON because the URL contains /api/
jobsRouter.use('/api/jobs', requireAny());

// GET /api/jobs/active
jobsRouter.get('/api/jobs/active', (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const userId = getAuthUserId(req);
  if (!userId) return res.json([]);
  res.json(activeFor(userId).map((j) => j.toMap()));
});

// GET /api/jobs/:id/download
jobsRouter.get('/api/jobs/:id/download', (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const job = userId ? findJob(String(req.params.id), userId) : null;
  if (!job || !job.resultFile) return res.status(404).end();

  res.download(job.resultFile, job.resultName ?? 'download.csv', (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// DELETE /api/jobs/:id  (dismiss)
jobsRouter.delete('/api/jobs/:id', (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const job = userId ? findJob(String(req.params.id), userId) : null;
  if (job) dismissJob(job);
  res.status(204).end();
});