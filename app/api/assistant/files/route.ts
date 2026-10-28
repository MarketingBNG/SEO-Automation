import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getMe } from '@/lib/auth';
import { ownedBy } from '@/lib/assistant/conversations';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Files attached in the assistant chat, newest first: the person's own (chats are private), or
// everyone's for the admin.
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json([]);
  const where = me.role === 'admin' ? {} : ownedBy(me, 'uploaded_by');
  const rows = await prisma.assistant_files.findMany({ where, orderBy: { id: 'desc' }, take: 200 });
  return NextResponse.json(rows.map((r) => ({ ...r, url: `/api/uploads/${r.path}` })));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
