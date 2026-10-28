// After a person edits the words of a blog that passed its fact check (in the dashboard, with an
// image, or from Claude Code), the new text is recorded as checked, so the paid "fact check before
// publishing" does not run again by itself. Edits made by AI (the Assistant, the issue fixer) and edits
// to a blog that never passed the full check are not recorded: the edited text is fact-checked once
// before it can be auto-published.
import { createHash } from 'node:crypto';
import prisma from './prisma';
import { sqlNow } from './time';

// The words of a draft (title, meta description, article) as one hash: a change to anything else
// (cover, status, alt text) leaves it the same.
export const wordsHash = (d: { title?: string | null; meta_description?: string | null; content_html?: string | null }) =>
  createHash('sha256').update(`${d.title || ''}\n${d.meta_description || ''}\n${d.content_html || ''}`).digest('hex');

// before: the draft as it was just before this edit (its words hash and updated_at). The edit counts as
// checked only when the passed check covered that text, so an unchecked AI edit made earlier is not
// marked as checked by a later person's save.
export async function markEditedAsChecked(draftId: number, by: string, { byPerson = true, before }: { byPerson?: boolean; before?: { textHash?: string; stamp?: string | null } } = {}) {
  const d = await prisma.drafts.findUnique({ where: { id: draftId }, select: { title: true, meta_description: true, content_html: true, updated_at: true } });
  const sched = d ? await prisma.blog_schedule.findFirst({ where: { draft_id: draftId } }) : null;
  if (!d || !sched) return;
  const textHash = wordsHash(d);
  let prev: any = {};
  try {
    prev = sched.fact_check ? JSON.parse(sched.fact_check) : {};
  } catch {}
  const next = editedFactCheck(prev, { stamp: d.updated_at, textHash, by, at: sqlNow(), byPerson, before });
  if (next === prev) return;
  await prisma.blog_schedule.update({ where: { id: sched.id }, data: { fact_check: JSON.stringify(next) } });
}

// The fact check record after an edit. Only a person's edit to a blog whose full check passed on the
// text just before this edit counts as checked. In every other case (an AI edit, a failed check, no
// full check yet: only the inline check at writing time, or none, or a passed check that no longer
// covers the text because of an unchecked AI edit in between) the record is returned unchanged, the
// same object, so its stamp and text hash no longer match the edited text and the fact check runs once.
export function editedFactCheck(
  prev: any,
  { stamp, textHash, by, at, byPerson = true, before }: { stamp: string; textHash: string; by: string; at: string; byPerson?: boolean; before?: { textHash?: string; stamp?: string | null } }
) {
  if (!byPerson || prev?.ok !== true) return prev;
  const covered = prev.textHash ? prev.textHash === before?.textHash : Boolean(prev.stamp) && prev.stamp === before?.stamp;
  if (!covered) return prev;
  return { ...prev, stamp, textHash, ok: true, rounds: 0, corrected: false, checkedAt: at, checkedIn: `edited by ${by}; no automatic re-check` };
}
