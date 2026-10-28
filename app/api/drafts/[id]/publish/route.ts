import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensurePhotoCover } from '@/lib/coverPhoto';
import { uploadMedia, publishPost, updatePost, seoSlug, freeSlug, wpRequest, wpConfigured, draftsRefused } from '@/lib/wordpress';
import * as activity from '@/lib/activity';
import { getActor, getMe } from '@/lib/auth';
import { canDo } from '@/lib/access';
import { sqlNow } from '@/lib/time';
import { methodNotAllowed, toId } from '../../../_lib/http';
import { aiLeftovers, needsExpertReview, faqSchema, faqAccordion } from '@/lib/strategy/core';
import { CREDENTIAL, expertReviewers, requireExpert } from '@/lib/reviewers';
import { withByline, expertSchema } from '@/lib/byline';
import { authorNames, pickAuthor, wpAuthorId } from '@/lib/authors';
import { publishDraftImages } from '@/lib/inlineMedia';
import { makeCover, coverAlt } from '@/lib/cover';
import { saveFile } from '@/lib/storage';
import { ensureOriginality, originalityReason } from '@/lib/originality';
import { claimPublish } from '@/lib/strategy/publishLock';
import { wordsHash } from '@/lib/factCheckMark';

export const runtime = 'nodejs';

// 'publish', 'draft', 'trash'..., or null when the post is gone.
async function wpPostStatus(id: number): Promise<string | null> {
  const { wpRequest } = await import('@/lib/wordpress');
  const r: any = await wpRequest('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit', _fields: 'status' } }).catch(() => null);
  const st = r?.json?.status || null;
  return st === 'trash' ? null : st;
}

