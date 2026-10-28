// Who may see a conversation: its owner, or an admin (who sees everyone's).
// Kept out of the route file: a Next route file may only export its handlers and config.
export function mineOnly(me: any) {
  if (!me || me.role === 'admin') return null;
  return { created_by: { in: [me.name, me.email].filter(Boolean) } };
}
