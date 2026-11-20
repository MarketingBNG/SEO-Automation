// Post my blog: the owner's own blog (a Word file or pasted text/HTML) goes into Drafts & Review and,
// when asked, straight onto the website, as it is. Every extra check is the person's choice, all off
// by default:
//  - fact_check: the existing fact check reads the text (AI credits); a claim it finds wrong stops
//    the post, and the blog is saved to Drafts with the issues shown. The text is never changed.
//  - originality: the paid plagiarism check, the same one Drafts & Review runs before publishing.
//  - optimise: lib/optimise.ts keeps the person's words and adds what SEO needs; the blog is saved to
//    Drafts (never posted) so the person reviews it and posts it from there.
//  - ask_reviewer: the CA/CPA reviewer's name is required and printed in the byline.
// The free checks that protect the live page always run (reviewer placeholders, AI notes, the website
// connection), and the post goes through the same publish code as Drafts & Review (lib/publishDraft.ts).
// Only a person who may publish straight away (blog.publish_now) can post now; others save to Drafts.
// Used by /api/my-blog and the assistant's post_my_blog tool.
import { allTicked } from './publishChecklist';
import sharp from 'sharp';
import prisma from './prisma';
import * as activity from './activity';
import { sqlNow } from './time';
import { saveFile } from './storage';
import { recordChange } from './contentChanges';
import { UPLOAD_PREFIX } from './blogImages';
import { dataImages } from './wordImport';
import { extractClaims } from './strategy/core';
import { sanitizeHtml } from './htmlSanitize';
import { CREDENTIAL, expertReviewers } from './reviewers';
import { publishDraft, canPublishNow, liveTextProblem, type PublishMe, type PublishResult } from './publishDraft';

export const MY_BLOGS_BATCH = 'My blogs';

export type MyBlogInput = {
  title: string;
  html: string; // the article: HTML, or plain text (paragraphs split on blank lines)
  meta_description?: string | null;
  keyword?: string | null; // defaults to the title
  author?: string | null; // defaults to one of the blog authors when it goes live
  reviewer?: string | null;
  mode: 'post' | 'save';
  fact_check?: boolean;
  originality?: boolean;
  optimise?: boolean;
  ask_reviewer?: boolean;
  cover_key?: string | null; // a banner chosen in the preview (covers/candidate-...)
  cover_data?: string | null; // an uploaded banner, or the picture above the title in the Word file (data: URI)
  request_key?: string | null; // one per submission from the form: a retry returns the same draft, never a second post
  checklist?: any; // posting live: the publish checklist {author, title, content, banner} ticked on the form
};

// check: the fact check, injectable; the default is the dashboard's own (lib/anthropic.ts factCheckDraft).
export type MyBlogDeps = { me: PublishMe; actor?: string | null; check?: (article: { title: string; meta: string; content: string; facts: any[] }, opts: { mustCheck: string[] }) => Promise<{ checks: any[] }> };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const wordCount = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

