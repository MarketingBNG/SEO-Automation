import { readFile, mimeFor, toKey } from '@/lib/storage';
import prisma from '@/lib/prisma';
import { getMe } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  const parts = file || [];
  const key = parts.join('/');
  // Split again after joining (a decoded %2F inside a part is a separator too): an empty, '.' or '..'
  // segment is refused, so a key like assistant/./docs/... cannot get past the owner check below.
  if (!key || key.split(/[\\/]/).some((p) => !p || p === '.' || p === '..')) return new Response('Not found', { status: 404 });
  // readFile normalises the key (backslashes, anything up to a '/uploads/' inside it): a key that
  // normalising would change is refused, so the owner check below sees the key that is read.
  if (toKey(key) !== key) return new Response('Not found', { status: 404 });

  // Documents attached in an assistant chat are private like the chat: the uploader or the admin.
  if (key.startsWith('assistant/docs/')) {
    const me = await getMe();
    const own = me && (me.role === 'admin' || (await prisma.assistant_files.count({ where: { path: key, uploaded_by: { in: [me.name, me.email].filter(Boolean) } } })) > 0);
    if (!own) return new Response('Not found', { status: 404 });
  }

  const data = await readFile(key);
  if (!data) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(data), { headers: { 'Content-Type': mimeFor(key) } });
}
