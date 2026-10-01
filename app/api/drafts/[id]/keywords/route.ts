import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { analyzeKeywords, buildKeywordPlan } from '@/lib/blogKeywords';
import { gatherBrief } from '@/lib/researchBrief';
import { methodNotAllowed, toId } from '../../../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// Was: SELECT drafts.*, keywords.keyword AS keyword FROM drafts JOIN keywords ... WHERE drafts.id = ?
async function load(nid: number) {
  const found: any = await prisma.drafts.findUnique({ where: { id: nid }, include: { keyword: { select: { keyword: true } } } });
  if (!found || !found.keyword) return null;
  const { keyword, ...rest } = found;
  return { ...rest, keyword: keyword.keyword };
}

async function analysis(draft: any) {
  let plan = null;
  try {
    plan = draft.keyword_plan ? JSON.parse(draft.keyword_plan) : null;
  } catch {
    plan = null;
  }
  return analyzeKeywords({ keyword: draft.keyword, title: draft.title, meta: draft.meta_description, content: draft.content_html, plan });
}

// GET: which keywords this draft uses, by type, checked against the article as it is now.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const draft = await load(toId(id));
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json(await analysis(draft), { status: 200 });
}

// POST: fetch keyword suggestions for a draft that has none (older drafts), using SE Ranking and
//       live Google results, and save them with the draft.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const nid = toId(id);
  const draft = await load(nid);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  try {
    const brief: any = await gatherBrief(draft.keyword, { includeSurfer: false, only: ['keywordData', 'serp', 'serpIndia', 'ownRankings'] });
    const plan: any = await buildKeywordPlan(brief, draft.keyword);
    if (!plan.secondary.length && !plan.questions.length && !plan.relatedSearches.length) {
      return NextResponse.json({ error: `No keyword suggestions came back (${brief.notes.join('; ') || 'the tools returned nothing'}). Try again in a few minutes.` }, { status: 502 });
    }
    await prisma.drafts.update({ where: { id: nid }, data: { keyword_plan: JSON.stringify(plan) } });
    return NextResponse.json(await analysis(await load(nid)), { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Old handler returned 404 for a missing draft before checking the method.
async function other(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const draft = await load(toId(id));
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return methodNotAllowed();
}
export { other as PUT, other as PATCH, other as DELETE };
