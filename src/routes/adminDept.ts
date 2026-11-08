import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { getDashboardForAdminDept } from '../adminDeptDashboardService';

export const adminDeptRouter = Router();

// every /admin-dept/* URL (pages AND api) is Department-Admin only
adminDeptRouter.use('/admin-dept', requireAny('ROLE_ADMIN_DEPARTMENT'));

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Port of AdminDeptDashboardController.dashboard
adminDeptRouter.get('/admin-dept/dashboard', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;

    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    // Java: profilePictureUrl = "/files/" + profile.getProfilePictureUrl()
    const picture = await findProfilePictureUrl(user.authUserId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-dept/dashboard.html', {
        displayName,
        campus,
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
        adminCampusId: user.campusId ?? '',
        adminDepartmentCode: programCourse,// <-- waiting on question 1, don't fill in yet
      }),
    );
  } catch (e) {
    console.error('Dashboard page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// Port of AdminDeptAnalyticsController.analytics
adminDeptRouter.get('/admin-dept/analytics', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;

    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    const picture = await findProfilePictureUrl(user.authUserId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-dept/analytics.html', {
        displayName,
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('Analytics page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// Port of AdminDeptHistoryController.history
adminDeptRouter.get('/admin-dept/history', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;

    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    const picture = await findProfilePictureUrl(user.authUserId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-dept/history.html', {
        displayName,
        programCampus: `${programCourse} - ${campus}`,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('History page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// Port of AdminDeptDashboardApiController: scope comes ONLY from the session, never from the client
adminDeptRouter.get('/admin-dept/api/dashboard', async (req: Request, res: Response) => {
  const user = req.session.user!;
  const campusId = user.campusId;
  const program = user.programCourse;

  // Java threw IllegalStateException here; a 403 JSON is clearer in Node
  if (!campusId || !program || !program.trim()) {
    return res.status(403).json({ success: false, message: 'Missing campusId/programCourse in session - admin-dept not scoped.' });
  }

  try {
    return res.json(await getDashboardForAdminDept(campusId, program));
  } catch (e) {
    console.error('Admin-dept dashboard error:', e);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});