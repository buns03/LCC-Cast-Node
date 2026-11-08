import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getAdminDeptAnalytics, getSscAnalyticsForCampus, getSscAnalyticsHistoryForCampus } from '../analyticsService';

export const adminAnalyticsRouter = Router();

/**
 * The ONLY place that reads the session shape (Spring used session attributes "campusId" and "programCourse").
 * NOT VERIFIED: SessionUser (src/types.ts) and routes/login.ts were not shared. If TypeScript says these
 * properties don't exist on SessionUser, that is the signal to send me those two files.
 */
const sessionCampusId = (req: Request): string | null => {
  const v = req.session.user?.campusId;
  return v ? String(v) : null;
};
const sessionProgramCourse = (req: Request): string | null => {
  const v = req.session.user?.programCourse;
  return v ? String(v) : null;
};

const NO_CAMPUS = 'No campus is associated with this account.';

// GET /admin-ssc/api/analytics  (AdminSscAnalyticsApiController.getAnalytics)
adminAnalyticsRouter.get('/admin-ssc/api/analytics', requireAny('ROLE_ADMIN_SSC'), async (req: Request, res: Response) => {
  const campusId = sessionCampusId(req);
  if (!campusId) return res.status(400).json({ success: false, message: NO_CAMPUS });
  try {
    res.json(await getSscAnalyticsForCampus(campusId));
  } catch (e) {
    console.error('Admin SSC analytics error:', e);
    res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
});

// GET /admin-ssc/api/analytics/history  (every school year, newest first)
adminAnalyticsRouter.get('/admin-ssc/api/analytics/history', requireAny('ROLE_ADMIN_SSC'), async (req: Request, res: Response) => {
  const campusId = sessionCampusId(req);
  if (!campusId) return res.status(400).json({ success: false, message: NO_CAMPUS });
  try {
    res.json(await getSscAnalyticsHistoryForCampus(campusId));
  } catch (e) {
    console.error('Admin SSC analytics history error:', e);
    res.status(500).json({ success: false, message: 'Failed to load analytics history.' });
  }
});

// GET /api/admin-dept/analytics  (AdminDeptAnalyticsApiController)
adminAnalyticsRouter.get('/api/admin-dept/analytics', requireAny('ROLE_ADMIN_DEPARTMENT'), async (req: Request, res: Response) => {
  try {
    const campusId = sessionCampusId(req);
    const programCourse = sessionProgramCourse(req);

    // Java returned an empty response for these; getAdminDeptAnalytics(null, null) does exactly that
    if (!campusId || !programCourse || programCourse === 'Supreme Student Council') {
      return res.json(await getAdminDeptAnalytics(null, null));
    }
    res.json(await getAdminDeptAnalytics(campusId, programCourse));
  } catch (e) {
    console.error('Admin dept analytics error:', e);
    res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
});