import { readFile, mimeFor } from '@/lib/storage';
import prisma from '@/lib/prisma';
import { getMe } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  const parts = file || [];
  const key = parts.join('/');
  if (!key || parts.some((p) => !p || p === '..')) return new Response('Not found', { status: 404 });

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
