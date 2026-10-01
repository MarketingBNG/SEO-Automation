import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await prisma.training_examples.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { title, content_html, notes }: any = (await req.json().catch(() => ({}))) || {};
  if (!content_html || !content_html.trim()) {
    return NextResponse.json({ error: 'content_html is required' }, { status: 400 });
  }
  const row = await prisma.training_examples.create({
    data: { title: title || '', content_html, notes: notes || '' },
  });
  await activity.log('training.example_added', {
    entityType: 'training_example',
    entityId: row.id,
    details: title || '(untitled)',
    actor: await getActor(),
  });
  return NextResponse.json(row, { status: 200 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
