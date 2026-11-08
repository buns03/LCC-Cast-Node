import crypto from 'crypto';
import { Request, Response } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { deleteOtp, findLatestOtp, insertOtp, updateOtpAttempts } from '../repositories';
import { sendHtmlMail } from '../mailer';
import { renderView } from '../render';

export const MFA_PURPOSE = 'LOGIN_MFA';
const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const IDLE_DAYS = Number(process.env.MFA_IDLE_DAYS ?? 14);

const hash = (v: string) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('hex');

export const needsMfa = (role: string) => role === 'SUPERADMIN' || role === 'ADMIN';

// one cookie per account, so two admins can share a browser
const cookieName = (authUserId: string) => `lccast_td_${authUserId.replace(/-/g, '')}`;

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setDeviceCookie(res: Response, name: string, token: string) {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: IDLE_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** true = known device used within the idle window. Also refreshes last_used_at + cookie. */
export async function isTrustedDevice(req: Request, res: Response, authUserId: string): Promise<boolean> {
  const name = cookieName(authUserId);
  const token = readCookie(req, name);
  if (!token) return false;
  const { rows } = await pool.query(
    `UPDATE public.trusted_devices SET last_used_at = now()
      WHERE auth_user_id = $1 AND token_hash = $2
        AND last_used_at > now() - make_interval(days => $3::int)
      RETURNING id`,
    [authUserId, hash(token), IDLE_DAYS],
  );
  if (!rows.length) return false;
  setDeviceCookie(res, name, token);
  return true;
}

export async function trustDevice(req: Request, res: Response, authUserId: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.trusted_devices
      WHERE auth_user_id = $1 AND last_used_at < now() - make_interval(days => $2::int)`,
    [authUserId, IDLE_DAYS],
  );
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO public.trusted_devices (auth_user_id, token_hash, user_agent, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [authUserId, hash(token), String(req.headers['user-agent'] ?? '').slice(0, 300), req.ip ?? null],
  );
  setDeviceCookie(res, cookieName(authUserId), token);
}

/** call this after a password reset so old devices must verify again */
export async function revokeTrustedDevices(authUserId: string): Promise<void> {
  await pool.query(`DELETE FROM public.trusted_devices WHERE auth_user_id = $1`, [authUserId]);
}

export async function sendLoginOtp(
  email: string,
  authUserId: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const latest = await findLatestOtp(email, MFA_PURPOSE);
  if (latest) {
    const wait = RESEND_SECONDS - Math.floor((Date.now() - new Date(latest.createdAt).getTime()) / 1000);
    if (wait > 0) return { ok: false, retryAfter: wait };
    await deleteOtp(latest.id);
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await insertOtp({
    authUserId,
    email,
    otpHash: hash(code),
    purpose: MFA_PURPOSE,
    expiresAt: new Date(Date.now() + OTP_MINUTES * 60 * 1000),
  });
  await sendHtmlMail(
    email,
    'Your LCC Cast login code',
    renderView('mfa-email.html', { otpCode: code, expiresMinutes: OTP_MINUTES }),
  );
  return { ok: true };
}

export type MfaCheck = { ok: true } | { ok: false; code: 'MFA_INVALID' | 'MFA_EXPIRED'; message: string };

export async function verifyLoginOtp(email: string, otp: string): Promise<MfaCheck> {
  const expired: MfaCheck = {
    ok: false,
    code: 'MFA_EXPIRED',
    message: 'The code expired or was used too many times. Please log in again.',
  };
  const latest = await findLatestOtp(email, MFA_PURPOSE);
  if (!latest || latest.verifiedAt || new Date(latest.expiresAt).getTime() < Date.now()) return expired;
  if (latest.attempts >= MAX_ATTEMPTS) {
    await deleteOtp(latest.id);
    return expired;
  }
  const a = Buffer.from(hash(otp));
  const b = Buffer.from(latest.otpHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await updateOtpAttempts(latest.id, latest.attempts + 1);
    return { ok: false, code: 'MFA_INVALID', message: 'Invalid verification code.' };
  }
  await deleteOtp(latest.id); // single use
  return { ok: true };
}