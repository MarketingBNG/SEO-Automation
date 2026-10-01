import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') as any, 10) || 200, 500);
  const rows = await prisma.activity_log.findMany({ orderBy: { id: 'desc' }, take: limit });
  return NextResponse.json(rows, { status: 200 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
