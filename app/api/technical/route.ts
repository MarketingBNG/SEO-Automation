import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  const rows: any[] = await prisma.technical_crawls.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(rows.map((r) => ({ ...r, problem_urls: JSON.parse(r.problem_urls || '[]') })), { status: 200 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
