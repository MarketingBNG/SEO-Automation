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
