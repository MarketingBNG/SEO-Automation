import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { getActor, getMe } from '@/lib/auth';
import { agentList } from '@/lib/agents';
import { remember, refreshRecall } from '@/lib/agentMemory';
import { runOps } from '@/lib/opsAgent';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the agents with their memory counts, the latest Ops health report and recent development
// changes; ?agent=<key> lists that agent's memories (active and retired).
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  if (agent) {
    const rows = await prisma.agent_memories.findMany({ where: { agent }, orderBy: [{ status: 'asc' }, { strength: 'desc' }, { last_seen_at: 'desc' }], take: 300 });
    return NextResponse.json({ memories: rows });
  }
  const counts = await prisma.agent_memories.groupBy({ by: ['agent', 'kind'], where: { status: 'active' }, _count: { _all: true } });
  const agents = agentList().map((a) => ({ ...a, memory: Object.fromEntries(counts.filter((c) => c.agent === a.key).map((c) => [c.kind, c._count._all])) }));
  const changes = await prisma.agent_memories.findMany({ where: { kind: 'change' }, orderBy: { title: 'desc' }, take: 15, select: { agent: true, body: true } });
  return NextResponse.json({ agents, ops: JSON.parse((await settings.get('ops_report')) || 'null'), changes });
}

// { action: 'teach', agent, text } | { action: 'retire' | 'restore', id } | { action: 'edit', id, text } | { action: 'run_ops' }
// Teaching and changing memories: admins and managers.
export async function POST(req: NextRequest) {
  const b: any = (await req.json().catch(() => ({}))) || {};
  const me = await getMe();
  const actor = await getActor();
  try {
    if (b.action === 'run_ops') return NextResponse.json(await runOps());
    if (!me || !['admin', 'manager'].includes(me.role)) return NextResponse.json({ error: 'Only an admin or a manager can change what the agents remember.' }, { status: 403 });
    if (b.action === 'teach') {
      const agent = String(b.agent || '');
      const text = String(b.text || '').trim();
      if (!agentList().some((a) => a.key === agent)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });
      if (text.length < 8) return NextResponse.json({ error: 'Write the rule in a sentence.' }, { status: 400 });
      const row = await remember({ agent, kind: 'preference', title: text.slice(0, 150), body: text.slice(0, 1500), source: 'user', by: actor });
      await refreshRecall(agent);
      await activity.log('agents.taught', { entityType: 'agent_memory', entityId: row?.id, details: `${agent}: ${text.slice(0, 200)}`, actor });
      return NextResponse.json({ ok: true });
    }
    const id = Number(b.id);
    const row = await prisma.agent_memories.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    if (b.action === 'retire' || b.action === 'restore') {
      await prisma.agent_memories.update({ where: { id }, data: { status: b.action === 'retire' ? 'retired' : 'active' } });
    } else if (b.action === 'edit') {
      const text = String(b.text || '').trim();
      if (text.length < 8) return NextResponse.json({ error: 'Write the memory in a sentence.' }, { status: 400 });
      await prisma.agent_memories.update({ where: { id }, data: { body: text.slice(0, 1500) } });
    } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    await refreshRecall(row.agent);
    await activity.log('agents.memory_changed', { entityType: 'agent_memory', entityId: id, details: `${row.agent}: ${b.action} "${row.title.slice(0, 120)}"`, actor });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (!e.status) console.error(e);
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
