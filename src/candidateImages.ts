import { Db } from './electionRepository';

export interface ExistingImages {
  photoImageUrl: string | null;
  backgroundImageUrl: string | null;
  campaignImageUrl: string | null;
}

const ANY = '(photo_image_url IS NOT NULL OR background_image_url IS NOT NULL OR campaign_image_url IS NOT NULL)';
const COLS = 'photo_image_url, background_image_url, campaign_image_url';
const toImages = (r: any): ExistingImages => ({ photoImageUrl: r.photo_image_url, backgroundImageUrl: r.background_image_url, campaignImageUrl: r.campaign_image_url });

/**
 * Port of CandidatePortalService.findExistingImages: when a member row is created without images, reuse the
 * images the same student already has for the SAME kind of candidacy (SSC never seeds Department, and vice versa).
 */
export async function findExistingImages(db: Db, studentId: string, type: 'SSC' | 'DEPARTMENT'): Promise<ExistingImages | null> {
  if (!studentId || !studentId.trim()) return null;
  const memberTable = type === 'SSC' ? 'partylist_members' : 'department_members';
  const groupColumn = type === 'SSC' ? 'partylist_id' : 'department_id';

  const member = await db.query(`SELECT ${COLS} FROM ${memberTable} WHERE student_id = $1 AND ${ANY} LIMIT 1`, [studentId]);
  if (member.rows[0]) return toImages(member.rows[0]);

  const cand = await db.query(`SELECT ${COLS} FROM candidates WHERE student_id = $1 AND ${groupColumn} IS NOT NULL AND ${ANY} LIMIT 1`, [studentId]);
  return cand.rows[0] ? toImages(cand.rows[0]) : null;
}
