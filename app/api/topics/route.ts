import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { researchTopics, istDay } from '@/lib/topics';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the last 14 days of topics (today first) with where each one went, and the last run.
export async function GET() {
  const rows = await prisma.topics.findMany({ orderBy: [{ day: 'desc' }, { id: 'asc' }], take: 70 });
  const draftIds = rows.flatMap((r) => [r.draft_id, r.article_draft_id]).filter((x): x is number => Boolean(x));
  const drafts = draftIds.length ? await prisma.drafts.findMany({ where: { id: { in: draftIds } }, select: { id: true, title: true, status: true, kind: true, wp_post_url: true } }) : [];
  const auditIds = rows.map((r) => r.audit_id).filter((x): x is number => Boolean(x));
  const audits = auditIds.length ? await prisma.blog_audits.findMany({ where: { id: { in: auditIds } }, select: { id: true, title: true, verdict: true, audit_status: true, audit_error: true, rewrite_status: true, rewrite_error: true, rewrite_content_html: true, summary: true, issues: true } }) : [];
  const byDraft = new Map(drafts.map((d) => [d.id, d]));
  const byAudit = new Map(audits.map((a) => [a.id, { ...a, rewrite_content_html: undefined, hasRewrite: Boolean(a.rewrite_content_html), issues: JSON.parse(a.issues || '[]') }]));
  let lastRun: any = null;
  try {
    lastRun = JSON.parse((await settings.get('topics_last_run')) || 'null');
  } catch {}
  return NextResponse.json({
    today: istDay(),
    lastRun,
    topics: rows.map((r) => ({
      ...r,
      keywords: JSON.parse(r.keywords || '[]'),
      sources: JSON.parse(r.sources || '[]'),
      comparison: r.comparison ? JSON.parse(r.comparison) : null,
      draft: r.draft_id ? byDraft.get(r.draft_id) || null : null,
      article: r.article_draft_id ? byDraft.get(r.article_draft_id) || null : null,
      audit: r.audit_id ? byAudit.get(r.audit_id) || null : null,
    })),
  });
}

// POST { action: 'research' }: run today's research now (again).
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  if (body.action !== 'research') return NextResponse.json({ error: 'action must be research' }, { status: 400 });
  // Runs in the background; the page polls.
  void researchTopics(new Date(), { force: true }).catch(() => {});
  return NextResponse.json({ started: true }, { status: 202 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
