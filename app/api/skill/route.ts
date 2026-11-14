import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../_lib/http';
import { saveSkillEdit } from '@/lib/writingRules';

export const runtime = 'nodejs';

export async function GET() {
  const rows: any[] = await prisma.writing_skills.findMany({ orderBy: { id: 'desc' } });
  return NextResponse.json(
    rows.map((r) => ({ ...r, sources: JSON.parse(r.sources || '[]') })),
    { status: 200 }
  );
}

// Manual edit of the writing skill: { skill_content, research_summary }. Saved as a new active
// version (the old one stays in the history), so an edit can always be undone. The next automatic
// refresh builds on this edited version.
export async function POST(req: NextRequest) {
  const body: any = (await req.json().catch(() => ({}))) || {};
  const r = await saveSkillEdit(body, await getActor());
  return NextResponse.json(r.body, { status: r.status });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
