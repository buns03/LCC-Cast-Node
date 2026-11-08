import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { avatarHtml, profilePictureUrlFor } from '../profilePicture';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import * as admins from '../adminService';
import * as security from '../securitySettingsService';

export const superadminSettingsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(req: Request): string {
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new IllegalArgumentError('Invalid id.');
  return id;
}

/** known errors -> 400 with the message (the page shows it); anything else -> 400 or 500 like the Java controllers */
function fail(res: Response, e: unknown, anyErrorIs400: boolean) {
  if (e instanceof IllegalArgumentError || e instanceof IllegalStateError) return res.status(400).send(e.message);
  console.error('Settings API error:', e);
  if (anyErrorIs400) return res.status(400).send(e instanceof Error ? e.message : 'Request failed.');
  return res.status(500).send('Something went wrong on the server.');
}

// ---------------- page ----------------

// GET /superadmin/settings
superadminSettingsRouter.get('/superadmin/settings', requireAny('ROLE_SUPERADMIN'), async (req: Request, res: Response) => {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;

  let avatar = '';
  try {
    avatar = avatarHtml(await profilePictureUrlFor(req));
  } catch (e) {
    console.error('Could not load profile picture:', (e as Error).message);
  }

  let info = { email: '', pictureUrl: '/images/default-avatar.png' };
  try {
    info = await security.getAccountInfo(req);
  } catch (e) {
    console.error('Could not load account info:', (e as Error).message);
  }

  res.send(renderView('superadmin/settings.html', {
    displayName, html_avatar: avatar, email: info.email, profilePictureUrl: info.pictureUrl,
  }));
});

// ---------------- admin accounts ----------------

superadminSettingsRouter.use('/superadmin/api/admins', requireAny('ROLE_SUPERADMIN'));
superadminSettingsRouter.use('/superadmin/api/security-settings', requireAny('ROLE_SUPERADMIN'));

superadminSettingsRouter.get('/superadmin/api/admins', async (_req: Request, res: Response) => {
  try {
    res.json(await admins.listAdmins());
  } catch (e) {
    fail(res, e, false);
  }
});

superadminSettingsRouter.post('/superadmin/api/admins', async (req: Request, res: Response) => {
  try {
    res.json(await admins.createAdmin(req.body ?? {}));
  } catch (e) {
    fail(res, e, false);
  }
});

superadminSettingsRouter.put('/superadmin/api/admins/:id', async (req: Request, res: Response) => {
  try {
    res.json(await admins.updateAdmin(idOf(req), req.body ?? {}));
  } catch (e) {
    fail(res, e, false);
  }
});

superadminSettingsRouter.patch('/superadmin/api/admins/:id/archive', async (req: Request, res: Response) => {
  try {
    await admins.archiveAdmin(idOf(req), security.authUserIdOf(req));
    res.status(200).end();
  } catch (e) {
    fail(res, e, true);
  }
});

superadminSettingsRouter.delete('/superadmin/api/admins/:id/permanent', async (req: Request, res: Response) => {
  try {
    await admins.permanentlyDeleteAdmin(idOf(req));
    res.status(200).end();
  } catch (e) {
    fail(res, e, true);
  }
});

superadminSettingsRouter.delete('/superadmin/api/admins/:id', async (req: Request, res: Response) => {
  try {
    await admins.deleteAdmin(idOf(req), security.authUserIdOf(req));
    res.status(200).end();
  } catch (e) {
    fail(res, e, true);
  }
});

superadminSettingsRouter.patch('/superadmin/api/admins/:id/restore', async (req: Request, res: Response) => {
  try {
    await admins.restoreAdmin(idOf(req));
    res.status(200).end();
  } catch (e) {
    fail(res, e, true);
  }
});

// ---------------- security (own password / email) ----------------

superadminSettingsRouter.put('/superadmin/api/security-settings/password', async (req: Request, res: Response) => {
  try {
    await security.changePassword(security.authUserIdOf(req), req.body?.currentPassword, req.body?.newPassword);
    res.status(200).end();
  } catch (e) {
    fail(res, e, false);
  }
});

superadminSettingsRouter.put('/superadmin/api/security-settings/email', async (req: Request, res: Response) => {
  try {
    const email = await security.changeEmail(security.authUserIdOf(req), req.body?.newEmail);
    const user = req.session.user as unknown as Record<string, unknown> | undefined;
    if (user) user.email = email; // Java: session.setAttribute("email", email)
    res.json({ email });
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).send(e.message);
    console.error('Change email error:', e);
    res.status(400).send('Could not update email. It may already be in use.');
  }
});