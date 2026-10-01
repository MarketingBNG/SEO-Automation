import { NextRequest, NextResponse } from 'next/server';
import { sendMessage } from '@/lib/assistant/engine';
import { streamNdjson } from '@/lib/assistant/stream';

export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { conversationId, message, imageIds } = (await req.json().catch(() => ({}))) || {};
  if (!message?.trim() && !(imageIds && imageIds.length)) {
    return NextResponse.json({ error: 'message or an image is required' }, { status: 400 });
  }
  const ids = (imageIds || []).map(Number).filter(Number.isInteger);

  return streamNdjson(req, (emit, signal) =>
    sendMessage({ conversationId: conversationId ? Number(conversationId) : null, text: message || '', imageIds: ids }, emit, signal)
  );
}

const methodNotAllowed = () => NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as DELETE, methodNotAllowed as PATCH };
