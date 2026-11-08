import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { findProfilePictureUrl } from '../repositories';
import { getDepartmentLiveResultsForAdmin, resolveDepartmentId } from '../adminDeptLiveResultsService';

export const adminDeptLiveResultsRouter = Router();

adminDeptLiveResultsRouter.use('/admin-dept/live-results', requireAny('ROLE_ADMIN_DEPARTMENT'));

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Port of AdminDeptLiveResultsController.liveResults
adminDeptLiveResultsRouter.get('/admin-dept/live-results', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const campusId = user.campusId ?? '';
    const programCourse = user.programCourse ?? '';

    const departmentId = (await resolveDepartmentId(user.campusId, user.programCourse)) ?? '';

    const picture = await findProfilePictureUrl(user.authUserId);
    const html_avatar = picture
      ? `<img src="${attr('/files/' + picture)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
      : '';

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-dept/live-results.html', {
        displayName,
        programCampus: `${programCourse} - ${campus}`,
        programCourse,
        campus,
        campusId,
        departmentId,
        html_avatar,
      }),
    );
  } catch (e) {
    console.error('Live results page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

// Port of AdminDeptLiveResultsApiController.getLiveResultsData: scope comes ONLY from the session
adminDeptLiveResultsRouter.get('/admin-dept/live-results/data', async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const departmentId = await resolveDepartmentId(user.campusId, user.programCourse);
    res.set('Cache-Control', 'no-store');
    return res.json({ departments: await getDepartmentLiveResultsForAdmin(user.campusId, departmentId) });
  } catch (e) {
    console.error('Live results data error:', e);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});