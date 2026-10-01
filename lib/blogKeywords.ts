// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import { stripHtml } from './validation';
import { chooseKeywords, coverage, usage as kpUsage } from './keywordPlanner';
// Keyword plan and keyword usage for one blog. The plan comes from the research brief (SE Ranking,
// Google, Surfer); the analysis checks the actual article against it, in code.
//
// Keyword types:
//   primary        the one main keyword: title, first 100 words, one H2, meta description once.
//   secondary      close variants with the same search intent (SE Ranking "related"): 3-6 of them.
//   question       real questions people ask (Google "People also ask", SE Ranking questions):
//                  as H2/H3 headings or in the FAQ.
//   related search Google's own "Related searches": natural long-tail wording for headings and body.
//   surfer term    words and phrases the top-ranking pages use: a coverage checklist, never stuffed.


const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'your', 'how', 'what', 'is', 'are', 'vs', 'do', 'does', 'can', 'i', 'my', 'it', 'be', 'by', 'at', 'as', 'that', 'this', 'you', 'we', 'will', 'have', 'has']);

const TYPE_HELP = {
  primary: 'The main keyword. Use it in the title, the first 100 words, one H2 and the meta description (once each). Do not repeat it in every paragraph.',
  secondary: 'Close variants with the same search intent. Use 3 to 6 of them in headings and body text where they read naturally.',
  question: 'Real questions people ask. Use them as H2/H3 headings or FAQ questions and answer each in 40 to 60 words.',
  related: 'Google "Related searches". Natural long-tail wording: use the ones that fit in headings and body text.',
  surfer: 'Words the top-ranking pages use. A coverage checklist: use the ones that fit, never force one or exceed its maximum.',
};

const terms = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

// The keyword plan saved with a draft (or built on demand for older drafts).
function buildKeywordPlan(brief, keyword) {
  const kd = brief.keywordData || {};
  const serpRelated = [...(brief.serp?.results?.results?.related_search || []), ...(brief.serpIndia?.results?.results?.related_search || [])].map((r) => String(r.title || '').trim()).filter(Boolean);
  const seen = new Set();
  const uniq = (list, key) => list.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
  const secondary = uniq(
    [...(kd.related || []), ...(kd.similar || []), ...(kd.longtail || [])]
      .filter((k) => k.keyword && k.keyword.toLowerCase() !== String(keyword).toLowerCase())
      .slice(0, 45)
      .map((k) => ({ keyword: k.keyword, volume: k.volume ?? null, difficulty: k.difficulty ?? null })),
    (x) => x.keyword.toLowerCase()
  );
  const questions = uniq(
    [
      ...(brief.peopleAlsoAsk || []).map((q) => ({ keyword: q.question, source: 'Google People also ask', markets: q.markets || [] })),
      ...(kd.questions || []).map((k) => ({ keyword: k.keyword, source: 'SE Ranking questions', volume: k.volume ?? null })),
    ],
    (x) => norm(x.keyword)
  );
  return {
    builtAt: new Date().toISOString(),
    primary: keyword,
    secondary,
    questions: questions.slice(0, 20),
    relatedSearches: [...new Set(serpRelated)].slice(0, 12),
    surferTerms: (brief.surfer?.terms || []).slice(0, 40).map((t) => ({ term: t.term, min: t.target_range?.min ?? null, max: t.target_range?.max ?? null })),
    ownPages: (brief.ownRankings || []).slice(0, 8).map((r) => ({ query: r.keys?.[0], page: r.keys?.[1], position: Math.round(r.position * 10) / 10, impressions: r.impressions })),
  };
}

function count(haystackNorm, phraseNorm) {
  if (phraseNorm.trim().length < 3) return 0;
  return haystackNorm.split(phraseNorm).length - 1;
}

// How a phrase appears in the article: used (exact phrase), partly (its words appear but not as a
// phrase), or missing. `where` lists title, meta, heading, faq, opening and body.
function usage(phrase, parts) {
  const p = norm(phrase);
  const total = count(parts.textN, p);
  const ts = terms(phrase).map(stem);
  const wordsAll = ts.length > 0 && ts.every((t) => parts.textN.includes(` ${t}`));
  const where: any[] = [];
  if (count(parts.titleN, p)) where.push('title');
  if (count(parts.metaN, p)) where.push('meta description');
  if (parts.headingsN.some((h) => count(h, p))) where.push('heading');
  if (count(parts.faqN, p)) where.push('FAQ');
  if (count(parts.openingN, p)) where.push('first 100 words');
  return { count: total, status: total > 0 ? 'used' : wordsAll ? 'partly' : 'missing', where };
}

function questionUsage(question, headings) {
  const ts = terms(question).map(stem).filter((t) => !['much', 'many', 'long', 'get', 'need', 'should', 'when', 'where', 'why', 'who'].includes(t));
  if (!ts.length) return false;
  return headings.some((h) => {
    const hn = norm(h);
    return ts.filter((t) => hn.includes(` ${t}`)).length / ts.length >= 0.6;
  });
}

