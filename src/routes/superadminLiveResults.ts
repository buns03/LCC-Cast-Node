import { Request, Response, Router } from 'express';
import { getDepartmentLiveResults, getSscLiveResults } from '../liveResultsService';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { renderView } from '../render';

/** Superadmin > Live Results. Guarded by the /superadmin role check in superadminRouter (mounted first). */
export const superadminLiveResultsRouter = Router();

// SuperadminLiveResultsController: GET /superadmin/live-results
superadminLiveResultsRouter.get('/superadmin/live-results', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }
  try {
    res.send(renderView('superadmin/live-results.html', { displayName, html_avatar: avatar }));
  } catch {
    res.status(500).send('views/superadmin/live-results.html is missing.');
  }
});

// SuperadminLiveResultsApiController: GET /superadmin/live-results/data
superadminLiveResultsRouter.get('/superadmin/live-results/data', async (_req: Request, res: Response) => {
  try {
    const [ssc, departments] = await Promise.all([getSscLiveResults(), getDepartmentLiveResults()]);
    res.json({ ssc, departments });
  } catch (e) {
    console.error('Live results error:', e);
    res.status(500).json({ message: 'Failed to load live results.' });
  }
});