// What WordPress holds now: live or not, the address, and whether the FAQ is in the box format.
async function checkPost(id: number, wantSlug: string | undefined, hasFaq: boolean) {
  const { wpRequest } = await import('@/lib/wordpress');
  const r: any = await wpRequest('GET', `/wp/v2/posts/${id}`, { query: { context: 'edit', _fields: 'status,link,slug,content' } }).catch(() => null);
  if (!r?.json) return null;
  const p = r.json;
  // No planned address (a live post or a refresh keeps its own): the current one is right.
  wantSlug = wantSlug || p.slug;
  const raw = String(p.content?.raw || p.content?.rendered || '');
  return {
    live: p.status === 'publish',
    status: p.status,
    link: p.link,
    slugOk: p.slug === wantSlug,
    slug: p.slug,
    wantSlug,
    faqBoxes: hasFaq ? /uic-faq-accordion/.test(raw) : null,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = toId(id);

  const draft: any = await prisma.drafts.findUnique({ where: { id: nid } });
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  // A blog sent to WordPress earlier as a draft (not live) can be sent again: the same post is
  // updated, so no second copy is made.
  let wpLive = draft.wp_post_id ? await wpPostStatus(draft.wp_post_id) : null;
  // A live blog can be sent again too: that updates the same live post (for example after an edit).
  if (draft.status !== 'approved' && !(draft.status === 'published' && draft.wp_post_id)) {
    return NextResponse.json({ error: 'Draft must be approved before publishing' }, { status: 400 });
  }
  if (/\[(PRACTITIONER NOTE NEEDED|VERIFY|AUTHOR NAME|REVIEWER NAME|VISUAL SUGGESTION)/i.test(draft.content_html || '')) {
    return NextResponse.json({ error: 'The draft still has a reviewer placeholder ([AUTHOR NAME], [REVIEWER NAME], [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION] or [VERIFY]). Replace or remove it before publishing.' }, { status: 400 });
  }

  const leftovers = aiLeftovers(draft.title, draft.meta_description, draft.content_html);
  if (leftovers.length) return NextResponse.json({ error: `Remove the AI notes first. ${leftovers.join(' ')}` }, { status: 400 });

  const body: any = await req.json().catch(() => ({}));
  // Only these two: any other value ('future', 'private', 'Publish') would skip the checks below
  // that look for 'publish' while WordPress or the site connector still puts the post live.
  const asked = (body && body.wpStatus) || 'publish';
  if (!['publish', 'draft'].includes(asked)) {
    return NextResponse.json({ error: 'wpStatus must be "publish" or "draft".' }, { status: 400 });
  }
  const wpStatus = wpLive === 'publish' ? 'publish' : asked; // 'publish' (live) or 'draft'
  const reviewer = String(body?.reviewer || '').trim();
  const kw = (await prisma.keywords.findUnique({ where: { id: draft.keyword_id }, select: { keyword: true } }))?.keyword;
  // A calendar blog not yet published: going live here skips its slot, which needs blog.publish_now
  // (as Publish now on the calendar does). Sending it to WordPress as a draft does not.
  const row = await prisma.blog_schedule.findFirst({ where: { draft_id: nid, status: { not: 'published' } }, select: { id: true, refresh_url: true } });
  if (row && wpStatus === 'publish' && wpLive !== 'publish') {
    const me = await getMe();
    if (!me || (me.role !== 'admin' && !(await canDo(me, 'blog.publish_now')))) {
      return NextResponse.json({ error: 'This blog has a slot on the calendar. Only an admin or a manager can publish it straight away; it goes live at its slot otherwise.' }, { status: 403 });
    }
  }
  // A refresh of a live page updates that page (its address, author and cover stay), never a new post.
  // Read with no status filter: a refresh already published by the calendar stays a refresh when it
  // is sent again ("Update the live post"), so its author and cover are still left alone.
  const refreshUrl: string | null =
    row?.refresh_url || (await prisma.blog_schedule.findFirst({ where: { draft_id: nid, refresh_url: { not: null } }, select: { refresh_url: true } }))?.refresh_url || null;
  if (refreshUrl && wpStatus !== 'publish') {
    return NextResponse.json({ error: 'This blog refreshes a live page, so it cannot go to WordPress as a draft (that would take the page offline). Publish it live, or let it publish at its slot.' }, { status: 400 });
  }
  if (wpStatus === 'publish' && (await requireExpert()) && needsExpertReview(kw, draft.title)) {
    const known = await expertReviewers();
    if (!reviewer || (!known.includes(reviewer) && !CREDENTIAL.test(reviewer))) {
      return NextResponse.json({ error: 'This is a tax, legal or compliance blog. Name the CA/CPA who reviewed it before it goes live.', reviewers: known }, { status: 400 });
    }
  }

  // Without a WordPress connection nothing can go out: stop before an author or cover is saved.
  if (!wpConfigured()) {
    await activity.log('wordpress.publish_failed', { entityType: 'draft', entityId: nid, details: `"${draft.title}": WordPress connection is not configured`, actor: await getActor() }).catch(() => {});
    return NextResponse.json({ error: 'WordPress connection is not configured. Set WORDPRESS_SITE_URL, WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD (or the site connector), then publish again.' }, { status: 503 });
  }
  // The website connector refuses drafts (it makes every saved post live): refused here, before the
  // paid checks, the author and cover saves and the image uploads.
  const noDraft = draftsRefused(wpStatus);
  if (noDraft) return NextResponse.json({ error: noDraft }, { status: 400 });
  // The paid originality checks (live SERP searches, Copyscape) run only after the free refusals above.
  const orig = await ensureOriginality(nid).catch(() => null);
  if (orig && !orig.ok) return NextResponse.json({ error: originalityReason(orig) }, { status: 400 });

  // The scheduler (or a second press) may be publishing this blog right now: it is sent once.
  const release = claimPublish(row?.id ?? null, nid);
  if (!release) return NextResponse.json({ error: 'This blog is being published right now. Wait a minute and refresh.' }, { status: 409 });
  try {
    try {
      // Published meanwhile by the calendar (its slot came while this was being checked): not sent again.
      const latest = await prisma.drafts.findUnique({ where: { id: nid }, select: { status: true, wp_post_id: true, wp_post_url: true, title: true, meta_description: true, content_html: true } });
      if (!latest) return NextResponse.json({ error: 'The draft was deleted while it was being checked, so it was not published.' }, { status: 409 });
      if (draft.status !== 'published' && latest.status === 'published') {
        return NextResponse.json({ error: `It was published meanwhile at its calendar slot: ${latest.wp_post_url || ''}`.trim() }, { status: 409 });
      }
      // Rejected, or its words edited, by someone else while the checks above ran: the words checked
      // are not what the draft holds now, so nothing is sent. Pressing Publish again checks the new state.
      if (latest.status !== draft.status) {
        return NextResponse.json({ error: `The draft was moved to "${latest.status}" while it was being checked, so it was not published.` }, { status: 409 });
      }
      if (wordsHash(latest) !== wordsHash(draft)) {
        return NextResponse.json({ error: 'The draft was edited while it was being checked, so it was not published. Refresh and press Publish again to send the saved version.' }, { status: 409 });
      }
      // Sent to WordPress as a draft meanwhile (another tab): that post is updated, not a second one made.
      if (latest?.wp_post_id && latest.wp_post_id !== draft.wp_post_id) {
        draft.wp_post_id = latest.wp_post_id;
        wpLive = await wpPostStatus(latest.wp_post_id);
      }
      const keyword = kw;
      // A refresh keeps the live page's author: no partner is picked for it (as the calendar does).
      const author = refreshUrl ? draft.author || null : draft.author || pickAuthor(await authorNames());
      if (!draft.author && author) await prisma.drafts.update({ where: { id: nid }, data: { author } });
      const authorId = refreshUrl ? null : await wpAuthorId(author).catch(() => null);

      // The cover: the uploaded one, or the branded cover made from the title and author (the same
      // one the preview and the Word file show).
      let imageKey = refreshUrl ? null : draft.featured_image_path || (await ensurePhotoCover(nid).catch(() => null));
      if (!imageKey && !refreshUrl) {
        imageKey = await saveFile(`covers/${Date.now()}-${seoSlug(keyword || draft.title)}.png`, await makeCover(draft.title, author), 'image/png').catch(() => null);
        if (imageKey) await prisma.drafts.update({ where: { id: nid }, data: { featured_image_path: imageKey } });
      }
      // It goes to the Media Library with its alt text (what the picture shows), so Google reads it.
      const cover = imageKey ? await uploadMedia(imageKey, { altText: coverAlt(draft), title: draft.title }) : null;

      // Images a person placed in the article move to the WordPress Media Library first.
      const inline = await publishDraftImages(nid, draft.content_html || '');
      const contentHtml = `${withByline(faqAccordion(inline.html), author, reviewer || null)}\n${faqSchema(draft.content_html) || ''}\n${expertSchema({ title: draft.title, author, reviewer: reviewer || null, image: cover?.url || null }) || ''}`;
      // The address is set only on a new post: a live post (or the page a refresh replaces) keeps its URL.
      const keepAddress = Boolean(refreshUrl) || wpLive === 'publish';
      const fields = {
        title: draft.title,
        contentHtml,
        author: authorId || undefined,
        authorName: refreshUrl ? undefined : author,
        excerpt: draft.meta_description,
        featuredMediaId: cover?.id,
        status: wpStatus,
        slug: keepAddress ? undefined : seoSlug(keyword || draft.title),
        metaDescription: draft.meta_description,
        focusKeyphrase: keyword,
      };
      // The planned address must be free: a copy that was never live is moved to the trash.
      const freed = wpStatus === 'publish' && fields.slug ? await freeSlug(fields.slug, draft.wp_post_id).catch(() => null) : null;
      if (freed?.trashed.length) await activity.log('wordpress.duplicate_trashed', { entityType: 'draft', entityId: nid, details: `"${draft.title}": moved WordPress post(s) ${freed.trashed.map((x) => `#${x}`).join(', ')} (never live) to the trash to free /${fields.slug}/`, actor: await getActor() });
      // A refresh updates the live page it refreshes (found from its address, as the calendar does).
      let target: number | null = draft.wp_post_id && wpLive ? draft.wp_post_id : null;
      if (refreshUrl && !target) {
        const { json: found } = await wpRequest('GET', '/wp/v2/posts', { query: { slug: new URL(refreshUrl).pathname.split('/').filter(Boolean).pop(), _fields: 'id,link' } });
        if (!found?.[0]) throw new Error(`The page this blog refreshes was not found: ${refreshUrl}`);
        target = found[0].id;
      }
      // Already on WordPress (as a draft, or the refreshed page): update that post instead of making another one.
      const post: any = target ? await updatePost(target, fields) : await publishPost(fields);
      const yoastSaved = Boolean(post.meta && post.meta._yoast_wpseo_metadesc);

      // updateMany: a draft deleted during the WordPress calls does not turn a post that went out into
      // a "publish failed" answer.
      await prisma.drafts.updateMany({
        where: { id: nid },
        // Live: published, with its address. A WordPress draft is not on the website: the blog stays
        // approved (so it can be published live later), with the post id kept to update that post.
        data: wpStatus === 'publish' ? { status: 'published', wp_post_id: post.id, wp_post_url: post.link, updated_at: sqlNow() } : { status: 'approved', wp_post_id: post.id, wp_post_url: null, updated_at: sqlNow() },
      });
      // Newly live: indexing, SE Ranking tracking and internal links, as a calendar publish does.
      const log = wpStatus === 'publish' && wpLive !== 'publish' ? await import('@/lib/strategy/autopilot').then((m) => m.afterPublish(post.link, draft.title, keyword)).catch(() => null) : null;
      // A calendar blog published here counts as published on the calendar too (it does not publish again).
      if (wpStatus === 'publish') {
        await prisma.blog_schedule.updateMany({ where: { draft_id: nid, status: { not: 'published' } }, data: { status: 'published', approval_mode: 'reviewed', wp_post_url: post.link, hold_reasons: null, ...(log ? { post_publish_log: JSON.stringify(log) } : {}), updated_at: sqlNow() } }).catch(() => {});
      }

      await activity.log('wordpress.published', {
        entityType: 'draft',
        entityId: Number(id),
        details: `"${draft.title}" → ${post.link} (${wpStatus === 'publish' ? 'live on the website' : 'WordPress draft, NOT live yet'})`,
        actor: await getActor(),
      });
      // A blog with no calendar row has nowhere else to keep what the steps after publishing did.
      if (wpStatus === 'publish' && wpLive !== 'publish' && !row) {
        await activity.log('wordpress.after_publish', { entityType: 'draft', entityId: nid, details: `"${draft.title}": ${(await import('@/lib/strategy/autopilot')).afterPublishSummary(log)}`.slice(0, 1000) }).catch(() => {});
      }

      // Read the post back from WordPress, so the screen says what really happened.
      const check = await checkPost(post.id, fields.slug, Boolean(faqSchema(draft.content_html)));
      return NextResponse.json({ ok: true, wpPostId: post.id, wpPostUrl: check?.link || post.link, yoastSaved, check: check && { ...check, trashed: freed?.trashed || [], liveHolder: freed?.liveHolder || null } }, { status: 200 });
    } catch (err: any) {
      console.error(err);
      await activity.log('wordpress.publish_failed', {
        entityType: 'draft',
        entityId: Number(id),
        details: `"${draft.title}": ${err.message}`,
      });
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } finally {
    release();
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