function splitParts({ title, meta, content }) {
  const html = String(content || '');
  const faqAt = html.search(/<h[23][^>]*>(?:\s|<[^>]+>)*(FAQ|Frequently Asked Questions)/i);
  const faqHtml = faqAt === -1 ? '' : html.slice(faqAt);
  const headings = (html.match(/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>/gi) || []).map(stripHtml);
  const text = stripHtml(html);
  return {
    titleN: norm(title),
    metaN: norm(meta),
    textN: norm(`${title} ${text}`),
    headingsN: headings.map(norm),
    headings,
    faqN: norm(stripHtml(faqHtml)),
    openingN: norm(text.split(' ').slice(0, 100).join(' ')),
    text,
  };
}

function entities(text) {
  const found = new Map();
  const add = (label) => found.set(label, (found.get(label) || 0) + 1);
  for (const m of text.matchAll(/\bForm\s?\d{1,5}(?:-[A-Z]{1,4})?[A-Z]?\b/g)) add(m[0].replace(/\s+/, ' '));
  for (const m of text.matchAll(/\bSection\s?\d{1,4}[A-Z]{0,2}(?:\(\d+\))?/g)) add(m[0].replace(/\s+/, ' '));
  for (const m of text.matchAll(/\b(FBAR|FATCA|FEMA|DTAA|ITIN|EIN|LRS|ODI|GILTI|NCTI|TDS|GST|PFIC|LLC|C-Corp|S-Corp|RBI|SEBI|IRS|CBDT|FinCEN|OECD|ICAI|TRC|NRI|NRE|NRO)\b/g)) add(m[0]);
  return [...found.entries()].map(([entity, n]) => ({ entity, count: n })).sort((a, b) => b.count - a.count).slice(0, 16);
}

// The 2 and 3 word phrases the article leans on most, so the writer/reviewer sees its real focus.
function frequentPhrases(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const counts = new Map();
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (STOP.has(gram[0]) || STOP.has(gram[n - 1]) || gram.some((w) => w.length < 2)) continue;
      const key = gram.join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 40)
    .filter(([k], i, all) => !all.slice(0, i).some(([longer]) => longer.includes(k) && longer !== k))
    .slice(0, 10)
    .map(([phrase, n]) => ({ phrase, count: n }));
}

function analyzeKeywords({ keyword, title, meta, content, plan }) {
  const parts = splitParts({ title, meta, content });
  const words = parts.text.split(' ').filter(Boolean).length;
  const primary = keyword ? { keyword, ...usage(keyword, parts) } : null;
  if (primary) {
    primary.densityPct = words ? Math.round(((primary.count * terms(keyword).length) / words) * 1000) / 10 : 0;
    primary.inTitle = primary.where.includes('title');
    primary.inMeta = primary.where.includes('meta description');
    primary.inOpening = primary.where.includes('first 100 words');
    primary.inHeading = primary.where.includes('heading');
    primary.advice = [];
    if (!primary.inTitle) primary.advice.push('Put the keyword (or a close variant) early in the title.');
    if (!primary.inOpening) primary.advice.push('Use it naturally in the first 100 words.');
    if (!primary.inHeading) primary.advice.push('Use it in at least one H2.');
    if (!primary.inMeta) primary.advice.push('Use it once in the meta description.');
    if (primary.densityPct > 2.5) primary.advice.push('It is repeated too often; use natural variations.');
  }

  // The plan is decided the same way the writer's plan was: near-identical searches are grouped, and
  // words already inside the primary keyword are treated as covered by it.
  const chosen = chooseKeywords(plan || {}, keyword);
  const cov = coverage(chosen, { title, meta, content });
  const secondary = cov.secondary;
  const questions = cov.questions.map((q) => ({ ...q, where: q.status === 'used' ? ['heading or FAQ'] : [] }));
  const related = cov.related;
  const coveredByPrimary = chosen.coveredByPrimary;
  const surfer = chosen.surfer.map((t) => {
    const u = kpUsage(t.term, cov.parts);
    const over = t.max !== null && u.count > t.max;
    const under = t.min !== null && u.count < t.min && u.count > 0;
    return { ...t, ...u, note: over ? "Above the top pages' maximum: cut some." : under ? "Below the top pages' range." : '' };
  });

  const suggest: any[] = [];
  const missingSecondary = secondary.filter((k) => k.status === 'missing');
  if (plan && missingSecondary.length) suggest.push(`Planned but not in the article yet: ${missingSecondary.map((k) => `"${k.keyword}"${k.volume ? ` (${k.volume}/mo)` : ''}`).join(', ')}. Put each in a heading or the text under it.`);
  const missingQ = questions.filter((q) => q.status === 'missing').slice(0, 3);
  if (missingQ.length) suggest.push(`Answer these questions in a heading or the FAQ: ${missingQ.map((q) => `"${q.keyword}"`).join('; ')}.`);
  const over = surfer.filter((t) => t.note.startsWith('Above'));
  if (over.length) suggest.push(`Cut back: ${over.map((t) => t.term).join(', ')}.`);

  return {
    words,
    primary,
    secondary,
    coveredByPrimary,
    placement: chosen.placement,
    questions,
    related,
    surfer,
    entities: entities(parts.text),
    frequentPhrases: frequentPhrases(parts.text),
    suggestions: suggest,
    hasPlan: Boolean(plan),
    planBuiltAt: plan?.builtAt || null,
    ownPages: plan?.ownPages || [],
    typeHelp: TYPE_HELP,
  };
}

export { buildKeywordPlan, analyzeKeywords, TYPE_HELP };
