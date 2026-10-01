import { NextRequest, NextResponse } from 'next/server';
import { decide } from '@/lib/assistant/engine';
import { streamNdjson } from '@/lib/assistant/stream';

export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conversationId, decisions } = (await req.json().catch(() => ({}))) || {};
  if (!conversationId || !Array.isArray(decisions)) {
    return NextResponse.json({ error: 'conversationId and decisions are required' }, { status: 400 });
  }

  return streamNdjson(req, (emit, signal) => decide({ conversationId: Number(conversationId), decisions }, emit, signal));
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };
