import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { runBlogJob } from '@/lib/blogJob';
import { methodNotAllowed } from '../_lib/http';

// Streams newline-delimited JSON progress events over the same connection instead of a single
// buffered response, so the UI can show real progress and the user can stop generation by simply
// closing the request (aborting the fetch) - no separate job store needed, and it stays
// deploy-friendly (a background job surviving after the response is sent would not work once this
// runs as a Vercel serverless function).
export const runtime = 'nodejs';
// Vercel Hobby plan limit. On Pro, raise to 800 for long generations.
export const maxDuration = 300;

// Claims the oldest pending keyword atomically: two concurrent requests can't both pick the same one.
async function claimNextPending(): Promise<any | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = await prisma.keywords.findFirst({ where: { status: 'pending' }, orderBy: { id: 'asc' } });
    if (!candidate) return null;
    const res = await prisma.keywords.updateMany({ where: { id: candidate.id, status: 'pending' }, data: { status: 'generating' } });
    if (res.count === 1) return { ...candidate, status: 'generating' };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { keywordId }: any = (await req.json().catch(() => ({}))) || {};

  let keyword: any;
  if (keywordId) {
    const n = Number(keywordId);
    keyword = Number.isSafeInteger(n) ? await prisma.keywords.findUnique({ where: { id: n } }) : null;
    if (keyword) {
      // Atomic claim: a keyword already being generated (another tab, double-click) is not started twice.
      const r = await prisma.keywords.updateMany({ where: { id: keyword.id, status: { not: 'generating' } }, data: { status: 'generating' } });
      if (r.count !== 1) return NextResponse.json({ error: 'This keyword is already being generated' }, { status: 409 });
    }
  } else {
    keyword = await claimNextPending();
  }

  if (!keyword) return NextResponse.json({ error: 'No pending keyword found' }, { status: 404 });

  // The run belongs to the server, not to the browser tab: closing the tab, a dropped connection or a
  // proxy timeout no longer stops it. Only the Stop button (POST /api/generate/stop) does.
  const controller = new AbortController();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(ctrl) {
      let closed = false;
      const send = (obj: any) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };

      runBlogJob(keyword, controller, send).finally(() => {
        if (!closed) {
          closed = true;
          try {
            ctrl.close();
          } catch {}
        }
      });
    },
    cancel() {
      // The browser stopped reading; the run carries on and saves its progress and draft.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
