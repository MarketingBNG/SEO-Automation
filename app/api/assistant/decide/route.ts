import { NextRequest, NextResponse } from 'next/server';
import { decide } from '@/lib/assistant/engine';
import { streamNdjson } from '@/lib/assistant/stream';
import { getMe } from '@/lib/auth';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conversationId, decisions } = (await req.json().catch(() => ({}))) || {};
  if (!conversationId || !Array.isArray(decisions)) {
    return NextResponse.json({ error: 'conversationId and decisions are required' }, { status: 400 });
  }

  const me = await getMe();
  // Only the owner (or an admin) may decide a chat's pending actions, as in chat/route.ts.
  const row = await prisma.assistant_conversations.findUnique({ where: { id: Number(conversationId) }, select: { created_by: true } });
  if (row && me && me.role !== 'admin' && ![me.name, me.email].includes(row.created_by || '')) return NextResponse.json({ error: 'This chat belongs to someone else.' }, { status: 403 });
  return streamNdjson(req, (emit, signal) => decide({ conversationId: Number(conversationId), decisions, me }, emit, signal));
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };
