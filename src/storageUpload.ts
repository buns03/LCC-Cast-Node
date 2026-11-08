import { randomUUID } from 'crypto';
import { config } from './config';
import { IllegalArgumentError } from './errors';

/** Port of SupabaseStorageService.uploadFile: uploads to the bucket and returns ONLY the storage path (never a URL). */

const BUCKET = config.storageBucket;// <-- CHECK: use the same expression your storage route uses (see Step 2 text)

const FOLDERS: Record<string, string> = {
  logo: 'logos',
  poster: 'posters',
  campaign: 'members/campaign',
  background: 'members/background',
  photo: 'members/photo',
  profile: 'profiles',
};

export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export async function uploadFile(file: UploadableFile | undefined, type: string): Promise<string> {
  if (!file || !file.size) throw new IllegalArgumentError('File is required.');

  const folder = FOLDERS[type.toLowerCase()];
  if (!folder) throw new IllegalArgumentError('Invalid file type.');

  const dot = file.originalname ? file.originalname.lastIndexOf('.') : -1;
  const extension = dot >= 0 ? file.originalname.substring(dot) : '';
  const storagePath = `${folder}/${randomUUID()}${extension}`;

  const key = config.supabase.serviceRoleKey;
  const res = await fetch(`${config.supabase.url}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': file.mimetype || 'application/octet-stream',
    },
    body: file.buffer as any,
  });

  if (!res.ok) throw new Error(`Supabase upload failed: ${res.status} ${await res.text()}`);
  return storagePath;
}