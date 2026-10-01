import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateContentSkill } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result: any = await generateContentSkill();

    await prisma.writing_skills.updateMany({ where: { status: 'active' }, data: { status: 'superseded' } });

    const created = await prisma.writing_skills.create({
      data: {
        skill_content: result.skillContent,
        research_summary: result.researchSummary,
        sources: JSON.stringify(result.sources),
        own_performance_notes: result.ownPerformanceNote,
        status: 'active',
      },
    });

    await activity.log('skill.updated', {
      entityType: 'writing_skill',
      entityId: created.id,
      details: `New content-writing skill version, ${result.sources.length} source(s)`,
    });

    const row: any = await prisma.writing_skills.findUnique({ where: { id: created.id } });
    return NextResponse.json({ ...row, sources: JSON.parse(row.sources || '[]') }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
