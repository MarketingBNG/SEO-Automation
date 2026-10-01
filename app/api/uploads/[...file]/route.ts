import { readFile, mimeFor } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  const parts = file || [];
  const key = parts.join('/');
  if (!key || parts.some((p) => !p || p === '..')) return new Response('Not found', { status: 404 });

  const data = await readFile(key);
  if (!data) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(data), { headers: { 'Content-Type': mimeFor(key) } });
}
