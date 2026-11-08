import { NextFunction, Request, Response } from 'express';
import { landingFor } from './landing';
import { authoritiesOf } from './authorities';

/** Replaces .requestMatchers(...).hasRole()/hasAnyRole()/hasAuthority() */
export function requireAny(...needed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;

    if (!user) {
      if (req.originalUrl.includes("/api/")) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
      }
      return res.redirect('/login');
    }

    if (needed.length === 0 || needed.some((n) => authoritiesOf(user).includes(n))) {
      return next();
    }

    // access denied -> send them to their own landing page (like Spring did)
    const dest = landingFor(user);
    if (dest === req.originalUrl.split('?')[0]) {
      return res.status(403).send('Forbidden');
    }
    return res.redirect(dest);
  };
}
