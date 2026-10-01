// Idempotent, cron-safe: only actually regenerates the skill if it's missing or 15+ days old.
// Wire a daily cron (Cloudways cron job or any scheduler) to POST here once deployed, and the
// 15-day cycle takes care of itself - calling this daily is safe, it's a no-op most days.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateContentSkill } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

const REFRESH_DAYS = 15;

async function run() {
  const active: any = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });

  if (active) {
    const ageDays = Math.floor(
      (Date.now() - new Date(active.created_at + 'Z').getTime()) / (1000 * 60 * 60 * 24)
    );
    if (ageDays < REFRESH_DAYS) {
      return NextResponse.json({ ran: false, reason: `Skill is only ${ageDays} day(s) old, not due yet.` }, { status: 200 });
    }
  }

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

    await activity.log('skill.auto_updated', {
      entityType: 'writing_skill',
      entityId: created.id,
      details: `Automatic 15-day refresh, ${result.sources.length} source(s)`,
    });

    return NextResponse.json({ ran: true, id: created.id }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ ran: false, error: err.message }, { status: 500 });
  }
}

export async function POST() {
  return run();
}

// PORT NOTE: Vercel Cron can only call with GET, so a GET carrying CRON_SECRET runs the same
// idempotent check as POST. Any other GET keeps the old 405.
export async function GET(req: Request) {
  if (isCronRequest(req)) return run();
  return methodNotAllowed();
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
