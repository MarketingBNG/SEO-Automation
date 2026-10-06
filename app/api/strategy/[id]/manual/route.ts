import { NextRequest, NextResponse } from 'next/server';
import { listManualTasks } from '@/lib/strategy/manual';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Tasks of this strategy that a person has to do, with any guide already written.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ tasks: await listManualTasks(toId((await params).id)) });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
