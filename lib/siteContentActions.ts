// Website Content: reading, saving and deleting the custom website's pages and posts. Shared by
// /api/site-content and the assistant's site_content_* tools. Saving or deleting changes the live
// website (the website is told through its webhook), so it needs website.change.
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { normalizeSlug, notifyWebsite, toPage, toPost, upsertContent } from '@/lib/siteContent';

type Result = { status: number; body: any };

export async function siteContentItem(slug: string): Promise<Result> {
  const r = await prisma.site_content.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!r) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { item: { type: r.type, status: r.status, updatedBy: r.updated_by, ...(r.type === 'page' ? toPage(r) : toPost(r)) } } };
}

export async function siteContentList() {
  const rows = await prisma.site_content.findMany({ orderBy: [{ type: 'asc' }, { slug: 'asc' }], select: { type: true, slug: true, title: true, status: true, updated_at: true, updated_by: true } });
  return {
    items: rows,
    setup: {
      readKey: Boolean(process.env.SITE_API_KEY),
      importKey: Boolean(process.env.SITE_IMPORT_KEY),
      webhook: Boolean(process.env.SITE_WEBHOOK_URL && process.env.SITE_WEBHOOK_SECRET),
    },
  };
}

// { action: 'save', type, item, create? } | { action: 'delete', slug }. Each change tells the website.
export async function siteContentAction(body: any, email: string | null | undefined): Promise<Result> {
  try {
    if (body.action === 'save') {
      const type = body.type === 'post' ? 'post' : 'page';
      // A new item from the editor (create: true) never overwrites an existing page or post.
      if (body.create) {
        if (!String(body.item?.slug || '').trim()) return { status: 400, body: { error: 'Enter the URL path of the new item.' } };
        const slug = normalizeSlug(body.item.slug);
        // A post needs its own path: the prefilled '/blog/' left as it is would land on the blog index.
        if (type === 'post' && (slug === '/' || slug === '/blog')) {
          return { status: 400, body: { error: "Enter the post's own URL path, for example /blog/itin-guide." } };
        }
        if (await prisma.site_content.findUnique({ where: { slug }, select: { slug: true } })) {
          return { status: 409, body: { error: `${slug} already exists. Open it from the list to edit it, or pick another URL path.` } };
        }
      }
      const { row, created } = await upsertContent(type, body.item || {}, email);
      const event = type === 'page' ? 'page.updated' : row.status === 'published' ? (created ? 'post.published' : 'post.updated') : 'post.unpublished';
      const hook = await notifyWebsite(event, type, row.slug);
      await activity.log('site.content', { details: `${created ? 'Created' : 'Updated'} ${type} ${row.slug}${hook.sent ? '' : ` (website not told: ${hook.reason})`}`, actor: email });
      return { status: 200, body: { ok: true, slug: row.slug, webhook: hook } };
    }
    if (body.action === 'delete') {
      const slug = normalizeSlug(body.slug);
      const row = await prisma.site_content.findUnique({ where: { slug } });
      if (!row) return { status: 404, body: { error: 'Not found' } };
      await prisma.site_content.delete({ where: { slug } });
      const hook = await notifyWebsite(row.type === 'page' ? 'page.updated' : 'post.unpublished', row.type, slug);
      await activity.log('site.content', { details: `Deleted ${row.type} ${slug}`, actor: email });
      return { status: 200, body: { ok: true, webhook: hook } };
    }
    return { status: 400, body: { error: 'Unknown action' } };
  } catch (e: any) {
    return { status: e.status || 500, body: { error: e.message } };
  }
}
