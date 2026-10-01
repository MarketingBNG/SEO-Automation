import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Was: SELECT drafts.*, keywords.keyword AS keyword, keywords.batch_name AS batch_name
//      FROM drafts JOIN keywords ON keywords.id = drafts.keyword_id ORDER BY drafts.id DESC
export async function GET() {
  const rows = await prisma.drafts.findMany({
    include: { keyword: { select: { keyword: true, batch_name: true } } },
    orderBy: { id: 'desc' },
  });
  return NextResponse.json(
    rows.map(({ keyword, ...d }: any) => ({ ...d, keyword: keyword?.keyword ?? null, batch_name: keyword?.batch_name ?? null })),
    { status: 200 }
  );
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
