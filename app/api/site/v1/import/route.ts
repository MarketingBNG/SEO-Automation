import { NextRequest, NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { keyMatches, normalizeSlug, upsertContent } from '@/lib/siteContent';

export const runtime = 'nodejs';

// Website API (import key): bulk import of pages, posts and redirects.
// Body: { pages: [...], posts: [...], redirects: [{from,to,status}] } in the shapes the read API returns.
export async function POST(req: NextRequest) {
  const k = keyMatches(req, 'SITE_IMPORT_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  const body: any = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send JSON: { pages, posts, redirects }' }, { status: 400 });
  const out = { pages: { created: 0, updated: 0 }, posts: { created: 0, updated: 0 }, redirects: 0, errors: [] as string[] };
  for (const [type, list] of [['page', body.pages], ['post', body.posts]] as const) {
    for (const item of Array.isArray(list) ? list : []) {
      try {
        const r = await upsertContent(type, item, 'import');
        out[`${type}s`][r.created ? 'created' : 'updated']++;
      } catch (e: any) {
        out.errors.push(`${type} ${item?.slug}: ${e.message}`);
      }
    }
  }
  if (Array.isArray(body.redirects)) {
    const list = body.redirects.filter((r: any) => r?.from && r?.to).map((r: any) => ({ from: normalizeSlug(r.from), to: /^https?:\/\//.test(r.to) ? r.to : normalizeSlug(r.to), status: Number(r.status) === 302 ? 302 : 301 }));
    await settings.set('site_redirects', JSON.stringify(list));
    out.redirects = list.length;
  }
  await activity.log('site.import', { details: `Imported ${out.pages.created + out.pages.updated} page(s), ${out.posts.created + out.posts.updated} post(s), ${out.redirects} redirect(s)` });
  return NextResponse.json(out);
}
