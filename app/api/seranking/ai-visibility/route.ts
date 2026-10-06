import { NextResponse } from 'next/server';
import { gatherAiVisibility } from '@/lib/aiVisibility';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Live AI visibility from SE Ranking: ChatGPT, Perplexity, Gemini, AI Overviews and AI Mode.
// Uses SE Ranking API credits on every call.
export async function GET() {
  try {
    const host = (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    return NextResponse.json(await gatherAiVisibility(host));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
