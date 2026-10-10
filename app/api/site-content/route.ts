import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { normalizeSlug, notifyWebsite, toPage, toPost, upsertContent } from '@/lib/siteContent';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the website's pages and posts (?slug= for one, in full), and whether the connection is set up.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (slug) {
    const r = await prisma.site_content.findUnique({ where: { slug: normalizeSlug(slug) } });
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: { type: r.type, status: r.status, updatedBy: r.updated_by, ...(r.type === 'page' ? toPage(r) : toPost(r)) } });
  }
  const rows = await prisma.site_content.findMany({ orderBy: [{ type: 'asc' }, { slug: 'asc' }], select: { type: true, slug: true, title: true, status: true, updated_at: true, updated_by: true } });
  return NextResponse.json({
    items: rows,
    setup: {
      readKey: Boolean(process.env.SITE_API_KEY),
      importKey: Boolean(process.env.SITE_IMPORT_KEY),
      webhook: Boolean(process.env.SITE_WEBHOOK_URL && process.env.SITE_WEBHOOK_SECRET),
    },
  });
}

// POST { action: 'save', type, item } | { action: 'delete', slug }. Each change tells the website.
export async function POST(req: NextRequest) {
  const me = await getMe();
  const body: any = (await req.json().catch(() => ({}))) || {};
  try {
    if (body.action === 'save') {
      const type = body.type === 'post' ? 'post' : 'page';
      const { row, created } = await upsertContent(type, body.item || {}, me?.email);
      const event = type === 'page' ? 'page.updated' : row.status === 'published' ? (created ? 'post.published' : 'post.updated') : 'post.unpublished';
      const hook = await notifyWebsite(event, type, row.slug);
      await activity.log('site.content', { details: `${created ? 'Created' : 'Updated'} ${type} ${row.slug}${hook.sent ? '' : ` (website not told: ${hook.reason})`}`, actor: me?.email });
      return NextResponse.json({ ok: true, slug: row.slug, webhook: hook });
    }
    if (body.action === 'delete') {
      const slug = normalizeSlug(body.slug);
      const row = await prisma.site_content.findUnique({ where: { slug } });
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      await prisma.site_content.delete({ where: { slug } });
      const hook = await notifyWebsite(row.type === 'page' ? 'page.updated' : 'post.unpublished', row.type, slug);
      await activity.log('site.content', { details: `Deleted ${row.type} ${slug}`, actor: me?.email });
      return NextResponse.json({ ok: true, webhook: hook });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
