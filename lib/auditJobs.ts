// Audits and rewrites as background jobs. A request used to hold the connection for the whole
// Claude call (minutes); the proxy cut it off and the page got an HTML error page instead of
// JSON ("Unexpected token '<'"). Now the request creates or marks the row and returns at once;
// the work runs here, the row carries its state, and the page polls the list.
import prisma from './prisma';
import { auditBlog, rewriteBlog } from './anthropic';
import { wordCount } from './validation';
import { getPost } from './wordpress';
import * as activity from './activity';
import { startTimer, endTimer } from './jobTimer';
import { parseAuditRow } from './audits';
import { findPreviousAudit, recordChange } from './contentChanges';
import { diffContent } from './contentDiff';
import { safeFetchText } from './safeFetch';

const g = globalThis as unknown as { __auditJobs?: Set<number>; __auditStops?: Map<string, AbortController> };
const running = (g.__auditJobs ||= new Set<number>());
// One controller per running audit or rewrite, so a person can stop it (Stop in the progress bar).
const stops = (g.__auditStops ||= new Map<string, AbortController>());
const STALE_MIN = 45;

function titleFromHtml(html: string): string | null {
  const m = String(html).match(/<title[^>]*>([^<]+)<\/title>/i) || String(html).match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return m ? m[1].trim() : null;
}

// Creates the row (content fetched now, which is quick) and starts the audit in the background.
export async function startAudit({ title, contentHtml, sourceUrl, wpPostId, actor, draftId, mode }: any) {
  let content = contentHtml;
  let resolvedTitle = title;
  let resolvedUrl = sourceUrl || null;
  if (wpPostId) {
    const post = await getPost(wpPostId);
    content = post.content.rendered;
    resolvedTitle = resolvedTitle || post.title.rendered;
    resolvedUrl = post.link;
  } else if (sourceUrl && !content) {
    const pageRes = await safeFetchText(sourceUrl, { timeoutMs: 20000 });
    if (!pageRes.ok) throw Object.assign(new Error(`Could not fetch that URL (HTTP ${pageRes.status})`), { status: 400 });
    content = pageRes.text;
  }
  if (!content || !content.trim()) throw Object.assign(new Error('Provide contentHtml, a sourceUrl, or a wpPostId'), { status: 400 });
  if (!resolvedTitle && sourceUrl) resolvedTitle = titleFromHtml(content);

  // One audit per post at a time: a running one is returned instead of starting a second.
  if (wpPostId) {
    const open = await prisma.blog_audits.findFirst({ where: { wp_post_id: wpPostId, audit_status: 'running' } });
    if (open) return parseAuditRow(open);
  }
  // A re-upload of a piece audited before: what changed is recorded, shown, and verified first.
  const previous = !wpPostId ? await findPreviousAudit(resolvedTitle, content).catch(() => null) : null;
  const changes = previous ? diffContent({ title: previous.title, html: previous.content_html || '' }, { title: resolvedTitle, html: content }) : null;
  const changed = changes && changes.kind !== 'none';
  const row = await prisma.blog_audits.create({
    data: {
      title: resolvedTitle || null, source_url: resolvedUrl, content_html: content, word_count: wordCount(content), wp_post_id: wpPostId || null, wp_post_url: wpPostId ? resolvedUrl : null, audit_status: 'running', issues: '[]', suggestions: '[]', facts: '[]',
      previous_audit_id: previous?.id || null, changes_summary: changed ? changes!.summary : previous ? 'Same words as the earlier upload.' : null, draft_id: draftId || null, mode: mode || null,
    },
  });
  if (previous && changed) {
    await recordChange({ entityType: 'audit', entityId: row.id, kind: 'reupload', actor, title: resolvedTitle, before: { title: previous.title, html: previous.content_html || '' }, after: { title: resolvedTitle, html: content }, previousId: previous.id }).catch(() => null);
    await activity.log('audit.reupload', { entityType: 'blog_audit', entityId: row.id, details: `"${resolvedTitle || 'untitled'}" uploaded again (earlier audit #${previous.id}): ${changes!.summary}`, actor }).catch(() => {});
  }
  const reverify = changed ? changes!.samples.filter((s) => s.type !== 'removed' && s.after).map((s) => s.after as string) : [];
  void runAudit(row.id, { title: resolvedTitle, content, sourceUrl: resolvedUrl, actor, reverify });
  return parseAuditRow(row);
}

