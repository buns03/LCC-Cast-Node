import { Request } from 'express';
import net from 'net';
import { Db } from './electionRepository';
import { notifyActionsChanged } from './historyBroadcaster';

export type AuditAction = 'CREATE' | 'UPDATE' | 'ARCHIVE' | 'DELETE' | 'RESTORE' | 'IMPORT';

const ROLES = new Set(['SUPERADMIN', 'ADMIN', 'CANDIDATE', 'STUDENT']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Port of AuditLogService.getUserName: "First Last" or "Unknown User". */
async function getUserName(db: Db, userId: string | null): Promise<string> {
  if (!userId) return 'Unknown User';
  const { rows } = await db.query(`SELECT first_name, last_name FROM user_profiles WHERE auth_user_id = $1 LIMIT 1`, [userId]);
  if (!rows[0]) return 'Unknown User';
  const full = `${rows[0].first_name ?? ''} ${rows[0].last_name ?? ''}`.trim();
  return full || 'Unknown User';
}

/** Same order as AuditLogService.getClientIp: X-Forwarded-For (first), X-Real-IP, then the socket address. */
function clientIp(req: Request): string | null {
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const forwarded = header('x-forwarded-for');
  let ip = forwarded.trim() ? forwarded.split(',')[0].trim() : header('x-real-ip').trim() || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // Java would throw on an unresolvable value; here an invalid address is simply not stored.
  return net.isIP(ip) ? ip : null;
}

export async function auditLog(
  db: Db,
  req: Request,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  description: string,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  const user = req.session?.user;
  const userId = user?.userId && UUID_RE.test(user.userId) ? user.userId : null;
  const role = user?.role && ROLES.has(user.role) ? user.role : null;
  const userName = await getUserName(db, userId);

  await db.query(
    `INSERT INTO audit_logs (user_id, role, action, entity_type, entity_id, description, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9::jsonb)`,
    [
      userId,
      role,
      action,
      entityType,
      entityId,
      `${userName} ${description}`,
      clientIp(req),
      (req.headers['user-agent'] as string | undefined) ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
    notifyActionsChanged();
}
