import { SessionUser } from '../types';

/** Same authorities CustomUserDetails.getAuthorities() built in Java. */
export function authoritiesOf(user: SessionUser): string[] {
  const list = [`ROLE_${user.role}`];
  if (user.role === 'ADMIN' && user.adminType) list.push(`ROLE_ADMIN_${user.adminType}`);
  return list;
}
