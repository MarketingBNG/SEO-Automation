import { NextRequest, NextResponse } from 'next/server';
import { getBlogAnalytics, getBlogTable } from '@/lib/blogAnalytics';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/blog-analytics?url=<blog url>&days=28&keyword=<target keyword>  -> one blog
// GET /api/blog-analytics?days=28                                            -> table of all blogs
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const days = Math.min(90, Math.max(7, parseInt(sp.get('days') as any, 10) || 28));
  try {
    const fresh = sp.get('fresh') === '1';
    if (sp.get('url')) return NextResponse.json(await getBlogAnalytics(String(sp.get('url')), { days, keyword: String(sp.get('keyword') || ''), fresh }), { status: 200 });
    return NextResponse.json(await getBlogTable({ days, fresh }), { status: 200 });
  } catch (err: any) {
    if (!err.status) console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
