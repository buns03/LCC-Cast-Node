import session from 'express-session';

/**
 * Session storage (in memory) + "one login per account" registry.
 * Replaces Spring's SessionRegistry + ConcurrentSessionControlAuthenticationStrategy
 * (maximumSessions = 1, block the NEW login).
 *
 * NOTE: memory means everyone is logged out whenever the server restarts.
 * Fine for development. For production we can later swap to a database store.
 */
export const sessionStore = new session.MemoryStore();

const activeByUser = new Map<string, string>(); // userKey -> session id

function readSession(sid: string): Promise<session.SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    sessionStore.get(sid, (err, s) => (err ? reject(err) : resolve(s)));
  });
}

export async function isLoggedInElsewhere(userKey: string, currentSid: string): Promise<boolean> {
  const sid = activeByUser.get(userKey);
  if (!sid || sid === currentSid) return false;

  const s = await readSession(sid);
  if (!s || !s.user) {
    activeByUser.delete(userKey); // that session already died
    return false;
  }
  return true;
}

export function registerSession(userKey: string, sid: string): void {
  activeByUser.set(userKey, sid);
}

export function unregisterSession(userKey: string, sid: string): void {
  if (activeByUser.get(userKey) === sid) activeByUser.delete(userKey);
}
