import { Request } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Port of SessionUserUtil.getAuthUserId: returns the logged-in user's auth id
 * (checks "userId" first, then "authUserId"), or null if there is none / it isn't a UUID.
 */
export function getAuthUserId(req: Request): string | null {
  const u = req.session?.user;
  if (!u) return null;
  for (const value of [u.userId, u.authUserId]) {
    if (value && UUID_RE.test(String(value))) return String(value);
  }
  return null;
}
