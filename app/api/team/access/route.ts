import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getMe } from '@/lib/auth';
import { getRoleAccess, resetRoleAccess, setRoleAccess } from '@/lib/access';
import { ACTIONS, ACTION_LABEL, PAGES, ROLES, isRole, roleAccess, type Action } from '@/lib/permissions';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const keyOk = (k: string) => (k.startsWith('page:') ? PAGES.some((p) => `page:${p.key}` === k) : ACTIONS.includes(k as Action));

// GET: each role's pages and actions, the extra access given to people, and the lists to pick from.
export async function GET() {
  const custom = await getRoleAccess();
  const grants = await prisma.access_grants.findMany({ orderBy: { id: 'desc' } });
  const now = sql(Date.now());
  return NextResponse.json({
    roles: ROLES.map((r) => ({ role: r, access: roleAccess(r, custom), custom: Boolean(custom[r]), fixed: r === 'admin' })),
    grants: grants.map((g) => ({ ...g, active: !g.expires_at || g.expires_at > now })),
    pages: PAGES,
    actions: ACTIONS.map((a) => ({ key: a, label: ACTION_LABEL[a] })),
  });
}

// POST (admin only, checked in proxy.ts as team.roles):
//   { op: 'role', role, pages: [...], actions: [...] }   set what a role sees and does
//   { op: 'reset', role }                                 back to the standard access for that role
//   { op: 'grant', email, keys: [...], hours? }           extra access for one person; no hours = always
//   { op: 'revoke', id }                                  take one extra access back
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const b: any = (await req.json().catch(() => ({}))) || {};

  if (b.op === 'role' || b.op === 'reset') {
    if (!isRole(b.role) || b.role === 'admin') return NextResponse.json({ error: 'The admin always has full access; pick another role.' }, { status: 400 });
    if (b.op === 'reset') {
      await resetRoleAccess(b.role);
      await activity.log('team.access_changed', { details: `${b.role}: access reset to standard`, actor: me.name });
    } else {
      const pages = (Array.isArray(b.pages) ? b.pages : []).filter((p: string) => PAGES.some((x) => x.key === p));
      const actions = (Array.isArray(b.actions) ? b.actions : []).filter((a: string) => ACTIONS.includes(a as Action));
      await setRoleAccess(b.role, { pages, actions });
      await activity.log('team.access_changed', { details: `${b.role}: ${pages.length} pages, ${actions.length} actions`, actor: me.name });
    }
    return NextResponse.json({ ok: true, note: 'Applies within a minute, when each person’s session refreshes.' });
  }

  if (b.op === 'grant') {
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Pick a person.' }, { status: 400 });
    const keys: string[] = (Array.isArray(b.keys) ? b.keys : [b.key]).filter((k: any) => typeof k === 'string' && keyOk(k));
    if (!keys.length) return NextResponse.json({ error: 'Pick at least one page or action.' }, { status: 400 });
    const hours = b.hours === undefined || b.hours === null || b.hours === '' ? null : Number(b.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365)) return NextResponse.json({ error: 'Hours must be a number above 0 (or leave it empty for always).' }, { status: 400 });
    const expires = hours === null ? null : sql(Date.now() + hours * 3600000);
    for (const k of keys) await prisma.access_grants.create({ data: { email, grant_key: k, expires_at: expires, granted_by: me.name } });
    await activity.log('team.access_granted', { details: `${email}: ${keys.join(', ')} ${expires ? `until ${expires} UTC` : 'always'}`, actor: me.name });
    return NextResponse.json({ ok: true });
  }

  if (b.op === 'revoke') {
    const g = await prisma.access_grants.findUnique({ where: { id: Number(b.id) } });
    if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.access_grants.delete({ where: { id: g.id } });
    await activity.log('team.access_revoked', { details: `${g.email}: ${g.grant_key}`, actor: me.name });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'op must be role, reset, grant or revoke' }, { status: 400 });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
