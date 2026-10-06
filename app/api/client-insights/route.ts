import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { autoReview, syncMeetings } from '@/lib/clientInsights';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  // Cleaned and approved automatically when nothing identifying is left; otherwise left for review.
  const reviewed = await autoReview(row.id).catch((e: any) => {
    console.error('Auto review failed:', e);
    return row;
  });
  return NextResponse.json(reviewed, { status: 200 });
}

// PUT: pull recent Fireflies meetings now and auto-review them (same as the daily job).
export async function PUT() {
  try {
    return NextResponse.json(await syncMeetings());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as PATCH, methodNotAllowed as DELETE };
