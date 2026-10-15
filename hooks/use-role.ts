'use client';

// The signed-in person's role and block status, plus can(action), for showing only what they may use.
// The server checks the same rules on every request; this only keeps the screen tidy.
import { useSession } from 'next-auth/react';
import { allows, isRole, roleAccess, type Action, type Role } from '@/lib/permissions';

export function useRole() {
  const { data } = useSession();
  const u: any = data?.user || {};
  const role: Role = isRole(u.role) ? u.role : 'user';
  const blocked = Boolean(u.blocked);
  const access = u.access || roleAccess(role);
  const grants = u.grants || [];
  return {
    role,
    blocked,
    email: String(u.email || '').toLowerCase(),
    loaded: !!data,
    can: (a: Action) => !blocked && (role === 'admin' || allows(access, grants, a)),
    // Pages are still shown to a blocked person (they can look, not act).
    sees: (page: string) => role === 'admin' || allows(access, grants, `page:${page}`),
  };
}
