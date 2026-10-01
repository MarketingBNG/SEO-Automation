import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await prisma.client_insights.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { transcript_id, title, meeting_date, overview, action_items, keywords }: any = (await req.json().catch(() => ({}))) || {};
  if (!overview) return NextResponse.json({ error: 'overview is required' }, { status: 400 });

  const row = await prisma.client_insights.create({
    data: {
      transcript_id: transcript_id || null,
      title: title || '',
      meeting_date: meeting_date || '',
      overview,
      action_items: action_items || '',
      keywords: JSON.stringify(keywords || []),
      status: 'pending_review',
    },
  });

  await activity.log('client_insight.imported', {
    entityType: 'client_insight',
    entityId: row.id,
    details: title || '(untitled meeting)',
    actor: await getActor(),
  });
  return NextResponse.json(row, { status: 200 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
