import { NextRequest, NextResponse } from 'next/server';
import { getMe } from '@/lib/auth';
import { siteContentAction, siteContentItem, siteContentList } from '@/lib/siteContentActions';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the website's pages and posts (?slug= for one, in full), and whether the connection is set up.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (slug) {
    const r = await siteContentItem(slug);
    return NextResponse.json(r.body, { status: r.status });
  }
  return NextResponse.json(await siteContentList());
}

// POST { action: 'save', type, item, create? } | { action: 'delete', slug }. Each change tells the
// website, so it needs website.change (lib/permissions.ts). See lib/siteContentActions.ts.
export async function POST(req: NextRequest) {
  const me = await getMe();
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await siteContentAction(body, me?.email);
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
