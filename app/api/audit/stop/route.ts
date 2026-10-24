import { NextRequest, NextResponse } from 'next/server';
import { stopJob } from '@/lib/auditJobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// { key: "audit-<id>" | "rewrite-<id>" }: stops a running audit or rewrite from "Check a blog".
export async function POST(req: NextRequest) {
  try {
    const { key } = (await req.json().catch(() => ({}))) || {};
    const stopped = await stopJob(String(key || ''), await getActor());
    if (!stopped) return NextResponse.json({ error: 'This job is not running any more.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (!err.status) console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
