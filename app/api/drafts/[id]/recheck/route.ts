import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { recheckIssues } from '@/lib/anthropic';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST: check the open issues of a draft that needs attention again, against the current article.
// When none is left, the draft becomes ready for review; otherwise only the open ones are kept.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const open = results.filter((r) => r.open).map((r) => r.text);
    await prisma.drafts.update({ where: { id }, data: { validation_issues: JSON.stringify(open), production_state: open.length ? 'NEEDS_ATTENTION' : 'READY_FOR_REVIEW' } });
    await activity.log('draft.issues_rechecked', { actor: await getActor(), entityType: 'draft', entityId: id, details: `${issues.length - open.length} of ${issues.length} issue(s) resolved; ${open.length} still open.` });
    return NextResponse.json({ checked: issues.length, resolved: issues.length - open.length, open: open.length });
  } catch (err: any) {
    console.error('Issue re-check failed', err);
    return NextResponse.json({ error: `The check could not finish: ${String(err?.message || err).slice(0, 200)}` }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
