import { SessionUser } from '../types';
import { authoritiesOf } from './authorities';

/**
 * Port of LandingPageResolver.resolve().
 * Used for "access denied" and unknown-URL redirects (like SecurityConfig + AppErrorController).
 */
export function landingFor(user?: SessionUser | null): string {
  if (!user) return '/login';
  const roles = new Set(authoritiesOf(user));

  if (roles.has('ROLE_SUPERADMIN')) return '/superadmin/dashboard';
  if (roles.has('ROLE_ADMIN_SSC')) return '/admin-ssc/dashboard';
  if (roles.has('ROLE_ADMIN_DEPARTMENT')) return '/admin-dept/dashboard';
  if (roles.has('ROLE_CANDIDATE')) return '/candidate/personal-information';
  if (roles.has('ROLE_STUDENT')) return '/voter/ssc-election';
  return '/login';
}

/**
 * Port of the switch inside LoginController (GET /login and POST /login).
 * NOTE: this is intentionally NOT the same as landingFor(): for an ADMIN whose
 * admin_type is neither DEPARTMENT nor SSC, the controller sends them to /admin-ssc.
 */
export function loginRedirectFor(user: SessionUser): string {
  switch (user.role) {
    case 'SUPERADMIN':
      return '/superadmin/dashboard';
    case 'ADMIN':
      return user.adminType === 'DEPARTMENT' ? '/admin-dept/dashboard' : '/admin-ssc/dashboard';
    case 'STUDENT':
      return '/voter/ssc-election';
    case 'CANDIDATE':
      return '/candidate/personal-information';
    default:
      return '/login';
  }
}
