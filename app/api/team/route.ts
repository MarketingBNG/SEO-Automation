import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { sqlNow } from '@/lib/time';
import { OWNER_EMAIL, can, canBlock, isRole, type Role } from '@/lib/permissions';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// The team list (admin and managers).
export async function GET() {
  const rows = await prisma.team_members.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }] });
  return NextResponse.json(rows.map((r) => ({ ...r, owner: r.email === OWNER_EMAIL })));
}

// { email, name?, role?, blocked? }
//  - add a person or change a role: admin only (the owner always stays admin)
//  - block or unblock: admin (anyone but the owner/admins) or manager (users and analysts)
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body: any = (await req.json().catch(() => ({}))) || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase();
  if (!email.endsWith('@' + domain)) return NextResponse.json({ error: `Only @${domain} accounts can sign in.` }, { status: 400 });

  const existing = await prisma.team_members.findUnique({ where: { email } });
  const target: Role = email === OWNER_EMAIL ? 'admin' : isRole(existing?.role) ? (existing!.role as Role) : 'user';
  const data: any = { updated_by: me.name, updated_at: sqlNow() };
  const notes: string[] = [];

  if (body.role !== undefined || !existing) {
    if (!can(me.role, 'team.roles')) return NextResponse.json({ error: 'Only an admin can add people or change roles.' }, { status: 403 });
    const role = body.role ?? 'user';
    if (!isRole(role)) return NextResponse.json({ error: 'Role must be admin, manager, analyst or user.' }, { status: 400 });
    if (email === OWNER_EMAIL && role !== 'admin') return NextResponse.json({ error: 'The owner always stays admin.' }, { status: 400 });
    data.role = role;
    notes.push(`role ${role}`);
  }
  if (body.name !== undefined && can(me.role, 'team.roles')) data.name = String(body.name).slice(0, 100) || null;
  if (body.blocked !== undefined) {
    if (!canBlock(me.role, target, email)) return NextResponse.json({ error: me.role === 'manager' ? 'Managers can block only users and analysts.' : 'This person cannot be blocked.' }, { status: 403 });
    data.blocked = Boolean(body.blocked);
    notes.push(data.blocked ? 'blocked' : 'unblocked');
  }

  const row = existing
    ? await prisma.team_members.update({ where: { email }, data })
    : await prisma.team_members.create({ data: { email, role: data.role || 'user', name: data.name || null, blocked: Boolean(data.blocked), updated_by: me.name } });
  await activity.log('team.changed', { details: `${email}: ${notes.join(', ') || 'updated'}`, actor: me.name });
  return NextResponse.json(row);
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
