// Access on the server: each role's pages and actions (the admin can change them in Team & Roles;
// stored in settings as role_access) plus extra access given to one person (access_grants), for
// good or for some hours. The result travels in the session token, so proxy.ts checks every request
// without a database call; a timed grant carries its end time, so it stops at once when it ends.
import prisma from './prisma';
import * as settings from './settings';
import { allows, roleAccess, type Access, type Action, type Grant, type Role, type RoleAccess } from './permissions';

const ms = (sql: string) => Date.parse(sql.replace(' ', 'T') + 'Z');

export async function getRoleAccess(): Promise<RoleAccess> {
  try {
    return JSON.parse((await settings.get('role_access')) || '{}') || {};
  } catch {
    return {};
  }
}

export async function setRoleAccess(role: Role, access: Access) {
  const all = await getRoleAccess();
  all[role] = access;
  await settings.set('role_access', JSON.stringify(all));
}

export async function resetRoleAccess(role: Role) {
  const all = await getRoleAccess();
  delete all[role];
  await settings.set('role_access', JSON.stringify(all));
}

export async function grantsFor(email: string): Promise<Grant[]> {
  const rows = await prisma.access_grants.findMany({ where: { email: email.toLowerCase() } }).catch(() => []);
  const now = Date.now();
  return rows.map((r) => ({ key: r.grant_key, exp: r.expires_at ? ms(r.expires_at) : null })).filter((g) => g.exp === null || g.exp > now);
}

export async function accessFor(email: string, role: Role): Promise<{ access: Access; grants: Grant[] }> {
  return { access: roleAccess(role, role === 'admin' ? null : await getRoleAccess()), grants: role === 'admin' ? [] : await grantsFor(email) };
}

// For route handlers that check an action themselves.
export async function canDo(me: { email: string; role: Role; blocked?: boolean }, action: Action): Promise<boolean> {
  if (me.blocked) return false;
  const { access, grants } = await accessFor(me.email, me.role);
  return allows(access, grants, action);
}

// The person's current role, block and access from the database, for proxy.ts. The session token
// is only rewritten when the browser reads the session, so a kept old cookie would otherwise carry
// a role, an unblock or a grant the admin has since taken away (or a tester role past 48 hours).
// Cached for 30 seconds per person so polling pages do not cost a query each.
export type LiveAccess = { role: Role; blocked: boolean; access: Access | null; grants: Grant[] };
const LIVE_MS = 30_000;
const liveCache = new Map<string, { at: number; value: LiveAccess }>();

export async function liveAccessFor(email: string): Promise<LiveAccess> {
  const e = email.toLowerCase();
  const hit = liveCache.get(e);
  if (hit && Date.now() - hit.at < LIVE_MS) return hit.value;
  const { memberFor } = await import('./team');
  const m = await memberFor(e);
  // Not on the team list: no access until the admin adds them (same as the session callback).
  const value: LiveAccess = m ? { role: m.role, blocked: m.blocked, ...(await accessFor(m.email, m.role)) } : { role: 'user', blocked: true, access: null, grants: [] };
  liveCache.set(e, { at: Date.now(), value });
  if (liveCache.size > 500) liveCache.delete(liveCache.keys().next().value!);
  return value;
}
