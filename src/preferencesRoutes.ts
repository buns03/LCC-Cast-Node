import { Router } from 'express';
import { pool } from './db';
import { requireAny } from './auth/guards';
import { authUserIdOf } from './securitySettingsService';

export const preferencesRouter = Router();

const MODES = ['light', 'dark', 'system'];
const HEX = /^#[0-9a-f]{6}$/i;

preferencesRouter.get('/api/preferences', requireAny(), async (req, res) => {
  try {
    const id = authUserIdOf(req);
    if (!id) return res.json({ themeMode: 'system', accentColor: null });
    const { rows } = await pool.query(
      `SELECT theme_mode, accent_color FROM public.user_preferences WHERE auth_user_id = $1::uuid`, [id]);
    res.json({ themeMode: rows[0]?.theme_mode ?? 'system', accentColor: rows[0]?.accent_color ?? null });
  } catch (e) {
    console.error('[preferences] load failed', e);
    res.status(500).json({ success: false, message: 'Could not load preferences.' });
  }
});

preferencesRouter.put('/api/preferences', requireAny(), async (req, res) => {
  try {
    const id = authUserIdOf(req);
    if (!id) return res.status(401).json({ success: false, message: 'Not logged in.' });

    const mode = req.body?.themeMode;
    const accent = req.body?.accentColor ?? null;
    if (!MODES.includes(mode)) return res.status(400).json({ success: false, message: 'Invalid theme mode.' });
    if (accent !== null && !HEX.test(accent)) return res.status(400).json({ success: false, message: 'Invalid color.' });

    await pool.query(
      `INSERT INTO public.user_preferences (auth_user_id, theme_mode, accent_color, updated_at)
       VALUES ($1::uuid, $2, $3, now())
       ON CONFLICT (auth_user_id)
       DO UPDATE SET theme_mode = EXCLUDED.theme_mode, accent_color = EXCLUDED.accent_color, updated_at = now()`,
      [id, mode, accent ? accent.toUpperCase() : null]);

    res.json({ success: true });
  } catch (e) {
    console.error('[preferences] save failed', e);
    res.status(500).json({ success: false, message: 'Could not save preferences.' });
  }
});