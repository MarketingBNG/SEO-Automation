// @ts-nocheck -- reads untyped SE Ranking JSON.
// AI visibility (GEO and part of AEO) from SE Ranking, the tool already connected to the dashboard:
//  1. Data API "AI Search": how often AI answers in ChatGPT, Perplexity, Gemini, Google AI Overviews
//     and AI Mode link to our domain (link presence) and at what position, US and India.
//  2. Project API "AI Results Tracker": the prompts tracked in our SE Ranking project, with brand
//     mention statistics per engine.
// Every failure is kept as an error note, never turned into a number.
import { AI_ENGINES, getAiSearchOverview, listSites, listAiTrackerEngines, getAiTrackerStatistics, getAiTrackerPresence } from './seranking';

const CHAT_ENGINES = ['chatgpt', 'perplexity', 'gemini'];
const GOOGLE_AI = ['ai-overview', 'ai-mode'];

// Finds the first numeric value under any of the given keys, anywhere in a JSON response.
function findNumber(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    if (v && typeof v === 'object' && typeof v.current === 'number') return v.current;
  }
  for (const v of Object.values(obj)) {
    const n = findNumber(v, keys);
    if (n !== null) return n;
  }
  return null;
}

const sum = (xs: (number | null)[]) => (xs.some((x) => typeof x === 'number') ? xs.reduce((s, x) => s + (typeof x === 'number' ? x : 0), 0) : null);

export async function gatherAiVisibility(domain: string, { from, to }: { from?: string; to?: string } = {}) {
  const errors: string[] = [];

  // 1. AI Search overview per engine and market.
  const overview: any[] = [];
  for (const source of ['us', 'in']) {
    for (const engine of AI_ENGINES) {
      try {
        const r = await getAiSearchOverview(domain, engine, source);
        delete r.raw;
        overview.push(r);
      } catch (e: any) {
        errors.push(`AI Search ${engine} ${source}: ${e.message}`);
      }
    }
  }
  const pick = (engines: string[], field: 'current' | 'previous') => sum(overview.filter((o) => engines.includes(o.engine)).map((o) => o.linkPresence[field]));

  // 2. AI Results Tracker (tracked prompts in the SE Ranking project).
  const tracker: any[] = [];
  try {
    const sites: any = await listSites();
    if (sites?.length) {
      const siteId = sites[0].id;
      for (const llm of await listAiTrackerEngines(siteId)) {
        const llmId = llm.id ?? llm.llm_id;
        const name = String(llm.base_name || llm.name || llmId);
        try {
          const stats = await getAiTrackerStatistics(siteId, llmId, from, to);
          let presence = null;
          if (from && to) presence = await getAiTrackerPresence(siteId, llmId, from, to).catch(() => null);
          tracker.push({
            engine: name,
            brandMentions: findNumber(stats, ['brand_mentions_total', 'brand_mentions_count', 'brand_mentions', 'mentions_count', 'mentions', 'mention_count']),
            mentionPresencePct: findNumber(presence || stats, ['mention_presence', 'mention_rate_percent', 'mention_rate', 'brand_presence']),
            linkPresencePct: findNumber(presence || stats, ['link_presence']),
          });
        } catch (e: any) {
          errors.push(`AI Results Tracker ${name}: ${e.message}`);
        }
      }
      if (!tracker.length && !errors.some((x) => x.startsWith('AI Results Tracker'))) errors.push('AI Results Tracker: no AI engines set up in the SE Ranking project');
    }
  } catch (e: any) {
    errors.push(`AI Results Tracker: ${e.message}`);
  }
  const trackerChat = tracker.filter((t) => /chatgpt|perplexity|gemini/i.test(t.engine));

  return {
    domain,
    overview,
    tracker,
    errors,
    totals: {
      // AI chat answers (ChatGPT, Perplexity, Gemini) that link to us, US + India.
      chatLinks: { current: pick(CHAT_ENGINES, 'current'), previous: pick(CHAT_ENGINES, 'previous') },
      // Google AI Overviews and AI Mode answers that link to us.
      googleAiLinks: { current: pick(GOOGLE_AI, 'current'), previous: pick(GOOGLE_AI, 'previous') },
      // Brand mentions in tracked prompts (ChatGPT, Perplexity, Gemini).
      chatMentions: sum(trackerChat.map((t) => t.brandMentions)),
    },
  };
}
