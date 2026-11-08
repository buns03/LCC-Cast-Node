import { findBySchoolId } from '../repositories';

export interface ResolvedIdentifier {
  email: string;
  via: 'EMAIL' | 'SCHOOL_ID';
}

/**
 * Contains "@"  -> treated as the email (your existing handler still checks it is registered).
 * Otherwise     -> treated as a School ID and looked up to find the registered email.
 */
export async function resolveForgotIdentifier(raw: unknown): Promise<ResolvedIdentifier | null> {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  if (value.includes('@')) return { email: value, via: 'EMAIL' };

  const profile = await findBySchoolId(value);
  if (!profile || !profile.active || !profile.email) return null;
  return { email: profile.email, via: 'SCHOOL_ID' };
}