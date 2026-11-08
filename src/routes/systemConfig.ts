import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as cfg from '../systemConfigService';

export const systemConfigRouter = Router();

function fail(res: Response, e: unknown) {
  if (e instanceof IllegalArgumentError || e instanceof IllegalStateError) return res.status(400).send(e.message);
  console.error('System config error:', e);
  return res.status(500).send('Something went wrong on the server.');
}

// read-only lists for dropdowns: superadmin + both admin types
systemConfigRouter.get(
  '/api/config/options',
  requireAny('ROLE_SUPERADMIN', 'ROLE_ADMIN_SSC', 'ROLE_ADMIN_DEPARTMENT'),
  async (_req: Request, res: Response) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await cfg.getOptions());
    } catch (e) {
      fail(res, e);
    }
  },
);

// everything below changes data: superadmin only
systemConfigRouter.use('/superadmin/api/system-config', requireAny('ROLE_SUPERADMIN'));

const BASE = '/superadmin/api/system-config';

systemConfigRouter.post(`${BASE}/campuses`, async (req: Request, res: Response) => {
  try { await cfg.createCampus(req.body, req); res.status(200).end(); } catch (e) { fail(res, e); }
});
systemConfigRouter.put(`${BASE}/campuses/:id`, async (req: Request, res: Response) => {
  try { await cfg.updateCampus(req.params.id, req.body, req); res.status(200).end(); } catch (e) { fail(res, e); }
});
systemConfigRouter.delete(`${BASE}/campuses/:id`, async (req: Request, res: Response) => {
  try { await cfg.deleteCampus(req.params.id, req); res.status(200).end(); } catch (e) { fail(res, e); }
});
systemConfigRouter.put(`${BASE}/campuses/:id/programs`, async (req: Request, res: Response) => {
  try { await cfg.setCampusPrograms(req.params.id, req.body?.customPrograms, req.body?.programIds, req); res.status(200).end(); } catch (e) { fail(res, e); }
});

systemConfigRouter.post(`${BASE}/programs`, async (req: Request, res: Response) => {
  try { await cfg.createProgram(req.body, req); res.status(200).end(); } catch (e) { fail(res, e); }
});
systemConfigRouter.put(`${BASE}/programs/:id`, async (req: Request, res: Response) => {
  try { await cfg.updateProgram(req.params.id, req.body, req); res.status(200).end(); } catch (e) { fail(res, e); }
});
systemConfigRouter.delete(`${BASE}/programs/:id`, async (req: Request, res: Response) => {
  try { await cfg.deleteProgram(req.params.id, req); res.status(200).end(); } catch (e) { fail(res, e); }
});