import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { getElectionDepartmentList, getFullAnalytics } from '../analyticsService';

export const superadminAnalyticsRouter = Router();

// GET /superadmin/analytics  (SuperadminAnalyticsController)
superadminAnalyticsRouter.get('/superadmin/analytics', requireAny('ROLE_SUPERADMIN'), async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;

  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }

  res.send(renderView('superadmin/analytics.html', { displayName, html_avatar: avatar }));
});

// everything under /api/superadmin/analytics is superadmin-only
superadminAnalyticsRouter.use('/api/superadmin/analytics', requireAny('ROLE_SUPERADMIN'));

// GET /api/superadmin/analytics
superadminAnalyticsRouter.get('/api/superadmin/analytics', async (_req: Request, res: Response) => {
  try {
    res.json(await getFullAnalytics());
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
});

// GET /api/superadmin/analytics/departments
superadminAnalyticsRouter.get('/api/superadmin/analytics/departments', async (_req: Request, res: Response) => {
  try {
    res.json(await getElectionDepartmentList());
  } catch (e) {
    console.error('Analytics departments error:', e);
    res.status(500).json({ success: false, message: 'Failed to load departments.' });
  }
});