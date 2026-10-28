// Who may read a file attached in an assistant chat (documents and images): its uploader, or an
// admin. Shared by the uploads route (the file itself) and the chat route (image ids sent with a
// message), so a member cannot read, or send to Claude, an image someone attached in a private chat.
import prisma from '../prisma';
import { ownedBy } from './conversations';

// `key` is a storage key under assistant/. An image's '-model.jpg' copy counts as its original.
// An image attached before attached files were recorded (no assistant_files row) is served as before.
export async function canReadAssistantFile(me: any, key: string): Promise<boolean> {
  if (!key.startsWith('assistant/')) return true;
  if (me?.role === 'admin') return true;
  const doc = key.startsWith('assistant/docs/');
  let path = key;
  if (!doc) {
    const img = await prisma.image_library.findFirst({ where: { OR: [{ path: key }, { model_path: key }] }, select: { path: true } });
    if (img?.path) path = img.path;
  }
  if (me && (await prisma.assistant_files.count({ where: { path, ...ownedBy(me, 'uploaded_by') } })) > 0) return true;
  if (doc) return false;
  return (await prisma.assistant_files.count({ where: { path } })) === 0;
}

// The image ids (image_library) the person attached themselves in the assistant (an admin: all).
// legacy: also an image attached in the assistant (an assistant/ key) before attached files were
// recorded (no assistant_files row at all), the same rule canReadAssistantFile serves it by. An image
// added elsewhere (Drafts & Review keeps its files under inline/) never has a row and is not one. The chat route leaves it off: a newly sent id
// always has its row.
export async function ownImageIds(me: any, ids: number[], { legacy = false }: { legacy?: boolean } = {}): Promise<number[]> {
  if (!ids.length || me?.role === 'admin') return ids;
  if (!me) return [];
  const imgs = await prisma.image_library.findMany({ where: { id: { in: ids } }, select: { id: true, path: true } });
  const owned = await prisma.assistant_files.findMany({ where: { kind: 'image', path: { in: imgs.map((i) => i.path) }, ...ownedBy(me, 'uploaded_by') }, select: { path: true } });
  const paths = new Set(owned.map((o) => o.path));
  if (legacy) {
    const recorded = new Set((await prisma.assistant_files.findMany({ where: { path: { in: imgs.map((i) => i.path) } }, select: { path: true } })).map((r) => r.path));
    for (const i of imgs) if (i.path.startsWith('assistant/') && !recorded.has(i.path)) paths.add(i.path);
  }
  const mine = new Set(imgs.filter((i) => paths.has(i.path)).map((i) => i.id));
  return ids.filter((id) => mine.has(id));
}
