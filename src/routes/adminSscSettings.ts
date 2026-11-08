import { Request, Response, Router } from 'express';
import multer from 'multer';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { renderView } from '../render';
import { avatarHtml } from '../profilePicture';
import { findSettingsProfile, updateProfileEmail, updateProfilePicture } from '../repositories';
import { supabaseLogin, updateEmail, updatePassword } from '../supabaseAuth';
import { uploadFile } from '../storageUpload';
import { IllegalArgumentError } from '../errors';

export const adminSscSettingsRouter = Router();

const guard = requireAny('ROLE_ADMIN_SSC');

// GET /admin-ssc/settings  (AdminSscSettingsController.settings)
adminSscSettingsRouter.get('/admin-ssc/settings', guard, async (req: Request, res: Response) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const campus = user.campus ?? '';
    const programCourse = user.programCourse ?? '';

    const authUserId = getAuthUserId(req);
    const profile = authUserId ? await findSettingsProfile(authUserId) : null;
    const pictureUrl = profile?.profilePicture ? `/files/${profile.profilePicture}` : null;

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('admin-ssc/settings.html', {
        displayName,
        programCampus: `${programCourse} - ${campus}`,
        html_avatar: avatarHtml(pictureUrl),
        pictureSrc: pictureUrl ?? '/images/default-avatar.png',
        email: profile?.email ?? '',
      }),
    );
  } catch (e) {
    console.error('Admin-ssc settings page error:', e);
    res.status(500).send('Something went wrong.');
  }
});

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

// POST /admin-ssc/settings  (AdminSscSettingsController.updateSettings): email and/or password
adminSscSettingsRouter.post('/admin-ssc/settings', guard, async (req: Request, res: Response) => {
  const authUserId = getAuthUserId(req);
  if (!authUserId) return res.status(401).json({ message: 'Session expired. Please log in again.' });

  try {
    const profile = await findSettingsProfile(authUserId);
    if (!profile) return res.status(404).json({ message: 'Admin account not found.' });

    const newEmail = text(req.body?.newEmail).trim();
    const currentPassword = text(req.body?.currentPassword);
    const newPassword = text(req.body?.newPassword);
    const confirmPassword = text(req.body?.confirmPassword);

    // blank = NO CHANGE
    const wantsEmailChange = newEmail !== '';
    const wantsPasswordChange = newPassword.trim() !== '';

    if (!wantsEmailChange && !wantsPasswordChange) {
      return res.json({ message: 'Settings saved successfully.' });
    }

    // current password is required ONLY for a password change
    if (wantsPasswordChange) {
      if (!currentPassword.trim()) {
        return res.status(400).json({ message: 'Current password is required to change your password.' });
      }
      if (confirmPassword !== newPassword) {
        return res.status(400).json({ message: 'New password and confirmation do not match.' });
      }

      const verified = profile.email ? await supabaseLogin(profile.email, currentPassword) : null;
      if (!verified || !verified.user) {
        return res.status(403).json({ message: 'Current password is incorrect.' });
      }
    }

    if (wantsEmailChange) {
      try {
        await updateEmail(authUserId, newEmail);
      } catch (e) {
        console.error('Supabase updateEmail failed:', (e as Error).message);
        return res.status(400).json({ message: 'Could not update your email. It may already be in use by another account.' });
      }
      await updateProfileEmail(authUserId, newEmail);
    }

    if (wantsPasswordChange) {
      await updatePassword(authUserId, newPassword);
    }

    return res.json({ message: 'Settings updated successfully.' });
  } catch (e) {
    console.error('Admin-ssc settings update error:', e);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// POST /admin-ssc/settings/profile-picture  (AdminSscSettingsController.uploadProfilePicture)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } }).single('file');

adminSscSettingsRouter.post(
  '/admin-ssc/settings/profile-picture',
  guard,
  (req: Request, res: Response, next) => {
    receive(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Image must be 5 MB or smaller.' });
      }
      if (err) return res.status(400).json({ message: 'File is required.' });
      next();
    });
  },
  async (req: Request, res: Response) => {
    const authUserId = getAuthUserId(req);
    if (!authUserId) return res.status(401).json({ message: 'Session expired. Please log in again.' });

    try {
      const profile = await findSettingsProfile(authUserId);
      if (!profile) return res.status(404).json({ message: 'Admin account not found.' });

      const file = req.file;
      if (!file || !file.size) return res.status(400).json({ message: 'File is required.' });
      if (!file.mimetype || !ALLOWED_TYPES.includes(file.mimetype)) {
        return res.status(400).json({ message: 'Only PNG, JPG, or WEBP images are allowed.' });
      }

      const storagePath = await uploadFile(file, 'profile');
      await updateProfilePicture(authUserId, storagePath);

      return res.json({ message: 'Profile picture updated successfully.', profilePictureUrl: `/files/${storagePath}` });
    } catch (e) {
      if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
      console.error('Profile picture upload failed:', e);
      return res.status(500).json({ message: 'Failed to upload profile picture.' });
    }
  },
);