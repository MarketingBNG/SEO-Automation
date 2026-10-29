// Optimise a blog a person wrote (usually uploaded into a draft) for the three pillars without
// rewriting it: keep their sentences and facts, add what SEO, AEO and GEO need (keyword in the
// title and the opening, question headings with direct answers, FAQ from People also ask, links to
// the service page, one clear call to action, meta description). Runs in the background: an audit
// first, then the optimise rewrite, then the result replaces the draft's words with the previous
// version kept for Restore. The audit and its result also show in Check a blog.
import prisma from './prisma';
import * as activity from './activity';
import { auditBlog, rewriteBlog } from './anthropic';
import { startTimer, endTimer } from './jobTimer';
import { recordChange } from './contentChanges';
import { markEditedAsChecked } from './factCheckMark';
import { sqlNow } from './time';

const running = new Set<number>();
export const isOptimising = (draftId: number) => running.has(draftId);
const words = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

export async function startOptimise(draftId: number, actor?: string | null) {
  const d = await prisma.drafts.findUnique({ where: { id: draftId } });
  if (!d) throw Object.assign(new Error('Draft not found'), { status: 404 });
  if (words(d.content_html || '') < 150) throw Object.assign(new Error('This draft has almost no text to optimise.'), { status: 400 });
  if (d.status === 'published') throw Object.assign(new Error('This blog is already published. Use Refresh a live blog for a live post.'), { status: 409 });
  if (running.has(draftId)) throw Object.assign(new Error('An optimisation of this draft is already running.'), { status: 409 });
  running.add(draftId);
  void run(d, actor || null).finally(() => running.delete(draftId));
  return { started: true };
}

async function run(d: any, actor: string | null) {
  const key = `optimise-${d.id}`;
  startTimer(key, 'rewrite', `Optimise for SEO, AEO and GEO: ${d.title || `draft ${d.id}`}`);
  const audit = await prisma.blog_audits.create({
    data: { title: d.title, content_html: d.content_html, word_count: words(d.content_html), audit_status: 'running', issues: '[]', suggestions: '[]', facts: '[]', draft_id: d.id, mode: 'optimise' },
  });
  try {
    const a: any = await auditBlog({ title: d.title, content: d.content_html });
    await prisma.blog_audits.update({
      where: { id: audit.id },
      data: { verdict: a.verdict, summary: a.summary, issues: JSON.stringify(a.issues || []), suggestions: JSON.stringify(a.suggestions || []), facts: JSON.stringify(a.facts || []), people_also_ask: JSON.stringify(a.peopleAlsoAsk || []), audit_status: 'ready', audit_error: null, rewrite_status: 'generating' },
    });
    const r: any = await rewriteBlog({ title: d.title, content: d.content_html, issues: a.issues || [], suggestions: a.suggestions || [], mode: 'optimise' });
    const fresh = await prisma.drafts.findUnique({ where: { id: d.id } });
    if (!fresh) throw new Error('The draft was deleted while it was being optimised.');
    const change = await recordChange({
      entityType: 'draft',
      entityId: d.id,
      kind: 'optimise',
      actor: actor || 'Dashboard',
      title: r.title || fresh.title,
      before: { title: fresh.title, meta: fresh.meta_description, html: fresh.content_html || '' },
      after: { title: r.title || fresh.title, meta: r.meta ?? fresh.meta_description, html: r.content },
      keepBefore: true,
    });
    const needsAttention = r.productionState === 'NEEDS_ATTENTION' || r.validation?.passed === false;
    await prisma.drafts.update({
      where: { id: d.id },
      data: {
        title: r.title || fresh.title,
        meta_description: r.meta ?? fresh.meta_description,
        content_html: r.content,
        word_count: words(r.content),
        production_state: needsAttention ? 'NEEDS_ATTENTION' : 'READY_FOR_REVIEW',
        validation_issues: JSON.stringify(needsAttention ? r.validation?.issues || [] : []),
        updated_at: sqlNow(),
      },
    });
    await prisma.blog_audits.update({
      where: { id: audit.id },
      data: { rewrite_title: r.title, rewrite_content_html: r.content, rewrite_meta: r.meta || null, rewrite_people_also_ask: JSON.stringify(r.peopleAlsoAsk || []), rewrite_status: 'ready', rewrite_error: null },
    });
    // An AI edit: the text is fact-checked again before it can publish on its own.
    await markEditedAsChecked(d.id, 'Optimise for SEO, AEO and GEO', { byPerson: false }).catch(() => {});
    await activity.log('draft.optimised', { entityType: 'draft', entityId: d.id, details: `"${fresh.title}": ${change?.report.summary || 'no change to the words'}`, actor });
    await endTimer(key, true);
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 500);
    await prisma.blog_audits.update({ where: { id: audit.id }, data: { audit_status: 'failed', audit_error: message, rewrite_status: null } }).catch(() => {});
    await activity.log('draft.optimise_failed', { entityType: 'draft', entityId: d.id, details: `"${d.title}": ${message.slice(0, 200)}`, actor });
    await endTimer(key, false);
  }
}
