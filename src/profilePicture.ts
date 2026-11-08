import { Request } from 'express';
import { getAuthUserId } from './auth/sessionUser';
import { findProfilePictureUrl } from './repositories';

/**
 * Port of ProfilePictureInterceptor: the page gets "/files/" + user_profiles.profile_picture_url.
 * Returns null when there is no logged-in user or no picture.
 */
export async function profilePictureUrlFor(req: Request): Promise<string | null> {
  const authUserId = getAuthUserId(req);
  if (!authUserId) return null;
  const path = await findProfilePictureUrl(authUserId);
  return path ? `/files/${path}` : null;
}

/** The <img> the dashboard puts inside .avatar (hides itself if the file cannot load). */
export function avatarHtml(url: string | null): string {
  if (!url) return '';
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<img src="${safe}" alt="Avatar" onerror="this.remove()" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
}
