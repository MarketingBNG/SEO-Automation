import { NextRequest, NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import { keyMatches } from '@/lib/siteContent';

export const runtime = 'nodejs';

// Public website API (read key): old URLs and where they now go, kept in settings "site_redirects".
export async function GET(req: NextRequest) {
  const k = keyMatches(req, 'SITE_API_KEY');
  if (!k.ok) return NextResponse.json({ error: k.error }, { status: k.status });
  let list: any[] = [];
  try {
    list = JSON.parse((await settings.get('site_redirects')) || '[]');
  } catch {}
  return NextResponse.json(Array.isArray(list) ? list : []);
}
