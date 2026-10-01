import path from 'path';
import { put, get, del } from '@vercel/blob';

// Replaces the local uploads/ folder (Vercel has no persistent disk). Files are private blobs under
// the same relative keys the old folder used: 'photo.jpg' (featured images) and
// 'assistant/123-name.png' (assistant uploads). DB columns store that relative key, and the
// existing /api/uploads/<key> URL keeps serving it.

const PREFIX = 'uploads/';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function mimeFor(key: string): string {
  return MIME[path.extname(key).toLowerCase()] || 'application/octet-stream';
}

// Normalise a stored value to a relative key. Also accepts legacy absolute Windows/Unix paths from
// the old SQLite data (e.g. C:\...\uploads\assistant\x.png -> assistant/x.png).
export function toKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const s = String(stored).replace(/\\/g, '/');
  const i = s.lastIndexOf('/uploads/');
  const rel = i >= 0 ? s.slice(i + '/uploads/'.length) : s.replace(/^\/+/, '');
  if (!rel || rel.split('/').some((p) => p === '..')) return null;
  return rel;
}

export async function saveFile(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<string> {
  await put(PREFIX + key, Buffer.from(data), {
    access: 'private',
    contentType: contentType || mimeFor(key),
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return key;
}

export async function readFile(stored: string | null | undefined): Promise<Buffer | null> {
  const key = toKey(stored);
  if (!key) return null;
  const res = await get(PREFIX + key, { access: 'private' });
  if (!res || !res.stream) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

export async function fileExists(stored: string | null | undefined): Promise<boolean> {
  return (await readFile(stored)) !== null;
}

export async function deleteFile(stored: string | null | undefined): Promise<void> {
  const key = toKey(stored);
  if (!key) return;
  try {
    await del(PREFIX + key);
  } catch {
    // Same as the old fs.unlink(..., () => {}): best effort.
  }
}

export function basename(stored: string): string {
  return path.basename(String(stored).replace(/\\/g, '/'));
}
