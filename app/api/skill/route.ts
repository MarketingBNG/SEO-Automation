import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows: any[] = await prisma.writing_skills.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(
    rows.map((r) => ({ ...r, sources: JSON.parse(r.sources || '[]') })),
    { status: 200 }
  );
}

// Manual edit of the writing skill: { skill_content, research_summary }. Saved as a new active
// version (the old one stays in the history), so an edit can always be undone. The next automatic
// refresh builds on this edited version.
export async function POST(req: NextRequest) {
  const { skill_content, research_summary }: any = (await req.json().catch(() => ({}))) || {};
  if (typeof skill_content !== 'string' || !skill_content.trim()) {
    return NextResponse.json({ error: 'The skill cannot be empty.' }, { status: 400 });
  }
  const actor = await getActor();
  const previous = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });
  const created = await prisma.$transaction(async (tx) => {
    await tx.writing_skills.updateMany({ where: { status: 'active' }, data: { status: 'superseded' } });
    return tx.writing_skills.create({
      data: {
        skill_content: skill_content.trim(),
        research_summary: typeof research_summary === 'string' ? research_summary.trim() : previous?.research_summary ?? null,
        sources: previous?.sources ?? null,
        own_performance_notes: previous?.own_performance_notes ?? null,
        status: 'active',
      },
    });
  });
  await activity.log('skill.edited', { entityType: 'writing_skill', entityId: created.id, details: `Edited manually (replaces version #${previous?.id ?? 'none'})`, actor });
  return NextResponse.json({ ...created, sources: JSON.parse(created.sources || '[]') });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
