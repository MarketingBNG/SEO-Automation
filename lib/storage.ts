import path from 'path';
import { promises as fs } from 'fs';
import { put, get, del, list } from '@vercel/blob';

// Self-hosted (Coolify/Docker): when BLOB_READ_WRITE_TOKEN is not set, files live on local disk under
// UPLOADS_DIR (default ./uploads). Mount that folder as a persistent volume so files survive redeploys.
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const DISK_ROOT = () => path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
function diskPath(key: string): string | null {
  const root = DISK_ROOT();
  const p = path.resolve(root, key);
  return p.startsWith(root + path.sep) ? p : null;
}

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
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
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
  if (!blobEnabled()) {
    const p = diskPath(key);
    if (!p) throw new Error('Invalid file key');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Buffer.from(data));
    return key;
  }
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
  if (!blobEnabled()) {
    const p = diskPath(key);
    if (!p) return null;
    try {
      return await fs.readFile(p);
    } catch {
      return null;
    }
  }
  try {
    const res = await get(PREFIX + key, { access: 'private' });
    if (!res || !res.stream) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  } catch {
    // A missing blob is "not found", not a server error.
    return null;
  }
}

export async function fileExists(stored: string | null | undefined): Promise<boolean> {
  return (await readFile(stored)) !== null;
}

export async function deleteFile(stored: string | null | undefined): Promise<void> {
  const key = toKey(stored);
  if (!key) return;
  if (!blobEnabled()) {
    const p = diskPath(key);
    if (p) await fs.unlink(p).catch(() => {});
    return;
  }
  try {
    await del(PREFIX + key);
  } catch {
    // Same as the old fs.unlink(..., () => {}): best effort.
  }
}

// Stored files whose key starts with `prefix` (a folder and the start of a name), with when each was
// saved (ms). For cleanups; at most `max` files.
export async function listFiles(prefix: string, max = 2000): Promise<{ key: string; at: number }[]> {
  const out: { key: string; at: number }[] = [];
  if (!blobEnabled()) {
    const dirRel = path.posix.dirname(prefix);
    const folder = dirRel === '.' ? DISK_ROOT() : diskPath(dirRel);
    if (!folder) return out;
    const start = path.posix.basename(prefix);
    const rel = dirRel === '.' ? '' : `${dirRel}/`;
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.startsWith(start) || out.length >= max) continue;
      const st = await fs.stat(path.join(folder, name)).catch(() => null);
      if (st?.isFile()) out.push({ key: rel + name, at: st.mtimeMs });
    }
    return out;
  }
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX + prefix, cursor, limit: 1000 });
    for (const b of page.blobs) if (out.length < max) out.push({ key: b.pathname.slice(PREFIX.length), at: new Date(b.uploadedAt).getTime() });
    cursor = page.hasMore && out.length < max ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export function basename(stored: string): string {
  return path.basename(String(stored).replace(/\\/g, '/'));
}
