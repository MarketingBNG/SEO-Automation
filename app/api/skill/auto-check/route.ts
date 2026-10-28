// Idempotent, cron-safe: only actually regenerates the skill if it's missing or 15+ days old.
// Wire a daily cron (with CRON_SECRET) to GET here once deployed, and the 15-day cycle takes care
// of itself - calling this daily is safe, it's a no-op most days. Only the scheduled task starts it:
// a person uses "Update skill" (app/api/skill/generate), which has its own guards and logging.
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateContentSkill } from '@/lib/anthropic';
import * as activity from '@/lib/activity';
import { isCronRequest, methodNotAllowed } from '../../_lib/http';
import { runAutomatic } from '@/lib/aiQueue';
import { CreditPausedError } from '@/lib/aiCredits';
import { claimSkillRun, releaseSkillRun } from '@/lib/skillRun';

export const runtime = 'nodejs';

const REFRESH_DAYS = 15;
// Runs through the Batch API (half price, can take up to hours), so the work continues in the
// background after the cron request gets its answer. The shared flag (lib/skillRun.ts) stops a
// second call, or a manual "Update skill" press, starting a duplicate while one is still waiting
// (self-hosted Node keeps the process alive).
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

  const busy = claimSkillRun('auto');
  if (busy) return NextResponse.json({ ran: false, reason: busy === 'manual' ? 'A manual skill update is running.' : 'A skill refresh is already running.' }, { status: 200 });
  refresh().finally(() => releaseSkillRun('auto'));
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
        // AI work is paused (credits, or Testing mode for this automatic run): a wait, not a failure.
        // The skill stays due, so the next daily run tries again.
        if (err instanceof CreditPausedError) {
          console.log('Skill auto-refresh waits:', err.message);
          return;
        }
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

// Cron only (CRON_SECRET), GET or POST: a signed-in browser cannot start this paid batch refresh.
// Any other request keeps the old 405.
export async function GET(req: Request) {
  // Automatic work: in Testing mode it does not use AI (lib/aiQueue.ts).
  if (isCronRequest(req)) return runAutomatic(() => run());
  return methodNotAllowed();
}
export { GET as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
