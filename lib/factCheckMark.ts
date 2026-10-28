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
  await prisma.blog_schedule.update({ where: { id: sched.id }, data: { fact_check: JSON.stringify(editedFactCheck(prev, { stamp: d.updated_at, textHash, by, at: sqlNow() })) } });
}

// The fact check record after an edit. An edit never turns a failed check into a pass: a blog whose
// check could not confirm every claim stays not verified (and is not auto-published) until a person
// approves it or presses "Check these issues again".
export function editedFactCheck(prev: any, { stamp, textHash, by, at }: { stamp: string; textHash: string; by: string; at: string }) {
  if (prev?.ok === false) return { ...prev, stamp, textHash, checkedIn: `edited by ${by}; the earlier fact check could not confirm every claim, so it is still not verified` };
  return { ...prev, stamp, textHash, ok: true, rounds: 0, corrected: false, checkedAt: at, checkedIn: `edited by ${by}; no automatic re-check` };
}
