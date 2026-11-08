import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { renderView } from '../render';
import { clearMustChangePassword } from '../repositories';
import { updatePassword } from '../supabaseAuth';

export const passwordRouter = Router();

const guard = requireAny('ROLE_STUDENT', 'ROLE_CANDIDATE');

function page(req: Request, res: Response, passwordError = '') {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  res.set('Cache-Control', 'no-store');
  res.send(renderView('password-handler.html', { displayName, passwordError }));
}

// GET /voter/password-handler
passwordRouter.get('/voter/password-handler', guard, (req: Request, res: Response) => page(req, res));

// POST /voter/change-password
passwordRouter.post('/voter/change-password', guard, async (req: Request, res: Response) => {
  const user = req.session.user!;
  if (!user.userId) return res.redirect('/login');

  const password = String(req.body?.password ?? '');
  const confirmPassword = String(req.body?.confirmPassword ?? '');

  if (!password.trim() || !confirmPassword.trim()) return page(req, res, 'Please fill out both fields.');
  if (password !== confirmPassword) return page(req, res, 'Passwords do not match.');

  try {
    await updatePassword(user.userId, password);
  } catch (e) {
    console.log('Password update failed:', (e as Error).message);
    return page(req, res, 'Something went wrong. Please try again.');
  }

  let role: string = user.role;
  const dbRole = await clearMustChangePassword(user.userId);
  if (dbRole) {
    user.mustChangePassword = false;
    role = dbRole;
  }
  await new Promise<void>((resolve) => req.session.save(() => resolve()));

  res.redirect(role === 'CANDIDATE' ? '/candidate/personal-information' : '/voter/ssc-election');
});
