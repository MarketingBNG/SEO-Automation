import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateDailyDigest } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await prisma.research_digests.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const { topic }: any = (await req.json().catch(() => ({}))) || {};
    const topics = topic ? [topic] : undefined;
    const result: any = await generateDailyDigest(topics);

    const row = await prisma.research_digests.create({
      data: { topic: topic || null, summary: result.summary, sources: JSON.stringify(result.sources), status: 'pending_approval' },
    });
    await activity.log('research.digest_generated', {
      entityType: 'research_digest',
      entityId: row.id,
      details: topic || 'general',
    });
    return NextResponse.json(row, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
