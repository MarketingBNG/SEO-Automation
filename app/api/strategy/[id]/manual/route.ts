import { NextRequest, NextResponse } from 'next/server';
import { listManualTasks } from '@/lib/strategy/manual';
import { getMe } from '@/lib/auth';
import { canDo } from '@/lib/access';
import prisma from '@/lib/prisma';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

// Tasks of this strategy that a person has to do, with any guide already written. Someone who may
// assign tasks also gets the people to pick from (they may not have access to the team list itself).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  const tasks = await listManualTasks(toId((await params).id));
  // A user sees only the tasks assigned to them.
  const team = me && (await canDo(me, 'manual.assign'))
    ? await prisma.team_members.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }], select: { email: true, name: true, role: true } })
    : undefined;
  return NextResponse.json({ tasks: me?.role === 'user' ? tasks.filter((t) => t.assignedTo === me.email) : tasks, role: me?.role || 'user', ...(team ? { team } : {}) });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
