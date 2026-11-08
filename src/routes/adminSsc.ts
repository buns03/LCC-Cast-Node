import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { getDashboardForAdminSsc } from '../adminSscDashboardService';

export const adminSscRouter = Router();

const guard = requireAny('ROLE_ADMIN_SSC');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// GET /admin-ssc/dashboard  (AdminDashboardController)
adminSscRouter.get('/admin-ssc/dashboard', guard, async (req: Request, res: Response) => {
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
      console.error('admin-ssc avatar lookup failed:', (e as Error).message);
    }

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/dashboard.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC dashboard page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// GET /admin-ssc/api/dashboard  (AdminSscDashboardApiController)
adminSscRouter.get('/admin-ssc/api/dashboard', guard, async (req: Request, res: Response) => {
  const campusId = req.session.user?.campusId;

  if (!campusId || !campusId.trim()) {
    return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }
  if (!UUID_RE.test(campusId)) {
    return res.status(401).json({ success: false, message: 'Invalid session campusId.' });
  }

  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await getDashboardForAdminSsc(campusId));
  } catch (e) {
    console.error('admin-ssc dashboard failed:', e);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
  }
});