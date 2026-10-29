// Daily: the team's edits and uploads (content_changes) become lessons for the writer's memory, so
// what reviewers keep changing is written right from the start next time. One AI call a day at
// most, with no web search; the evidence is only what the diffs recorded.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { remember } from './agentMemory';
import { timed } from './jobTimer';

const MIN_CHANGE_PCT = 2;

export async function learnFromChanges({ write = callClaude as any } = {}) {
  const rows = await prisma.content_changes.findMany({ where: { learned: false, kind: { in: ['edit', 'upload', 'reupload', 'restore'] }, changed_pct: { gte: MIN_CHANGE_PCT } }, orderBy: { id: 'asc' }, take: 40 });
  if (!rows.length) return { skipped: 'No new edits to learn from' };
  return timed('change-lessons', 'lessons', "Learning from the team's edits", async () => {
    const evidence = rows.map((r) => {
      let samples: any[] = [];
      try {
        samples = JSON.parse(r.report).samples || [];
      } catch {}
      const examples = samples
        .slice(0, 3)
        .map((s: any) => (s.type === 'reworded' ? `"${s.before}" became "${s.after}"` : s.type === 'added' ? `added "${s.after}"` : `removed "${s.before}"`))
        .join(' | ');
      return `[${r.kind} by ${r.actor || 'someone'}] "${r.title || 'untitled'}": ${r.summary}${examples ? ` Examples: ${examples}` : ''}`;
    });
    const { text } = await write(
      `You study how a content team edits the blogs its AI writer drafts, for USAIndiaCFO (US-India cross-border tax, finance and compliance). From the evidence, write the lessons the writer should follow from the start so the team has less to change. Each lesson is one sentence starting with a verb, specific to the kind of change and the topic (for example "Open NRI tax blogs with the deadline and penalty, not a definition"), never generic advice. Only patterns the evidence shows; nothing invented. At most 8 lessons; fewer when the evidence is thin; none when it shows no pattern. No em dashes. Return ONLY the lessons, one per line, each starting with "- ".`,
      [{ role: 'user', content: `Edits and uploads by the team (newest last):\n${evidence.join('\n')}`.slice(0, 40000) }],
      undefined,
      { maxUses: 0, effort: 'medium', feature: 'lessons' }
    );
    const lessons = String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^- /.test(l))
      .map((l) => l.slice(2).trim())
      .filter((l) => l.length > 20)
      .slice(0, 8);
    for (const l of lessons) await remember({ agent: 'writer', kind: 'preference', title: l.slice(0, 150), body: l, source: 'edits' }).catch(() => {});
    await prisma.content_changes.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { learned: true } });
    await settings.set('change_lessons_at', new Date().toISOString());
    await activity.log('lessons.from_edits', { details: `${lessons.length} lesson(s) from ${rows.length} edit(s) and upload(s)` });
    return { lessons, edits: rows.length };
  });
}

// Once a day, when there is something new to learn from.
export async function changeLessonsTick(today: string) {
  if ((await settings.get('last_change_lessons')) === today) return;
  const pending = await prisma.content_changes.count({ where: { learned: false, changed_pct: { gte: MIN_CHANGE_PCT }, kind: { in: ['edit', 'upload', 'reupload', 'restore'] } } });
  if (!pending) return;
  await settings.set('last_change_lessons', today);
  await learnFromChanges();
}
