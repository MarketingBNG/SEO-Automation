import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.training_examples.deleteMany({ where: { id: toId(id) } });
  return NextResponse.json({ ok: true }, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH };
