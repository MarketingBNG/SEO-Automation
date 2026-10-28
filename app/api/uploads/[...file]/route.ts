import { readFile, mimeFor, toKey } from '@/lib/storage';
import { getMe } from '@/lib/auth';
import { canReadAssistantFile } from '@/lib/assistant/fileAccess';

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

  // Documents and images attached in an assistant chat are private like the chat: the uploader or the admin.
  if (key.startsWith('assistant/') && !(await canReadAssistantFile(await getMe(), key))) return new Response('Not found', { status: 404 });

  const data = await readFile(key);
  if (!data) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(data), { headers: { 'Content-Type': mimeFor(key) } });
}
