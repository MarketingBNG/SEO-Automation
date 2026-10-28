import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateContentSkill } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { timed } from '@/lib/jobTimer';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// One paid run at a time (two tabs or two people): a second run would be paid again, and the shared
// timer key would drop it from /api/ai-credits (running.other) when the first one ends.
let running = false;

export async function POST() {
  if (running) return NextResponse.json({ error: 'A skill update is already running.' }, { status: 409 });
  running = true;
  try {
    // A live timer, so the run shows in the header bar and in /api/ai-credits (running.other).
    const result: any = await timed('skill-generate', 'skill', 'Content-writing skill update', () => generateContentSkill());

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
  } finally {
    running = false;
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
