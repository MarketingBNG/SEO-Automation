import { NextRequest, NextResponse } from 'next/server';
import { startRewrite } from '@/lib/auditJobs';
import { getActor } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Starts the rewrite in the background and returns at once (rewrite_status "generating"); the
// page polls GET /api/audit until it is "ready" or carries rewrite_error.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const row = await startRewrite(toId((await params).id), await getActor());
    return NextResponse.json(row, { status: 202 });
  } catch (err: any) {
    if (!err.status) console.error(err);
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
