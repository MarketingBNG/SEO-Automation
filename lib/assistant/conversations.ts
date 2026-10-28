// Who may see a conversation or an attached file: its owner, or an admin (who sees everyone's).
// Kept out of the route file: a Next route file may only export its handlers and config.
// New rows are stamped with the owner's email (unique per person). Rows from before that carry the
// display name, which two people can share: a name still matches, but only on such an older row
// (a value with no '@'), so a shared name never opens a newer row of someone else.
export const ownerStamp = (me: any, fallback: string | null = null): string | null => me?.email || fallback;

export function isOwner(me: any, value: string | null | undefined): boolean {
  if (!me || !value) return false;
  return value === me.email || (Boolean(me.name) && value === me.name && !value.includes('@'));
}

// The Prisma filter for rows a person owns, on `field` (created_by, uploaded_by).
export function ownedBy(me: any, field: string) {
  const or: any[] = [{ [field]: me.email }];
  if (me.name && !String(me.name).includes('@')) or.push({ [field]: me.name });
  return { OR: or };
}

export function mineOnly(me: any) {
  if (!me || me.role === 'admin') return null;
  return ownedBy(me, 'created_by');
}
