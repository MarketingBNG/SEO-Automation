import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Every file attached in the assistant chat, newest first, for all users.
export async function GET() {
  const rows = await prisma.assistant_files.findMany({ orderBy: { id: 'desc' }, take: 200 });
  return NextResponse.json(rows.map((r) => ({ ...r, url: `/api/uploads/${r.path}` })));
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
