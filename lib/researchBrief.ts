// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as questionBankMod from './questionBank';
import { researchKeywords } from './seranking';
import { liveSearch } from './serphouse';
import { querySearchAnalytics, comparisonRanges } from './searchConsole';
import { wpRequest } from './wordpress';
import { getTermsForKeyword } from './surfer';
// Gathers a pre-writing brief for one target keyword from every connected SEO tool. Each source
// is independent and time-boxed: a tool that is down or slow is skipped, never blocking a draft.

function withTimeout(promise, ms, label) {
  let timer: any;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function decode(str) {
  return String(str || '')
    .replace(/&#8212;|&#8211;/g, '-')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&quot;/g, '"');
}

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'your', 'how', 'what', 'is', 'are', 'vs', 'best']);

function distinctiveTerms(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// `only` limits the run to some sources, e.g. ['serp', 'serpIndia'] for just the live Google data.
async function gatherBrief(keyword, { includeSurfer = true, only }: any = {}) {
  const brief = { keyword, notes: [] };
  const terms = distinctiveTerms(keyword);

  const tasks = {
    // One after the other: SE Ranking tends to stall when two research calls run at once.
    keywordData: async () => {
      const related = await researchKeywords('related', keyword, { limit: 15 });
      const questions = await researchKeywords('questions', keyword, { limit: 12 }).catch(() => []);
      // "related" is mostly rewordings of the same search; "similar" and "long-tail" add distinct keywords.
      const similar = await researchKeywords('similar', keyword, { limit: 15 }).catch(() => []);
      const longtail = await researchKeywords('longtail', keyword, { limit: 15 }).catch(() => []);
      return { related, questions, similar, longtail };
    },
    // Google results differ by country, and so do the "People also ask" questions, so look at both
    // markets USAIndiaCFO serves.
    serp: async () => {
      return liveSearch({ q: keyword, loc: 'United States' });
    },
    serpIndia: async () => {
      // Most Indian searches are on phones, and the research recommends mobile results for India.
      return liveSearch({ q: keyword, loc: 'India', device: 'mobile' });
    },
    ownRankings: async () => {
      const { current } = comparisonRanges(90);
      // Every distinctive word must appear (the filters are ANDed), so near-variants still match.
      return querySearchAnalytics({
        ...current,
        dimensions: ['query', 'page'],
        rowLimit: 15,
        filters: terms.slice(0, 3).map((t) => ({ dimension: 'query', operator: 'contains', expression: t })),
      });
    },
    internalLinks: async () => {
      // WordPress search requires every word to match, so search each distinctive word as well as
      // the whole phrase, then rank candidates by how many of the keyword's words their title has.
      const searches = [keyword, ...terms.slice(0, 3)];
      const found = new Map();
      for (const search of searches) {
        const [posts, pages] = await Promise.all([
          wpRequest('GET', '/wp/v2/posts', { query: { search, per_page: 6, _fields: 'title,link' } }),
          wpRequest('GET', '/wp/v2/pages', { query: { search, per_page: 4, _fields: 'title,link' } }),
        ]);
        for (const p of [...posts.json, ...pages.json]) {
          const title = decode(p.title?.rendered);
          if (!found.has(p.link)) found.set(p.link, { title, url: p.link, score: terms.filter((t) => title.toLowerCase().includes(t)).length });
        }
      }
      return [...found.values()].filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
    },
    ...(includeSurfer
      ? {
          surfer: async () => {
            return getTermsForKeyword(keyword, { maxWaitMs: 90000 });
          },
        }
      : {}),
  };

  const timeouts = { surfer: 100000, serp: 65000, serpIndia: 65000, keywordData: 80000, internalLinks: 45000 };
  const entries = Object.entries(tasks).filter(([name]) => !only || only.includes(name));
  const settled = await Promise.allSettled(entries.map(([name, fn]) => withTimeout(fn(), timeouts[name] || 30000, name)));
  settled.forEach((r, i) => {
    const name = entries[i][0];
    if (r.status === 'fulfilled') brief[name] = r.value;
    else brief.notes.push(`${name} unavailable: ${r.reason?.message || r.reason}`);
  });
  brief.peopleAlsoAsk = peopleAlsoAsk(brief);
  await questionBankMod.recordQuestions(keyword, brief.peopleAlsoAsk);
  return brief;
}

function cleanQuestion(q) {
  const text = decode(q).replace(/\s+/g, ' ').trim().replace(/\s+\?$/, '?');
  return text && !text.endsWith('?') ? `${text}?` : text;
}

// Google's "People also ask" questions from the live results, US first, merged and de-duplicated.
function peopleAlsoAsk(brief) {
  const byKey = new Map();
  for (const [market, serp] of [['US', brief.serp], ['India', brief.serpIndia]]) {
    for (const item of serp?.results?.results?.people_also_ask || []) {
      // Desktop results put the text in `question`, mobile results in `title`.
      const question = cleanQuestion(item.question || item.title);
      if (question.length < 8) continue;
      const key = question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (byKey.has(key)) byKey.get(key).markets.push(market);
      else byKey.set(key, { question, answer: decode(item.answer || '').trim(), markets: [market] });
    }
  }
  return [...byKey.values()];
}

// What Google's AI Overview currently says and which sites it cites: the answer to beat, and a
// direct read on whether AI search already quotes us for this topic.
function aiOverviewSummary(serp) {
  const overview = serp?.results?.results?.ai_overview;
  if (!overview?.contents?.length) return null;
  const points: any[] = [];
  for (const block of overview.contents) {
    // The overview ends with chat ("If you'd like, let me know..."); nothing after it is content.
    if (/let me know|if you('|’)?d like|I can help/i.test(decode(block.snippet || ''))) break;
    if (block.snippet) points.push(decode(block.snippet));
    for (const item of block.list || []) points.push(`${decode(item.title)}: ${decode(item.snippet)}`);
  }
  const cited = (overview.references || []).map((r) => {
    try {
      return new URL(r.link).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  });
  return {
    points: points.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14),
    cited: [...new Set(cited.filter(Boolean))],
  };
}

function formatBrief(brief) {
  const lines = [
    'RESEARCH BRIEF FROM THE CONNECTED SEO TOOLS (real data for this keyword; use it to shape intent, structure, secondary keywords, FAQ and internal links; still verify every fact with your own research and never copy competitors):',
  ];

  const kwLine = (k) => `${k.keyword}${k.volume ? ` (volume ${k.volume}${k.difficulty !== undefined ? `, difficulty ${k.difficulty}` : ''})` : ''}`;
  const related = brief.keywordData?.related || [];
  const questions = brief.keywordData?.questions || [];
  if (related.length) {
    lines.push(
      '',
      'Related searches (SE Ranking, US). Pick only the 3-6 that are genuinely about this same topic as secondary keywords; ignore the rest:',
      ...related.slice(0, 15).map((k) => `- ${kwLine(k)}`)
    );
  }
  if (questions.length) {
    lines.push('', 'Questions people search (SE Ranking). Use the relevant ones as question-style H2/H3s and in the FAQ:', ...questions.slice(0, 12).map((k) => `- ${kwLine(k)}`));
  }

  if (brief.peopleAlsoAsk?.length) {
    const markets = [...new Set(brief.peopleAlsoAsk.flatMap((q) => q.markets))].join(' and ');
    lines.push(
      '',
      `Google "People also ask" questions for this search (live, ${markets}). These are the questions real searchers open. Build the FAQ from them first: pick the 2-4 that fit this article's topic (at least 3 when 3 fit), use each as an <h3> keeping Google's wording (fix only grammar), and answer each directly in 40-60 words. Skip any that are off-topic for our readers. If one is central to the topic, answer it in the body as well:`,
      ...brief.peopleAlsoAsk.slice(0, 10).map((q) => `- ${q.question} (${q.markets.join(', ')})`)
    );
  }

  const organic = brief.serp?.results?.results?.organic || [];
  const organicIndia = brief.serpIndia?.results?.results?.organic || [];
  const ourResult = (list) => list.find((r) => String(r.link || '').includes('usaindiacfo.com'));
  if (organic.length || organicIndia.length) {
    const main = organic.length ? organic : organicIndia;
    const ours = ourResult(organic);
    const oursIndia = ourResult(organicIndia);
    lines.push(
      '',
      `Current Google top results for "${brief.keyword}" (SERPHouse, live, ${organic.length ? 'US' : 'India'}). Match the search intent and format they show, then beat them on accuracy, specificity and usefulness:`,
      ...main.slice(0, 8).map((r) => `- #${r.position} ${decode(r.title)} (${r.link})`)
    );
    if (organic.length) lines.push(ours ? `usaindiacfo.com ranks #${ours.position} in the US with ${ours.link}.` : 'usaindiacfo.com is not in the US top results yet.');
    if (organicIndia.length) lines.push(oursIndia ? `usaindiacfo.com ranks #${oursIndia.position} in India with ${oursIndia.link}.` : 'usaindiacfo.com is not in the India top results yet.');
  }

  const overview = aiOverviewSummary(brief.serp) || aiOverviewSummary(brief.serpIndia);
  if (overview) {
    lines.push(
      '',
      'Google AI Overview for this search (what AI search answers today). Make sure the article covers every useful point here, more accurately and with primary sources, and correct anything outdated. Do not copy its wording:',
      ...overview.points.map((p) => `- ${p}`)
    );
    if (overview.cited.length) {
      const citesUs = overview.cited.some((h) => h.endsWith('usaindiacfo.com'));
      lines.push(`Sites it cites: ${overview.cited.slice(0, 8).join(', ')}. ${citesUs ? 'It already cites usaindiacfo.com.' : 'It does not cite usaindiacfo.com yet.'}`);
    }
  }

  const relatedSearches = [
    ...new Set(
      [...(brief.serp?.results?.results?.related_search || []), ...(brief.serpIndia?.results?.results?.related_search || [])]
        .map((r) => decode(r.title).trim())
        .filter(Boolean)
    ),
  ];
  if (relatedSearches.length) {
    lines.push('', 'Google "Related searches" (live). Use the on-topic ones as natural variations in headings and body text:', ...relatedSearches.slice(0, 10).map((t) => `- ${t}`));
  }

  if (brief.ownRankings?.length) {
    lines.push(
      '',
      'Our own pages already getting Google impressions for related searches (Search Console, last ~90 days). Do not write a near-duplicate of these (keyword cannibalization); cover a distinct angle and link to the relevant one:',
      ...brief.ownRankings.slice(0, 10).map((r) => `- "${r.keys[0]}" -> ${r.keys[1]} (position ${r.position.toFixed(1)}, ${r.impressions} impressions)`)
    );
  }

  if (brief.internalLinks?.length) {
    lines.push(
      '',
      'Internal link candidates (existing USAIndiaCFO posts and service pages). Include 3-8 that are genuinely relevant (never force one), with descriptive anchor text (never "click here"), and at least one service page if one fits:',
      ...brief.internalLinks.slice(0, 12).map((l) => `- ${l.title}: ${l.url}`)
    );
  }

  if (brief.surfer?.terms?.length) {
    lines.push(
      '',
      'Surfer SEO recommended terms (from the top-ranking pages). Use them where they fit naturally; never force a term or stuff it to hit a count:',
      brief.surfer.terms
        .slice(0, 30)
        .map((t) => `${t.term}${t.target_range ? ` (${t.target_range.min}${t.target_range.max ? `-${t.target_range.max}` : '+'})` : ''}`)
        .join('; ')
    );
  }

  if (brief.notes.length) lines.push('', `Unavailable this run: ${brief.notes.join('; ')}`);
  return lines.join('\n');
}

export { gatherBrief, formatBrief, peopleAlsoAsk, aiOverviewSummary };
