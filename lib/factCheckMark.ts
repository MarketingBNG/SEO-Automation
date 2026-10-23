// After a person edits a blog's words (in the dashboard, through the Assistant or from Claude Code),
// the new text is recorded as checked, so the paid "fact check before publishing" does not run again
// by itself. A check runs only when someone presses "Check these issues again".
import { createHash } from 'node:crypto';
import prisma from './prisma';
import { sqlNow } from './time';

export async function markEditedAsChecked(draftId: number, by: string) {
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, select: { title: true, meta_description: true, content_html: true, updated_at: true } });
  const sched = d ? await prisma.blog_schedule.findFirst({ where: { draft_id: draftId } }) : null;
  if (!d || !sched) return;
  const textHash = createHash('sha256').update(`${d.title || ''}\n${d.meta_description || ''}\n${d.content_html || ''}`).digest('hex');
  let prev: any = {};
  try {
    prev = sched.fact_check ? JSON.parse(sched.fact_check) : {};
  } catch {}
  await prisma.blog_schedule.update({
    where: { id: sched.id },
    data: { fact_check: JSON.stringify({ ...prev, stamp: d.updated_at, textHash, ok: true, rounds: 0, corrected: false, checkedAt: sqlNow(), checkedIn: `edited by ${by}; no automatic re-check` }) },
  });
}