async function runAudit(id: number, { title, content, sourceUrl, actor, reverify }: any) {
  running.add(id);
  const key = `audit-${id}`;
  const stop = new AbortController();
  stops.set(key, stop);
  startTimer(key, 'audit', `Audit: ${title || sourceUrl || `#${id}`}`);
  try {
    const result = await auditBlog({ title, content, sourceUrl, signal: stop.signal, reverify });
    await prisma.blog_audits.update({
      where: { id },
      data: { verdict: result.verdict, summary: result.summary, issues: JSON.stringify(result.issues), suggestions: JSON.stringify(result.suggestions), facts: JSON.stringify(result.facts), people_also_ask: JSON.stringify(result.peopleAlsoAsk || []), audit_status: 'ready', audit_error: null },
    });
    await activity.log('audit.completed', { entityType: 'blog_audit', entityId: id, details: `"${title || sourceUrl}" → ${result.verdict}, ${result.issues.length} issue(s)`, actor });
    await endTimer(key, true);
  } catch (err: any) {
    if (stop.signal.aborted) {
      const by = String(stop.signal.reason || 'someone');
      await prisma.blog_audits.update({ where: { id }, data: { audit_status: 'failed', audit_error: `Stopped by ${by}. Run the audit again when you want it.` } }).catch(() => {});
      await activity.log('audit.stopped', { entityType: 'blog_audit', entityId: id, details: `"${title || sourceUrl}": audit stopped`, actor: by }).catch(() => {});
    } else {
      await prisma.blog_audits.update({ where: { id }, data: { audit_status: 'failed', audit_error: String(err?.message || err).slice(0, 500) } }).catch(() => {});
      await activity.log('audit.failed', { entityType: 'blog_audit', entityId: id, details: `"${title || sourceUrl}": ${String(err?.message || err).slice(0, 200)}`, actor }).catch(() => {});
    }
    await endTimer(key, false);
  } finally {
    running.delete(id);
    stops.delete(key);
  }
}

// Marks the row and starts the rewrite in the background.
// mode 'optimise': keep the author's text and facts, add only what SEO, AEO and GEO need.
export async function startRewrite(id: number, actor?: string | null, opts: { mode?: 'optimise' } = {}) {
  const audit: any = await prisma.blog_audits.findUnique({ where: { id } });
  if (!audit) throw Object.assign(new Error('Audit not found'), { status: 404 });
  if (!audit.content_html) throw Object.assign(new Error('This audit was run from a URL without saving content, so there is nothing to rewrite from. Re-run the audit with pasted content or a file upload.'), { status: 400 });
  if (audit.audit_status === 'running') throw Object.assign(new Error('The audit is still running. Wait for it to finish, then rewrite.'), { status: 409 });
  if (audit.rewrite_status === 'generating' && running.has(id)) return parseAuditRow(audit);
  const row = await prisma.blog_audits.update({ where: { id }, data: { rewrite_status: 'generating', rewrite_error: null, mode: opts.mode || null } });
  void runRewrite(row, actor);
  return parseAuditRow(row);
}

async function runRewrite(audit: any, actor?: string | null) {
  const id = audit.id;
  running.add(id);
  const key = `rewrite-${id}`;
  const stop = new AbortController();
  stops.set(key, stop);
  startTimer(key, 'rewrite', `Rewrite: ${audit.title || `#${id}`}`);
  try {
    const result: any = await rewriteBlog({ title: audit.title, content: audit.content_html, issues: JSON.parse(audit.issues || '[]'), suggestions: JSON.parse(audit.suggestions || '[]'), signal: stop.signal, mode: audit.mode || undefined });
    await prisma.blog_audits.update({
      where: { id },
      data: { rewrite_title: result.title, rewrite_content_html: result.content, rewrite_meta: result.meta || null, rewrite_people_also_ask: JSON.stringify(result.peopleAlsoAsk || []), rewrite_status: 'ready', rewrite_error: null },
    });
    await recordChange({ entityType: 'audit', entityId: id, kind: audit.mode === 'optimise' ? 'optimise' : 'rewrite', actor, title: result.title || audit.title, before: { title: audit.title, html: audit.content_html || '' }, after: { title: result.title, meta: result.meta, html: result.content } }).catch(() => null);
    await activity.log('audit.rewritten', { entityType: 'blog_audit', entityId: id, details: `"${result.title}", ${result.productionState}, ${result.repairAttempts} repair attempt(s)${audit.mode === 'optimise' ? ', optimised keeping the author\'s text' : ''}`, actor });
    await endTimer(key, true);
  } catch (err: any) {
    const stopped = stop.signal.aborted;
    const by = String(stop.signal.reason || 'someone');
    const message = stopped ? `Stopped by ${by}. Rewrite again when you want it.` : String(err?.message || err).slice(0, 500);
    await prisma.blog_audits.update({ where: { id }, data: { rewrite_status: audit.rewrite_content_html ? 'ready' : null, rewrite_error: message } }).catch(() => {});
    if (stopped) await activity.log('audit.rewrite_stopped', { entityType: 'blog_audit', entityId: id, details: `"${audit.title}": rewrite stopped`, actor: by }).catch(() => {});
    else await activity.log('audit.rewrite_failed', { entityType: 'blog_audit', entityId: id, details: `"${audit.title}": ${String(err?.message || err).slice(0, 200)}`, actor }).catch(() => {});
    await endTimer(key, false);
  } finally {
    running.delete(id);
    stops.delete(key);
  }
}

// Stops a running audit or rewrite (key "audit-<id>" or "rewrite-<id>"). The AI call in flight is
// cut off, so no more credits are spent on it. A job lost to a restart is just marked stopped.
export async function stopJob(key: string, by: string): Promise<boolean> {
  const m = /^(audit|rewrite)-(\d+)$/.exec(key);
  if (!m) throw Object.assign(new Error('Unknown job'), { status: 400 });
  const ctl = stops.get(key);
  if (ctl) {
    ctl.abort(by);
    return true;
  }
  const id = Number(m[2]);
  const row: any = await prisma.blog_audits.findUnique({ where: { id }, select: { audit_status: true, rewrite_status: true, rewrite_content_html: true } });
  if (!row) throw Object.assign(new Error('Audit not found'), { status: 404 });
  if (m[1] === 'audit' && row.audit_status === 'running') await prisma.blog_audits.update({ where: { id }, data: { audit_status: 'failed', audit_error: `Stopped by ${by}.` } });
  else if (m[1] === 'rewrite' && row.rewrite_status === 'generating') await prisma.blog_audits.update({ where: { id }, data: { rewrite_status: row.rewrite_content_html ? 'ready' : null, rewrite_error: `Stopped by ${by}.` } });
  else return false;
  return true;
}

// A job this server process is not running (it was lost to a restart) is marked so the page
// does not wait forever. Called from the list route.
export async function markLostJobs() {
  const rows = await prisma.blog_audits.findMany({ where: { OR: [{ audit_status: 'running' }, { rewrite_status: 'generating' }] }, select: { id: true, audit_status: true, rewrite_status: true, created_at: true, rewrite_content_html: true } });
  const cutoff = Date.now() - 2 * 60000;
  for (const r of rows) {
    if (running.has(r.id)) continue;
    // Give a job started by another process (or just now) two minutes before calling it lost.
    const started = Date.parse(String(r.created_at).replace(' ', 'T') + 'Z');
    if (r.audit_status === 'running' && started > cutoff) continue;
    const data: any = {};
    if (r.audit_status === 'running') Object.assign(data, { audit_status: 'failed', audit_error: 'Cut off by a server restart. Run the audit again.' });
    if (r.rewrite_status === 'generating') Object.assign(data, { rewrite_status: r.rewrite_content_html ? 'ready' : null, rewrite_error: 'Cut off by a server restart. Rewrite again.' });
    if (Object.keys(data).length) await prisma.blog_audits.update({ where: { id: r.id }, data }).catch(() => {});
  }
}
export const staleAfterMinutes = STALE_MIN;
