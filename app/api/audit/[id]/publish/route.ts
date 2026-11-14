import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { publishAudit } from '@/lib/auditPublish';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Publishes an audit's rewrite to the website (see lib/auditPublish.ts). If the audit came from a
// live post, 'publish' REPLACES that post in place. Needs blog.publish_now (lib/permissions.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: any = await req.json().catch(() => ({}));
  const r = await publishAudit(toId(id), body, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
