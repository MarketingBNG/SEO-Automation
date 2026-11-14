// Topics & News as the page shows it: today's topics (news from the last 24 hours and evergreen),
// plus older topics someone already started on. Untouched topics from earlier days are not shown.
// Shared by GET /api/topics and the assistant's list_topics.
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { istDay, linkTopicBlogs } from '@/lib/topics';

export async function topicsView() {
  const today = istDay();
  const found = await prisma.topics.findMany({ where: { OR: [{ day: today }, { status: { not: 'new' } }] }, orderBy: [{ day: 'desc' }, { id: 'asc' }], take: 70 });
  // A blog whose run lost its link (restart) is linked now; one that failed can be started again.
  const changed = await linkTopicBlogs(found).catch(() => new Map());
  const rows = found.map((r) => changed.get(r.id) || r);
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
  return {
    today,
    lastRun,
    topics: rows.map((r) => ({
      ...r,
      keywords: JSON.parse(r.keywords || '[]'),
      sources: JSON.parse(r.sources || '[]'),
      relevance: JSON.parse(r.relevance || 'null'),
      comparison: r.comparison ? JSON.parse(r.comparison) : null,
      draft: r.draft_id ? byDraft.get(r.draft_id) || null : null,
      article: r.article_draft_id ? byDraft.get(r.article_draft_id) || null : null,
      audit: r.audit_id ? byAudit.get(r.audit_id) || null : null,
    })),
  };
}

export const TOPIC_ACTIONS = ['blog', 'article', 'relevance', 'compare', 'finalize'] as const;

// { action: 'blog' | 'article' | 'relevance' | 'compare' | 'finalize', comments? } on one topic, as
// POST /api/topics/[id] (JSON) does it. Each one may spend AI credits.
export async function topicAction(id: number, action: string, comments: string, actor: string | null): Promise<{ status: number; body: any }> {
  const t = await import('@/lib/topics');
  try {
    switch (action) {
      case 'blog':
        return { status: 202, body: await t.startTopicBlog(id) };
      case 'article':
        return { status: 202, body: await t.startTopicArticle(id) };
      case 'relevance':
        return { status: 200, body: await t.explainRelevance(id) };
      case 'compare':
        return { status: 200, body: await t.compareManual(id) };
      case 'finalize':
        return { status: 202, body: await t.finalizeManual(id, String(comments || ''), actor) };
      default:
        return { status: 400, body: { error: 'action must be blog, article, relevance, compare or finalize' } };
    }
  } catch (err: any) {
    if (!err.status) console.error(err);
    return { status: err.status || 500, body: { error: err.message } };
  }
}
