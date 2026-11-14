// Writing rules: the content-writing skill (edit it, or have the AI research a new version), the
// editable writing settings, and the lessons learned from reviews. Shared by /api/skill,
// /api/skill/generate, /api/settings, /api/lessons and the assistant's writing-rules tools.
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { skillRunning, claimSkillRun, releaseSkillRun } from '@/lib/skillRun';
import { skillBatchWaiting, generateContentSkill, SkillBatchWaitingError } from '@/lib/anthropic';
import { aiMode } from '@/lib/aiQueue';
import { timed, startedAt } from '@/lib/jobTimer';
import { EDITABLE_SETTINGS, isEditableSetting } from '@/lib/permissions';

type Result = { status: number; body: any };

// Manual edit of the writing skill: { skill_content, research_summary }. Saved as a new active
// version (the old one stays in the history), so an edit can always be undone. The next automatic
// refresh builds on this edited version.
export async function saveSkillEdit({ skill_content, research_summary }: any, actor: string): Promise<Result> {
  if (typeof skill_content !== 'string' || !skill_content.trim()) {
    return { status: 400, body: { error: 'The skill cannot be empty.' } };
  }
  // The automatic refresh's batch is built on the current version: an edit saved while it waits would
  // be replaced by that result when it is collected (and, before the fix, lost the paid batch).
  if (skillRunning() === 'auto' || (await skillBatchWaiting())) {
    return { status: 409, body: { error: 'The automatic skill refresh is waiting for its batch (already paid for), which builds on the current version. Edit the skill after it finishes, so your edit is not replaced.' } };
  }
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
  return { status: 200, body: { ...created, sources: JSON.parse(created.sources || '[]') } };
}

// "Update the skill now": the AI researches and writes a new version (paid in Live mode). One paid run
// at a time (two tabs or two people, or the automatic refresh waiting for its batch): a second run
// would be paid again, and the shared timer key would drop it from /api/ai-credits (running.other)
// when the first one ends.
//
// In Testing mode the run waits in the free Claude Code queue, with no time limit, so it does not take
// the run: a job left unanswered there would otherwise stop the automatic refresh for good.
export async function generateSkillNow(): Promise<Result> {
  const claims = (await aiMode()) === 'live';
  const busy = claims ? claimSkillRun('manual') : skillRunning() === 'auto' ? 'auto' : null;
  if (busy === 'auto') return { status: 409, body: { error: 'The automatic skill refresh is running (its batch can take a few hours). It finishes by itself; update the skill after that if you still want to.' } };
  if (busy) return { status: 409, body: { error: 'A skill update is already running.' } };
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
    return { status: 200, body: { ...row, sources: JSON.parse(row.sources || '[]') } };
  } catch (err: any) {
    if (err instanceof SkillBatchWaitingError) return { status: 409, body: { error: err.message } };
    console.error(err);
    return { status: 500, body: { error: err.message } };
  } finally {
    if (claims) releaseSkillRun('manual');
  }
}

// Only the user-editable keys: role access, AI credit state, run guards and paid API caches stay
// behind their own routes.
export async function editableSettings() {
  const all = await settings.getAll();
  const out: Record<string, any> = {};
  for (const key of EDITABLE_SETTINGS) if (key in all) out[key] = all[key];
  return out;
}

export async function saveSettings(body: Record<string, any>, actor: string): Promise<Result> {
  const refused = Object.keys(body).filter((k) => !isEditableSetting(k));
  if (refused.length) {
    return { status: 400, body: { error: `These settings cannot be changed here: ${refused.join(', ')}.` } };
  }
  for (const [key, value] of Object.entries(body)) {
    await settings.set(key, value);
  }
  await activity.log('settings.updated', { entityType: 'settings', details: Object.keys(body).join(', '), actor });
  return { status: 200, body: await editableSettings() };
}

// Learns from the latest reviews, holds and results in the background (it also runs every Monday).
export async function startLessons(): Promise<{ started: boolean; running?: boolean }> {
  if (startedAt('lessons')) return { started: false, running: true };
  const { learnLessons } = await import('@/lib/lessons');
  void learnLessons().catch((e) => console.error('Lessons failed:', e.message));
  return { started: true };
}
