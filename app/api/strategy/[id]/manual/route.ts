import { NextRequest, NextResponse } from 'next/server';
import { listManualTasks } from '@/lib/strategy/manual';
import { getMe } from '@/lib/auth';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Tasks of this strategy that a person has to do, with any guide already written.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  const tasks = await listManualTasks(toId((await params).id));
  // A user sees only the tasks assigned to them.
  return NextResponse.json({ tasks: me?.role === 'user' ? tasks.filter((t) => t.assignedTo === me.email) : tasks, role: me?.role || 'user' });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
