import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { getSscLiveResultsForCampus } from '../liveResultsService';

export const adminSscLiveResultsRouter = Router();

// every /admin-ssc/* URL here (pages AND api) is SSC-admin only
adminSscLiveResultsRouter.use('/admin-ssc', requireAny('ROLE_ADMIN_SSC'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Port of AdminLiveResultsController.liveResults
adminSscLiveResultsRouter.get('/admin-ssc/live-results', async (req: Request, res: Response) => {
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
      renderView('admin-ssc/live-results.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC live results page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// Port of AdminSscLiveResultsApiController.getLiveResultsData: campus comes ONLY from the session
adminSscLiveResultsRouter.get('/admin-ssc/live-results/data', async (req: Request, res: Response) => {
  const campusId = req.session.user?.campusId;
  if (!campusId || !UUID_RE.test(campusId)) {
    return res.status(403).json({ success: false, message: 'No campus is associated with this account.' });
  }

  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ ssc: await getSscLiveResultsForCampus(campusId) });
  } catch (e) {
    console.error('SSC live results data error:', e);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});