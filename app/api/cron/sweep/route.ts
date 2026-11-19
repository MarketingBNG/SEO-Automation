import { NextResponse } from 'next/server';
import { sweepStuck } from '@/lib/sweep';
import { isCronRequest } from '../../_lib/http';

export const runtime = 'nodejs';

// Frees keywords, assistant chats and strategies left stuck by a killed process (lib/sweep.ts).
// The built-in scheduler runs the same sweep every 15 minutes. Only the scheduled task (CRON_SECRET) may call it.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Cron only' }, { status: 403 });
  return NextResponse.json(await sweepStuck());
}
