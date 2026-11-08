import { config } from './config';
import { randomUUID } from 'crypto';
import { IllegalArgumentError } from './errors';

/** Port of SupabaseStorageService (download / signed URL parts). Uses the service-role key. */

const headers = () => ({
  Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
  apikey: config.supabase.serviceRoleKey,
});

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Accepts a plain storage path OR any Supabase storage URL and returns just the path inside the bucket. */
export function normalizeStoragePath(input: string): string {
  let value = input.trim();
  const bucketPrefix = `${config.storageBucket}/`;

  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    return value.startsWith(bucketPrefix) ? value.slice(bucketPrefix.length) : value;
  }

  const marker = '/storage/v1/object/';
  const index = value.indexOf(marker);
  if (index < 0) throw new IllegalArgumentError('Invalid Supabase storage URL.');

  let path = value.slice(index + marker.length);
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);

  for (const prefix of ['sign/', 'public/', 'authenticated/']) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  if (path.startsWith(bucketPrefix)) path = path.slice(bucketPrefix.length);
  return path;
}

function guessContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export interface DownloadResult {
  status: number;
  contentType?: string;
  body?: Buffer;
}

/** Port of downloadFile / getFile (what /api/storage/file returns). */
export async function downloadFile(storagePath: string): Promise<DownloadResult> {
  if (!storagePath || !storagePath.trim()) return { status: 404 };

  const path = normalizeStoragePath(storagePath);
  // extra safety (not in Java): never let "../" climb out of the bucket
  if (path.split('/').some((seg) => seg === '..')) throw new IllegalArgumentError('Invalid file path.');

  try {
    const res = await fetch(`${config.supabase.url}/storage/v1/object/${config.storageBucket}/${encodePath(path)}`, {
      headers: headers(),
    });

    if (res.status === 404) {
      console.error('SUPABASE FILE NOT FOUND:', path);
      return { status: 404 };
    }
    if (!res.ok) {
      console.error(`SUPABASE STORAGE ERROR [${res.status}] PATH: ${path}`);
      return { status: res.status };
    }

    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? guessContentType(path),
      body: Buffer.from(await res.arrayBuffer()),
    };
  } catch (e) {
    console.error('SUPABASE DOWNLOAD FAILED:', (e as Error).message);
    return { status: 500 };
  }
}

/** Port of createSignedUrl: a temporary link (used for photos inside emails). Returns null on failure. */
export async function createSignedUrl(storagePath: string | null, expiresInSeconds: number): Promise<string | null> {
  if (!storagePath || !storagePath.trim()) return null;
  const path = normalizeStoragePath(storagePath);

  try {
    const res = await fetch(`${config.supabase.url}/storage/v1/object/sign/${config.storageBucket}/${encodePath(path)}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { signedURL?: string };
    if (!body.signedURL) return null;
    return `${config.supabase.url}/storage/v1${body.signedURL}`;
  } catch (e) {
    console.error(`SUPABASE SIGN URL ERROR path=${path} msg=${(e as Error).message}`);
    return null;
  }
}

const UPLOAD_FOLDERS: Record<string, string> = {
  logo: 'logos', poster: 'posters', campaign: 'members/campaign', background: 'members/background',
  photo: 'members/photo', profile: 'profiles',
};

/** Port of SupabaseStorageService.uploadFile: returns ONLY the storage path (never a URL). */
export async function uploadFile(
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  type: string,
): Promise<string> {
  if (!file || !file.size) throw new IllegalArgumentError('File is required.');

  const folder = UPLOAD_FOLDERS[(type ?? '').toLowerCase()];
  if (!folder) throw new IllegalArgumentError('Invalid file type.');

  const dot = file.originalname.lastIndexOf('.');
  const storagePath = `${folder}/${randomUUID()}${dot >= 0 ? file.originalname.slice(dot) : ''}`;

  const res = await fetch(`${config.supabase.url}/storage/v1/object/${config.storageBucket}/${encodePath(storagePath)}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': file.mimetype || 'application/octet-stream' },
    body: new Uint8Array(file.buffer),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  return storagePath;
}
