import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getDashboard } from '../dashboardService';
import { renderView } from '../render';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';

export const superadminRouter = Router();

superadminRouter.use('/superadmin', requireAny('ROLE_SUPERADMIN'));

// GET /superadmin/dashboard
superadminRouter.get('/superadmin/dashboard', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;

  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }

  res.send(renderView('superadmin/dashboard.html', { displayName, html_avatar: avatar }));
});

// GET /superadmin/api/dashboard?campus=all|kaypian|muzon
superadminRouter.get('/superadmin/api/dashboard', async (req: Request, res: Response) => {
  try {
    const campus = typeof req.query.campus === 'string' ? req.query.campus : 'all';
    res.json(await getDashboard(campus));
  } catch (e) {
    console.error('Dashboard error:', e);
    res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
  }
});
