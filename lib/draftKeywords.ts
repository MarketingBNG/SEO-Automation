// Which keywords a draft uses, by type, checked against the article as it is now (the Keywords panel
// in Drafts & Review). Shared by /api/drafts/[id]/keywords and the assistant's draft_keyword_plan.
import prisma from '@/lib/prisma';
import { analyzeKeywords } from '@/lib/blogKeywords';

// Was: SELECT drafts.*, keywords.keyword AS keyword FROM drafts JOIN keywords ... WHERE drafts.id = ?
export async function loadDraftWithKeyword(nid: number) {
  const found: any = await prisma.drafts.findUnique({ where: { id: nid }, include: { keyword: { select: { keyword: true } } } });
  if (!found || !found.keyword) return null;
  const { keyword, ...rest } = found;
  return { ...rest, keyword: keyword.keyword };
}

export async function draftKeywordAnalysis(draft: any) {
  let plan = null;
  try {
    plan = draft.keyword_plan ? JSON.parse(draft.keyword_plan) : null;
  } catch {
    plan = null;
  }
  return analyzeKeywords({ keyword: draft.keyword, title: draft.title, meta: draft.meta_description, content: draft.content_html, plan });
}
