import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { getSscAnalyticsForCampus, getSscAnalyticsHistoryForCampus } from '../analyticsService';

export const adminSscAnalyticsRouter = Router();

const guard = requireAny('ROLE_ADMIN_SSC');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Java requireCampusId(): returns the admin's campus uuid, or null (route answers 401) */
function campusIdOf(req: Request): string | null {
  const id = req.session.user?.campusId;
  return id && id.trim() && UUID_RE.test(id) ? id : null;
}

// ===== BLOCK A: PAGE  (AdminAnalyticsController)  -> delete if /admin-ssc/analytics already exists elsewhere =====
adminSscAnalyticsRouter.get('/admin-ssc/analytics', guard, async (req: Request, res: Response) => {
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
      console.error('admin-ssc analytics avatar lookup failed:', (e as Error).message);
    }

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/analytics.html', {
        displayName,
        campus,
        campusId: user.campusId ?? '',
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('SSC analytics page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// ===== BLOCK B: GET /admin-ssc/api/analytics  (latest SSC election of the admin's campus) =====
adminSscAnalyticsRouter.get('/admin-ssc/api/analytics', guard, async (req: Request, res: Response) => {
  const campusId = campusIdOf(req);
  if (!campusId) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await getSscAnalyticsForCampus(campusId));
  } catch (e) {
    console.error('admin-ssc analytics failed:', e);
    return res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
});

// ===== BLOCK C: GET /admin-ssc/api/analytics/history  (every SSC election of the campus, newest first) =====
adminSscAnalyticsRouter.get('/admin-ssc/api/analytics/history', guard, async (req: Request, res: Response) => {
  const campusId = campusIdOf(req);
  if (!campusId) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await getSscAnalyticsHistoryForCampus(campusId));
  } catch (e) {
    console.error('admin-ssc analytics history failed:', e);
    return res.status(500).json({ success: false, message: 'Failed to load analytics history.' });
  }
});