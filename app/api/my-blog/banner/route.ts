import { NextRequest, NextResponse } from 'next/server';
import { bannerCandidate } from '@/lib/coverPhoto';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST { title, keyword?, author?, main?, cutout?, variant?, style? }: a banner to preview in Post my blog,
// before the draft exists. Saved as a candidate only; Post now / Save to Drafts sends its key back
// (cover_key) and that banner is the one the post carries. May spend a small AI call (art direction)
// and an image; the AI parts are skipped in Testing mode and while AI work is paused.
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const title = String(b?.title || '').trim().slice(0, 300);
  if (!title) return NextResponse.json({ error: 'Type the title first: the banner shows it.' }, { status: 400 });
  try {
    const c = await bannerCandidate({ title, topic: `${title} ${String(b.keyword || '')}`.trim(), author: String(b.author || '').trim() || null, main: b.main, cutout: b.cutout, variant: b.variant, style: b.style, feedback: b.feedback }, 'new');
    return NextResponse.json({ ok: true, key: c.key, url: `/api/uploads/${c.key}`, source: c.source });
  } catch (e: any) {
    return NextResponse.json({ error: `The banner could not be made: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
