import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Was: SELECT drafts.*, keywords.keyword AS keyword, keywords.batch_name AS batch_name
//      FROM drafts JOIN keywords ON keywords.id = drafts.keyword_id ORDER BY drafts.id DESC
export async function GET() {
  // Light rows: the list never shows the article; the editor loads the full draft by id.
  const rows = await prisma.drafts.findMany({
    select: { id: true, keyword_id: true, title: true, status: true, production_state: true, repair_attempts: true, word_count: true, created_at: true, updated_at: true, wp_post_url: true, wp_post_id: true, author: true, featured_image_path: true, keyword: { select: { keyword: true, batch_name: true } } },
    orderBy: { id: 'desc' },
    take: 500,
  });
  return NextResponse.json(
    rows.map(({ keyword, ...d }: any) => ({ ...d, keyword: keyword?.keyword ?? null, batch_name: keyword?.batch_name ?? null })),
    { status: 200 }
  );
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
