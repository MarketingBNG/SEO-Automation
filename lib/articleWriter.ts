// LinkedIn article for a topic: researched with web search, written in the house voice, with
// [VISUAL SUGGESTION] spots where a picture or chart belongs (newspaper style, two or three per
// piece), saved as a draft of kind "article" so it gets the same review, images and Word download.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { startTimer, endTimer } from './jobTimer';
import { authorNames, pickAuthor } from './authors';

export async function writeArticle({ topic, keywordId }: { topic: any; keywordId: number }): Promise<number> {
  const key = `article-${topic.id}`;
  startTimer(key, 'article', `LinkedIn article: ${topic.title}`);
  try {
    const voice = await settings.get('voice_guidelines');
    const kws: string[] = JSON.parse(topic.keywords || '[]');
    const sources = JSON.parse(topic.sources || '[]');
    const system = `You write LinkedIn articles for the partners of USAIndiaCFO, a cross-border finance, tax and compliance firm for Indian founders with US companies and NRIs. Voice: ${voice}. A LinkedIn article is 900 to 1,400 words: a first line that states the change or the point plainly (no questions, no "In today's world"), short paragraphs, concrete numbers with their source, one clear takeaway per section, a closing line that invites comments with a specific question. Use web search to verify every figure, date and rule against a primary source; never invent. Mark two or three places for a picture or chart with a line of its own: [VISUAL SUGGESTION: what the picture or chart should show]. End with a "Sources" list of the URLs used. No em dashes. No AI filler.`;
    const prompt = `Topic: ${topic.title}\nWhy now: ${topic.why}\nKeywords to work in naturally: ${kws.join(', ')}\nStarting sources: ${sources.map((s: any) => `${s.title} ${s.url}`).join(' | ') || 'find them'}\n\nReturn exactly:\n===TITLE===\n<headline, under 90 characters>\n===META===\n<one-line summary for the post that shares the article, under 200 characters>\n===CONTENT===\n<the article as HTML: <h2> sections, <p> paragraphs, <ul> lists where they help, the [VISUAL SUGGESTION: ...] lines inside <p> tags, a final <h2>Sources</h2> with <ul> links>\n===END===`;
    const { text } = (await callClaude(system, [{ role: 'user', content: prompt }], undefined, { maxUses: Number(process.env.ARTICLE_SEARCHES || 8), effort: 'high', feature: 'blog' })) as { text: string };
    const get = (a: string, b: string) => {
      const i = text.indexOf(a);
      if (i < 0) return '';
      const j = text.indexOf(b, i + a.length);
      return text.slice(i + a.length, j < 0 ? text.length : j).trim();
    };
    const title = get('===TITLE===', '===META===');
    const meta = get('===META===', '===CONTENT===');
    const content = get('===CONTENT===', '===END===');
    if (!title || !content) throw new Error('The article could not be read from the reply. Try again.');
    const draft = await prisma.drafts.create({
      data: { keyword_id: keywordId, title, meta_description: meta, content_html: content, word_count: content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, status: 'pending_review', kind: 'article', author: pickAuthor(await authorNames()), production_state: 'READY_FOR_REVIEW' },
    });
    void import('./originality').then((m) => m.checkDraftOriginality(draft.id)).catch(() => {});
    await activity.log('article.written', { entityType: 'draft', entityId: draft.id, details: `"${title}" (LinkedIn article for topic "${topic.title}")` });
    await endTimer(key, true);
    return draft.id;
  } catch (e: any) {
    await activity.log('article.failed', { details: `"${topic.title}": ${String(e?.message || e).slice(0, 200)}` });
    await endTimer(key, false);
    throw e;
  }
}
