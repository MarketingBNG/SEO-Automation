import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { recheckIssues, fixIssues } from '@/lib/anthropic';
import { markEditedAsChecked } from '@/lib/factCheckMark';
import { sqlNow } from '@/lib/time';
import { timed } from '@/lib/jobTimer';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Drafts with a check running in this process, so two presses (the list row and the open editor)
// never start two paid runs on the same draft.
const running = new Set<number>();

// POST: check the open issues of a draft that needs attention again, against the current article.
// When none is left, the draft becomes ready for review; otherwise only the open ones are kept.
// With { fix: true }: the issues still open are fixed in the whole blog (in context, keeping the rest
// consistent), the fixed blog is saved, and the issues are checked once more against it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fix = Boolean(((await req.json().catch(() => ({}))) as any)?.fix);
  const id = toId((await params).id);
  const d = await prisma.drafts.findUnique({ where: { id } });
  if (!d) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  let issues: string[] = [];
  try {
    issues = JSON.parse(d.validation_issues || '[]');
  } catch {}
  if (!issues.length) return NextResponse.json({ error: 'This draft has no open issues to check.' }, { status: 400 });
  if (running.has(id)) return NextResponse.json({ error: 'A check of this draft is already running. Wait for it to finish.' }, { status: 409 });
  running.add(id);
  // A live timer, so the run shows in the header bar and in /api/ai-credits (running.other): the
  // check before a deploy then sees this paid run and waits for it.
  return timed(`recheck-${id}`, 'recheck', `${fix ? 'Check and fix' : 'Check issues again'}: ${d.title}`, () => recheck(d, id, issues, fix)).finally(() => running.delete(id));
}

async function recheck(d: any, id: number, issues: string[], fix: boolean) {
  // Set as soon as the paid fix is saved, so a failure after that still tells the page to reload it.
  let fixed = false;
  try {
    const results = await recheckIssues(d, issues);
    let open = results.filter((r) => r.open).map((r) => String(r.text || r.issue));
    // Only the words count: a new cover or a status change meanwhile does not throw the fix away.
    const sameWords = { id, title: d.title, meta_description: d.meta_description, content_html: d.content_html };
    // The words the result below was judged on (the fixed version after a fix).
    let checked: any = sameWords;
    const savedMeanwhile = { error: 'The draft was saved by someone while the fix ran, so the fix was not saved (nothing was overwritten). Press Check and fix again to fix the saved version.' };
    if (fix && open.length) {
      // Saved while the check ran: the paid fix is not started on the old text.
      if (!(await prisma.drafts.count({ where: sameWords }))) return NextResponse.json(savedMeanwhile, { status: 409 });
      const out = await fixIssues(d, open);
      const words = String(out.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      // Saved only when nobody changed the words while the fix ran: a person's save is never overwritten.
      const { count } = await prisma.drafts.updateMany({ where: sameWords, data: { title: out.title, meta_description: out.meta, content_html: out.content, word_count: words, updated_at: sqlNow() } });
      if (!count) return NextResponse.json(savedMeanwhile, { status: 409 });
      fixed = true;
      const saved = (await prisma.drafts.findUnique({ where: { id } }))!;
      await markEditedAsChecked(id, 'the issue fixer', { byPerson: false });
      checked = { id, title: saved.title, meta_description: saved.meta_description, content_html: saved.content_html };
      const again = await recheckIssues(saved, open);
      open = again.filter((r) => r.open).map((r) => String(r.text || r.issue));
    }
    // Written only when nobody saved the words while the check ran: a newer save was never checked,
    // so it must not be marked ready for review (or lose its hold reasons) on the old text's result.
    const { count: written } = await prisma.drafts.updateMany({ where: checked, data: { validation_issues: JSON.stringify(open), production_state: open.length ? 'NEEDS_ATTENTION' : 'READY_FOR_REVIEW' } });
    if (!written) {
      // The fix was saved (and paid for) even though the result was not: recorded, as on a failure below.
      if (fixed) await activity.log('draft.issues_fixed', { actor: await getActor().catch(() => 'system'), entityType: 'draft', entityId: id, details: 'Checked and fixed: the fix was saved, but the draft was saved again during the check, so the result was not written. Press Check issues again to see what is still open.' }).catch(() => {});
      return NextResponse.json({ error: `The draft was saved by someone while the check ran, so the result was not saved${fixed ? ' (the fix itself was saved)' : ''}. Press Check issues again to check the saved version.`, fixed }, { status: 409 });
    }
    // All resolved: the blog's old publishing-hold reasons no longer apply.
    if (!open.length) await prisma.blog_schedule.updateMany({ where: { draft_id: id, status: 'held' }, data: { hold_reasons: '[]' } });
    await activity.log('draft.issues_rechecked', { actor: await getActor(), entityType: 'draft', entityId: id, details: `${fix ? 'Checked and fixed: ' : ''}${issues.length - open.length} of ${issues.length} issue(s) resolved; ${open.length} still open.` });
    return NextResponse.json({ checked: issues.length, resolved: issues.length - open.length, open: open.length, fixed });
  } catch (err: any) {
    console.error('Issue re-check failed', err);
    const why = String(err?.message || err).slice(0, 200);
    // The fix was saved (and paid for) but the check after it did not finish: recorded, and the page
    // reloads the fixed article (fixed: true) instead of showing the old text.
    if (fixed) await activity.log('draft.issues_fixed', { actor: await getActor().catch(() => 'system'), entityType: 'draft', entityId: id, details: `Checked and fixed: the fix was saved, but the check after it did not finish (${why}). Press Check issues again to see what is still open.` }).catch(() => {});
    return NextResponse.json({ error: `The check could not finish: ${why}${fixed ? ' The fix itself was saved.' : ''}`, fixed }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
