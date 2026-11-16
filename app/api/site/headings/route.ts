import { NextResponse } from 'next/server';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { stripHeadingNumbers, updatePost } from '@/lib/site';
import { sitePosts, sitePost } from '@/lib/siteConnector';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Posts already on the website whose H2 to H4 start with "1.", "2)" or "Step 3:" (the website numbers its
// own "On this page" list, so they show "1. 1. ..."). GET lists them; POST removes those numbers.
// Admin only. Only the headings change; the address, text, author, cover and SEO fields stay as they are.
async function affected() {
  const out: { slug: string; title: string; url: string; headings: number; content: string }[] = [];
  for (const p of await sitePosts(true)) {
    const full = p.content ? p : await sitePost(p.slug);
    const html = String(full?.content || '');
    const clean = stripHeadingNumbers(html);
    if (clean === html) continue;
    const headings = (html.match(/<h[2-4]\b[^>]*>(?:\s|<[^>]+>)*(?:step\s+)?\d{1,2}(?:\.\d{1,2})*\s*[.):-]\s+/gi) || []).length;
    out.push({ slug: p.slug, title: p.title, url: p.url, headings, content: clean });
  }
  return out;
}

async function admin() {
  const me = await getMe();
  return me?.role === 'admin' ? me : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Only the admin can do this.' }, { status: 403 });
  try {
    const list = await affected();
    return NextResponse.json({ posts: list.map(({ content: _c, ...p }) => p) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}

export async function POST() {
  const me = await admin();
  if (!me) return NextResponse.json({ error: 'Only the admin can do this.' }, { status: 403 });
  try {
    const list = await affected();
    const done: string[] = [];
    const failed: string[] = [];
    for (const p of list) {
      try {
        await updatePost(p.slug, { contentHtml: p.content });
        done.push(p.slug);
      } catch (e: any) {
        failed.push(`${p.slug}: ${e.message}`);
      }
    }
    await activity.log('site.headings_cleaned', { details: `Heading numbers removed from ${done.length} live post(s)${failed.length ? `; ${failed.length} failed: ${failed.join('; ').slice(0, 300)}` : ''}`, actor: me.name });
    return NextResponse.json({ fixed: done, failed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