// Pasted plain text becomes paragraphs; HTML goes through the allowlist cleaner (lib/htmlSanitize.ts):
// only article tags and safe links and pictures survive. The website prints the title as the H1, so
// an H1 inside the article becomes an H2.
export function articleHtml(input: string): string {
  const raw = String(input || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';
  if (!/<(p|h[1-6]|ul|ol|li|div|table|br|strong|em|a|img|blockquote)\b/i.test(raw)) {
    return raw
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }
  return sanitizeHtml(raw).replace(/<p>\s*<\/p>/gi, '').trim();
}

async function imageKey(bytes: Buffer, name: string): Promise<string | null> {
  const format = await sharp(bytes).metadata().then((m) => m.format as string).catch(() => '');
  if (!EXT[format] || bytes.length > MAX_IMAGE_BYTES) return null;
  return saveFile(`${name}${EXT[format]}`, bytes);
}

// Pictures pasted or in the Word file (data: URIs) are stored like an uploaded image, so the website
// gets them as files. A picture that is not PNG, JPG, WebP or GIF under 8 MB is dropped (and said).
async function storeImages(html: string, draftId: number): Promise<{ html: string; dropped: number }> {
  let out = html;
  let dropped = 0;
  for (const [n, img] of dataImages(html).entries()) {
    const key = await imageKey(Buffer.from(img.base64, 'base64'), `inline/draft-${draftId}-${Date.now()}-${n}`).catch(() => null);
    if (!key) dropped++;
    out = out.replace(img.tag, key ? `<img src="${UPLOAD_PREFIX}${encodeURI(key)}" alt="${escAttr(img.alt)}" />` : '');
  }
  return { html: out.replace(/<p>\s*<\/p>/gi, ''), dropped };
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): PublishResult => ({ status, body: { error, ...extra } });

// A fact check that did not really check: a checker that failed, gave no verdict, listed no claims or
// could not be read comes back as "unverifiable" (lib/anthropic.ts). Returns why the result cannot
// be trusted, or null when the claims were really checked.
const CHECK_FAILED = /check for this claim failed|checker gave no verdict|no claims could be listed|output could not be read/i;
export function factCheckFailure(checks: any[]): string | null {
  if (!checks.length) return 'The fact check gave no result.';
  const failed = checks.filter((c) => c?.verdict !== 'correct' && c?.verdict !== 'incorrect' && CHECK_FAILED.test(`${c?.claim || ''} ${c?.correction || ''}`));
  if (failed.length) return `The fact check did not finish: ${failed.length} of ${checks.length} check${checks.length > 1 ? 's' : ''} failed or gave no verdict (for example "${String(failed[0].claim || '').slice(0, 120)}").`;
  if (!checks.some((c) => c?.verdict === 'correct')) return `The fact check could not confirm any of the ${checks.length} claim${checks.length > 1 ? 's' : ''}.`;
  return null;
}

// Submissions running now, by request key, so a double press waits instead of saving twice.
const running = new Set<string>();
const REQUEST_KEY = /^[a-z0-9-]{8,80}$/i;

export async function postMyBlog(input: MyBlogInput, deps: MyBlogDeps): Promise<PublishResult> {
  const key = REQUEST_KEY.test(String(input.request_key || '')) ? `my-blog:${input.request_key}` : null;
  if (!key) return postOnce(input, deps, null);
  if (running.has(key)) return fail(409, 'This blog is being saved or posted right now. Wait a minute, then look for it in Drafts & Review.');
  // Claimed before any await, so a second press arriving meanwhile sees it.
  running.add(key);
  try {
    // The same submission again (a retry after an error or a cut-off answer): its draft is returned,
    // and nothing is saved or posted a second time.
    const earlier = await prisma.keywords.findFirst({ where: { notes: key, batch_name: MY_BLOGS_BATCH }, orderBy: { id: 'desc' }, include: { drafts: { select: { id: true, status: true, wp_post_url: true }, orderBy: { id: 'asc' }, take: 1 } } });
    const d = earlier?.drafts[0];
    if (d) {
      const live = d.status === 'published' && d.wp_post_url;
      return {
        status: 200,
        body: { draftId: d.id, saved: true, duplicate: true, posted: Boolean(live), url: live ? d.wp_post_url : undefined, notes: [], message: live ? `Already live on the website: ${d.wp_post_url}` : `Already saved as draft #${d.id}; nothing was sent again. Open it in Drafts & Review to publish it.` },
      };
    }
    return await postOnce(input, deps, key);
  } finally {
    running.delete(key);
  }
}

async function postOnce(input: MyBlogInput, deps: MyBlogDeps, requestKey: string | null): Promise<PublishResult> {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const meta = String(input.meta_description || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const keyword = String(input.keyword || '').replace(/\s+/g, ' ').trim().slice(0, 200) || title;
  const author = String(input.author || '').trim().slice(0, 120) || null;
  const reviewer = String(input.reviewer || '').trim().slice(0, 160);
  const optimise = Boolean(input.optimise);
  // Optimise changes the words, so the person reviews it in Drafts and posts it from there.
  const post = input.mode === 'post' && !optimise;
  let html = articleHtml(input.html);

  if (!title) return fail(400, 'Give the blog a title.');
  if (wordCount(html.replace(/<img\b[^>]*>/gi, '')) < 50) return fail(400, 'The blog has almost no text (under 50 words). Upload the Word file or paste the whole article.');
  if (input.mode !== 'post' && input.mode !== 'save') return fail(400, 'mode must be "post" or "save".');
  if (input.mode === 'post' && !(await canPublishNow(deps.me))) {
    return fail(403, 'Only an admin or a manager can post a blog live straight away. Press "Save to Drafts" instead; an admin or manager can publish it from Drafts & Review.');
  }
  if (post) {
    // The publish checklist, ticked on the form against the author, title, text and banner shown.
    if (!author) return fail(400, 'Pick the author before posting live, so it can be checked. Nothing was posted or saved.');
    if (!allTicked(input.checklist)) return fail(400, 'Tick the publish checklist first (Author, Title, Blog text, Banner). Nothing was posted or saved.');
    // The free checks first, before anything is saved or any credit spent: the text is still in the form.
    const blocked = liveTextProblem({ title, meta_description: meta, content_html: html });
    if (blocked) return fail(400, `${blocked} Nothing was posted or saved.`);
    if (input.ask_reviewer) {
      const known = await expertReviewers();
      if (!reviewer || (!known.includes(reviewer) && !CREDENTIAL.test(reviewer))) {
        return fail(400, 'Name the CA/CPA who reviewed this blog (for example "Amit Agarwal, CA"), or untick "Ask for the CA/CPA reviewer name". Nothing was posted or saved.');
      }
    }
  }

  // The draft waits for review; it is approved only just before it is published (after any checks).
  // The keyword row is made in the same write, so a failure never leaves one without its draft.
  const draft = await prisma.drafts.create({
    data: {
      keyword: { create: { keyword, batch_name: MY_BLOGS_BATCH, status: 'done', notes: requestKey } },
      title,
      meta_description: meta || null,
      content_html: html,
      word_count: wordCount(html),
      status: 'pending_review',
      production_state: 'READY_FOR_REVIEW',
      validation_issues: '[]',
      author,
    },
  });
  const id = draft.id;
  const notes: string[] = [];
  const stored = await storeImages(html, id);
  if (stored.html !== html) {
    html = stored.html;
    await prisma.drafts.update({ where: { id }, data: { content_html: html, word_count: wordCount(html) } });
  }
  if (stored.dropped) notes.push(`${stored.dropped} picture${stored.dropped > 1 ? 's' : ''} could not be kept (only PNG, JPG, WebP or GIF under 8 MB).`);

  // The banner the person chose (preview or upload). Posting uses it; no automatic banner replaces it.
  let cover: string | null = null;
  if (input.cover_key) {
    const { checkCandidate } = await import('./coverPhoto');
    cover = await checkCandidate(input.cover_key);
    if (!cover) notes.push('The chosen banner was not found, so the usual banner is made instead.');
  } else if (input.cover_data) {
    const m = String(input.cover_data).match(/^data:image\/[\w.+-]+;base64,(.+)$/);
    cover = m ? await imageKey(Buffer.from(m[1], 'base64'), `draft-${id}-${Date.now()}`).catch(() => null) : null;
    if (!cover) notes.push('The banner picture could not be used (only PNG, JPG, WebP or GIF under 8 MB), so the usual banner is made instead.');
  }
  if (cover) await prisma.drafts.update({ where: { id }, data: { featured_image_path: cover } });

  const actor = deps.actor || null;
  await recordChange({ entityType: 'draft', entityId: id, kind: 'upload', actor: actor || 'Dashboard', title, before: { title: null, meta: null, html: '' }, after: { title, meta, html } }).catch(() => null);
  const picked = [input.fact_check && 'fact check', input.originality && 'originality check', optimise && 'optimise for SEO', input.ask_reviewer && 'CA/CPA reviewer'].filter(Boolean);
  await activity.log('draft.my_blog', {
    entityType: 'draft',
    entityId: id,
    details: `"${title}" added by Post my blog (${post ? 'post now' : optimise ? 'optimise, then review' : 'save to Drafts'}; checks: ${picked.length ? picked.join(', ') : 'none'})`,
    actor,
  }).catch(() => {});
  const saved = { draftId: id, saved: true, notes };

  // Fact check (AI credits): a claim found wrong stops the post and is shown on the draft.
  if (input.fact_check) {
    let checks: any[] = [];
    try {
      const { timed } = await import('./jobTimer');
      const run = deps.check || (async (article, opts) => (await import('./anthropic')).factCheckDraft(article, undefined, opts));
      const result = await timed(`factcheck-${id}`, 'fact-check', `Fact check (Post my blog): ${title}`, () => run({ title, meta, content: html, facts: [] }, { mustCheck: extractClaims(html).map((c) => c.sentence) }));
      checks = Array.isArray(result?.checks) ? result.checks : [];
    } catch (e: any) {
      return fail(503, `The fact check could not run (${String(e?.message || e).slice(0, 200)}), so the blog was not posted. It is saved in Drafts & Review.`, { ...saved, posted: false });
    }
    const wrong = checks.filter((c) => c?.verdict === 'incorrect');
    const unsure = checks.filter((c) => c?.verdict === 'unverifiable');
    const issueText = (c: any) => `Fact check: "${String(c.claim || '').slice(0, 300)}" is wrong.${c.correction ? ` Correct: ${String(c.correction).slice(0, 400)}` : ''}${c.source_url ? ` (source: ${c.source_url})` : ''}`;
    const warnings = unsure.map((c) => `Fact check could not confirm: "${String(c.claim || '').slice(0, 300)}"`);
    if (wrong.length) {
      const issues = wrong.map(issueText);
      await prisma.drafts.update({ where: { id }, data: { production_state: 'NEEDS_ATTENTION', validation_issues: JSON.stringify(issues), validation_warnings: JSON.stringify(warnings), updated_at: sqlNow() } });
      await activity.log('draft.my_blog_fact_check', { entityType: 'draft', entityId: id, details: `"${title}": ${wrong.length} claim(s) wrong, not posted`, actor }).catch(() => {});
      return { status: 200, body: { ...saved, posted: false, factCheck: { wrong: wrong.length, unconfirmed: unsure.length }, issues, warnings, message: `The fact check found ${wrong.length} wrong claim${wrong.length > 1 ? 's' : ''}, so the blog was not posted. It is saved in Drafts & Review with the issues shown.` } };
    }
    // Not really checked (an outage, no verdicts, nothing listed): never posted as if it were.
    const failure = factCheckFailure(checks);
    if (failure) {
      const issues = [`${failure} Run the fact check again, or post without it.`];
      await prisma.drafts.update({ where: { id }, data: { production_state: 'NEEDS_ATTENTION', validation_issues: JSON.stringify(issues), validation_warnings: JSON.stringify(warnings), updated_at: sqlNow() } });
      await activity.log('draft.my_blog_fact_check', { entityType: 'draft', entityId: id, details: `"${title}": ${failure} Not posted.`, actor }).catch(() => {});
      return { status: 200, body: { ...saved, posted: false, factCheck: { wrong: 0, unconfirmed: unsure.length, failed: true }, issues, warnings, message: `${failure} So the blog was not posted. It is saved in Drafts & Review.` } };
    }
    if (warnings.length) await prisma.drafts.update({ where: { id }, data: { validation_warnings: JSON.stringify(warnings) } });
    notes.push(`Fact check: no wrong claim found${unsure.length ? ` (${unsure.length} could not be confirmed; see the draft)` : ''}.`);
  }

  if (optimise) {
    const { startOptimise } = await import('./optimise');
    try {
      await startOptimise(id, actor);
    } catch (e: any) {
      return { status: 200, body: { ...saved, posted: false, message: `Saved to Drafts & Review. Optimise could not start: ${e.message}` } };
    }
    return { status: 200, body: { ...saved, posted: false, optimising: true, message: 'Saved to Drafts & Review. Optimise for SEO is running (a few minutes); review the result there, then publish it.' } };
  }

  if (!post) {
    if (input.originality) {
      const { checkDraftOriginality, originalityReason } = await import('./originality');
      const r = await checkDraftOriginality(id).catch(() => null);
      if (r) notes.push(r.ok ? 'Originality check: passed.' : originalityReason(r));
    }
    return { status: 200, body: { ...saved, posted: false, message: 'Saved to Drafts & Review.' } };
  }

  await prisma.drafts.update({ where: { id }, data: { status: 'approved', updated_at: sqlNow() } });
  const r = await publishDraft(id, {
    wpStatus: 'publish',
    reviewer: reviewer || null,
    skipExpert: !input.ask_reviewer,
    requireReviewer: Boolean(input.ask_reviewer),
    skipOriginality: !input.originality,
    checklist: input.checklist,
    me: deps.me,
    actor: actor || undefined,
  });
  if (r.status !== 200) {
    return { status: r.status, body: { ...r.body, ...saved, posted: false, error: `${r.body?.error || 'The blog could not be posted.'} The blog is saved in Drafts & Review; publish it from there once this is fixed.` } };
  }
  return { status: 200, body: { ...r.body, ...saved, posted: true, url: r.body.wpPostUrl, message: `Live on the website: ${r.body.wpPostUrl}` } };
}
