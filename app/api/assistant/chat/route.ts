import { NextRequest, NextResponse } from 'next/server';
import { sendMessage } from '@/lib/assistant/engine';
import { streamNdjson } from '@/lib/assistant/stream';
import { getActor, getMe } from '@/lib/auth';
import * as activity from '@/lib/activity';
import prisma from '@/lib/prisma';
import { isOwner, ownerStamp } from '@/lib/assistant/conversations';

export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conversationId, message, imageIds } = (await req.json().catch(() => ({}))) || {};
  if (!message?.trim() && !(imageIds && imageIds.length)) {
    return NextResponse.json({ error: 'message or an image is required' }, { status: 400 });
  }
  const ids = (imageIds || []).map(Number).filter(Number.isInteger);
  const actor = await getActor();
  const me = await getMe();
  // Only the owner (or an admin) may continue a chat.
  if (conversationId) {
    const row = await prisma.assistant_conversations.findUnique({ where: { id: Number(conversationId) }, select: { created_by: true } });
    if (row && me && me.role !== 'admin' && !isOwner(me, row.created_by)) return NextResponse.json({ error: 'This chat belongs to someone else.' }, { status: 403 });
  }
  await activity.log('assistant.asked', { details: String(message || '(image)').replace(/<attached_document[\s\S]*$/, '').trim().slice(0, 160) || 'Sent a file', source: 'assistant' }).catch(() => {});

  return streamNdjson(req, (emit, signal) =>
    sendMessage({ conversationId: conversationId ? Number(conversationId) : null, text: message || '', imageIds: ids, actor: ownerStamp(me, actor), me }, emit, signal)
  );
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };
