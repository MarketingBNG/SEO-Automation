import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { recheckIssues, fixIssues } from '@/lib/anthropic';
import { markEditedAsChecked } from '@/lib/factCheckMark';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  try {
    const results = await recheckIssues(d, issues);
    let open = results.filter((r) => r.open).map((r) => String(r.text || r.issue));
    let fixed = false;
    if (fix && open.length) {
      const out = await fixIssues(d, open);
      const words = String(out.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      const saved = await prisma.drafts.update({ where: { id }, data: { title: out.title, meta_description: out.meta, content_html: out.content, word_count: words, updated_at: sqlNow() } });
      await markEditedAsChecked(id, 'the issue fixer');
      fixed = true;
      const again = await recheckIssues(saved, open);
      open = again.filter((r) => r.open).map((r) => String(r.text || r.issue));
    }
    await prisma.drafts.update({ where: { id }, data: { validation_issues: JSON.stringify(open), production_state: open.length ? 'NEEDS_ATTENTION' : 'READY_FOR_REVIEW' } });
    // All resolved: the blog's old publishing-hold reasons no longer apply.
    if (!open.length) await prisma.blog_schedule.updateMany({ where: { draft_id: id, status: 'held' }, data: { hold_reasons: '[]' } });
    await activity.log('draft.issues_rechecked', { actor: await getActor(), entityType: 'draft', entityId: id, details: `${fix ? 'Checked and fixed: ' : ''}${issues.length - open.length} of ${issues.length} issue(s) resolved; ${open.length} still open.` });
    return NextResponse.json({ checked: issues.length, resolved: issues.length - open.length, open: open.length, fixed });
  } catch (err: any) {
    console.error('Issue re-check failed', err);
    return NextResponse.json({ error: `The check could not finish: ${String(err?.message || err).slice(0, 200)}` }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
