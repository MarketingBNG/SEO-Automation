import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// ?id=<learning video id>: the notes Gemini took while watching.
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'));
  const v = await prisma.learning_videos.findUnique({ where: { id }, select: { id: true, title: true, channel: true, url: true, category: true, notes: true, status: true, parts_done: true, parts_total: true, model: true } });
  if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  return NextResponse.json(v);
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
