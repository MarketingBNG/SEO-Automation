import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { basename } from '@/lib/storage';
import { loadConversation, IMAGE_MARKER } from '@/lib/assistant/engine';
import { getTool } from '@/lib/assistant/tools';
import { getMe } from '@/lib/auth';

// Who may see a conversation: its owner, or an admin (who sees everyone's).
export function mineOnly(me: any) {
  if (!me || me.role === 'admin') return null;
  return { created_by: { in: [me.name, me.email].filter(Boolean) } };
}

export const runtime = 'nodejs';

async function imageUrl(id) {
  const row = await prisma.image_library.findUnique({ where: { id }, select: { path: true } });
  return row ? `/api/uploads/assistant/${basename(row.path)}` : null;
}

function summarize(name, input) {
  const tool = getTool(name);
  if (!tool) return name;
  try {
    return tool.summarize(input || {});
  } catch {
    return name;
  }
}

// Turns the stored API message history into chat items the UI can render.
async function buildTranscript(messages) {
  const items: any[] = [];
  const byToolUseId = new Map();
  for (const m of messages) {
    if (m.role === 'user') {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
      const texts: string[] = [];
      const images: any[] = [];
      for (const b of blocks) {
        if (b.type === 'text') texts.push(b.text);
        else if (b.type === 'image' && String(b.source?.data || '').startsWith(IMAGE_MARKER)) {
          images.push(await imageUrl(Number(b.source.data.slice(IMAGE_MARKER.length))));
        } else if (b.type === 'tool_result') {
          const item = byToolUseId.get(b.tool_use_id);
          if (!item) continue;
          const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
          item.status = /^(The user declined|Not approved)/.test(text) ? 'declined' : b.is_error ? 'error' : 'ok';
          if (item.status !== 'ok') item.detail = text.slice(0, 300);
          const changeMatch = text.match(/"change_id":\s*(\d+)/);
          if (changeMatch) item.changeId = Number(changeMatch[1]);
        }
      }
      // Attached Word documents: shown as a link to the stored file instead of their text.
      const files: any[] = [];
      for (const m of texts.join('\n').matchAll(/<attached_document name="([^"]*)"(?: file_id="(\d+)")?>/g)) {
        const f = m[2] ? await prisma.assistant_files.findUnique({ where: { id: Number(m[2]) }, select: { path: true } }) : null;
        files.push({ name: m[1], url: f ? `/api/uploads/${f.path}` : null });
      }
      const text = texts
        .join('\n')
        .replace(/\n*\[Attached image_id[^\]]*\]/g, '')
        .replace(/<attached_document name="([^"]*)"[^>]*>[\s\S]*?<\/attached_document>/g, '')
        .trim();
      if ((text && text !== '(image attached)') || images.length || files.length) items.push({ kind: 'user', text: text === '(image attached)' ? '' : text, images: images.filter(Boolean), files });
    } else if (m.role === 'assistant') {
      for (const b of m.content || []) {
        if (b.type === 'text' && b.text.trim()) {
          items.push({ kind: 'assistant', text: b.text });
        } else if (b.type === 'thinking' && b.thinking && b.thinking.trim()) {
          items.push({ kind: 'progress', text: b.thinking.trim() });
        } else if (b.type === 'tool_use') {
          const tool = getTool(b.name);
          const item = { kind: 'tool', toolUseId: b.id, name: b.name, summary: summarize(b.name, b.input), write: tool?.kind === 'write', status: 'pending' };
          items.push(item);
          byToolUseId.set(b.id, item);
        } else if (b.type === 'server_tool_use') {
          items.push({ kind: 'tool', name: b.name, summary: b.name === 'web_search' ? `Searched the web: ${b.input?.query || ''}` : b.name, status: 'ok' });
        }
      }
    }
  }
  return items;
}

export async function GET(req: NextRequest) {
  const qid = req.nextUrl.searchParams.get('id');
  const me = await getMe();
  const own = mineOnly(me);
  if (qid) {
    const conv = await loadConversation(Number(qid));
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (own && !own.created_by.in.includes(conv.created_by)) return NextResponse.json({ error: 'This chat belongs to someone else. Only an admin can open other people\'s chats.' }, { status: 403 });
    // PORT NOTE: `undo IS NOT NULL AS undoable` was SQLite 0/1; kept as 0/1.
    const changes = (
      await prisma.site_changes.findMany({
        where: { conversation_id: conv.id },
        select: { id: true, tool: true, summary: true, status: true, created_at: true, undone_at: true, undo: true },
        orderBy: { id: 'asc' },
      })
    ).map(({ undo, ...c }) => ({ ...c, undoable: undo !== null ? 1 : 0 }));
    return NextResponse.json(
      {
        id: conv.id,
        title: conv.title,
        status: conv.status,
        items: await buildTranscript(conv.messages),
        pending: conv.pending ? conv.pending.actions : null,
        changes,
      },
      { status: 200 }
    );
  }

  const rows = await prisma.assistant_conversations.findMany({
    where: own || undefined,
    select: { id: true, title: true, status: true, updated_at: true, created_by: true },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  return NextResponse.json(rows, { status: 200 });
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };
