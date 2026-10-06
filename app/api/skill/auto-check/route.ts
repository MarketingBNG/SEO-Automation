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
// Runs through the Batch API (half price, can take up to hours), so the work continues in the
// background after the cron request gets its answer. This flag stops a second call starting a
// duplicate while one is still waiting (self-hosted Node keeps the process alive).
let running = false;
const MAX_ATTEMPTS = 3;

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

  if (running) return NextResponse.json({ ran: false, reason: 'A skill refresh is already running.' }, { status: 200 });
  running = true;
  refresh().finally(() => { running = false; });
  return NextResponse.json({ ran: true, started: true, mode: 'batch' }, { status: 202 });
}

async function refresh() {
  try {
    // A failed attempt is retried straight away, up to MAX_ATTEMPTS in total.
    let result: any;
    for (let attempt = 1; ; attempt++) {
      try {
        result = await generateContentSkill({ batch: true });
        break;
      } catch (err: any) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        console.error(`Skill auto-refresh attempt ${attempt} failed, retrying:`, err.message);
      }
    }

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

  } catch (err: any) {
    console.error('Skill auto-refresh failed:', err);
    await activity.log('skill.auto_update_failed', { entityType: 'writing_skill', details: err.message }).catch(() => {});
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
