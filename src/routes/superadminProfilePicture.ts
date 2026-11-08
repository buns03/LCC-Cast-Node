import { Request, Response, Router } from 'express';
import multer from 'multer';
import { pool } from '../db';
import { authUserIdOf } from '../securitySettingsService';
import { uploadFile } from '../storageUpload';

export const superadminProfilePictureRouter = Router();

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } }).single('file');

// POST /superadmin/settings/profile-picture
superadminProfilePictureRouter.post(
  '/superadmin/settings/profile-picture',
  (req: Request, res: Response, next) => {
    if (req.session.user?.role !== 'SUPERADMIN') return res.status(403).json({ message: 'Not allowed.' });

    receive(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Image must be 5 MB or smaller.' });
      }
      if (err) return res.status(400).json({ message: 'File is required.' });
      next();
    });
  },
  async (req: Request, res: Response) => {
    const authUserId = authUserIdOf(req);
    if (!authUserId) return res.status(401).json({ message: 'Session expired. Please log in again.' });

    const profile = (await pool.query(`SELECT id FROM user_profiles WHERE auth_user_id = $1::uuid LIMIT 1`, [authUserId])).rows[0];
    if (!profile) return res.status(404).json({ message: 'Account not found.' });

    const file = req.file;
    if (!file || !file.size) return res.status(400).json({ message: 'File is required.' });
    if (!file.mimetype || !ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ message: 'Only PNG, JPG, or WEBP images are allowed.' });
    }
    if (file.size > MAX_SIZE) return res.status(400).json({ message: 'Image must be 5 MB or smaller.' });

    try {
      const storagePath = await uploadFile(file, 'profile');
      await pool.query(`UPDATE user_profiles SET profile_picture_url = $2, updated_at = now() WHERE id = $1::uuid`, [profile.id, storagePath]);

      res.json({ message: 'Profile picture updated successfully.', profilePictureUrl: `/files/${storagePath}` });
    } catch (e) {
      console.error('Profile picture upload failed:', e);
      res.status(500).json({ message: 'Failed to upload profile picture.' });
    }
  },
);