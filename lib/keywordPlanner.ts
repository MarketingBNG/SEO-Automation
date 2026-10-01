// Decides the keyword plan BEFORE the blog is written, and checks it AFTER.
//
//   research (SE Ranking, Google PAA/related, Surfer)  ->  chooseKeywords()  ->  writer follows the
//   placement map  ->  coverage() checks each planned keyword actually made it into the article.
//
// Near-identical searches ("nri tax india", "nri taxes in india", "tax for nri indians") are grouped
// into one cluster: Google treats them as one intent, so one representative is planned and the rest
// count as covered when the article uses any of them. A variant whose words are all inside the
// primary keyword is already covered by the primary and is not asked for again.

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'your', 'how', 'what', 'is', 'are', 'vs', 'do', 'does', 'can', 'i', 'my', 'it', 'be', 'by', 'at', 'as', 'that', 'this', 'you', 'we', 'will', 'have', 'has', 'get', 'need', 'should']);
const SAME = { taxation: 'tax', taxes: 'tax', taxed: 'tax', indian: 'india', indians: 'india', nris: 'nri', returns: 'return', filing: 'file', filed: 'file', files: 'file', companies: 'company', llcs: 'llc' };

const stripHtml = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const stem = (w) => SAME[w] || w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const coreTerms = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w)).map(stem));
const overlap = (a, b) => [...a].filter((t) => b.has(t)).length;
const isSubset = (a, b) => a.size > 0 && [...a].every((t) => b.has(t));
const clusterKey = (s) => [...coreTerms(s)].sort().join(' ');

function clusterList(items, getText) {
  const map = new Map();
  for (const it of items) {
    const key = clusterKey(getText(it));
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.entries()].map(([key, members]) => ({ key, terms: new Set(key.split(' ')), members }));
}

// The keywords chosen for one blog, and where each goes.
function chooseKeywords(plan, keyword) {
  const primaryTerms = coreTerms(keyword);
  const secClusters = clusterList(plan?.secondary || [], (k) => k.keyword);
  const coveredByPrimary: any[] = [];
  const candidates: any[] = [];
  for (const c of secClusters) {
    const rep = [...c.members].sort((a, b) => (b.volume || 0) - (a.volume || 0) || (a.difficulty ?? 99) - (b.difficulty ?? 99))[0];
    const group = { keyword: rep.keyword, volume: rep.volume ?? null, difficulty: rep.difficulty ?? null, variants: c.members.map((m) => m.keyword).filter((k) => k !== rep.keyword), terms: [...c.terms] };
    if (isSubset(c.terms, primaryTerms)) coveredByPrimary.push(group);
    else if (overlap(c.terms, primaryTerms) >= 1) candidates.push(group);
  }
  candidates.sort((a, b) => (b.volume || 0) - (a.volume || 0) || (a.difficulty ?? 99) - (b.difficulty ?? 99));
  const secondary = candidates.slice(0, 5);

  const qClusters = clusterList(plan?.questions || [], (q) => q.keyword);
  const relevantQ = qClusters
    .map((c) => ({ ...c.members[0], variants: c.members.slice(1).map((m) => m.keyword), terms: [...c.terms] }))
    .filter((q) => overlap(new Set(q.terms), primaryTerms) >= 1);
  const paa = relevantQ.filter((q) => /^Google/i.test(q.source || ''));
  const other = relevantQ.filter((q) => !/^Google/i.test(q.source || '')).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const questions = [...paa, ...other].slice(0, 4);

  const chosenKeys = new Set(secondary.map((s) => s.terms.join(' ')));
  const related = (plan?.relatedSearches || [])
    .map((k) => ({ keyword: k, terms: coreTerms(k) }))
    .filter((r) => overlap(r.terms, primaryTerms) >= 1 && !isSubset(r.terms, primaryTerms) && !chosenKeys.has([...r.terms].sort().join(' ')))
    .slice(0, 4)
    .map((r) => ({ keyword: r.keyword }));

  const surfer = (plan?.surferTerms || []).slice(0, 12);

  const placement: any[] = [];
  if (keyword) placement.push({ type: 'primary', keyword, place: 'Title (in the first 5 words), the opening answer (first 100 words), one H2, the meta description once, and the URL slug' });
  secondary.forEach((s, i) =>
    placement.push({
      type: 'secondary',
      keyword: s.keyword,
      volume: s.volume,
      place: i < 3 ? 'An H2 or H3 heading (as a natural section title), plus once in the text under it' : 'Once or twice in the body text',
      alsoCounts: s.variants,
    })
  );
  questions.forEach((q, i) =>
    placement.push({ type: 'question', keyword: q.keyword, source: q.source, place: i === 0 ? 'A FAQ question (keep the wording); also answer it in the body if it is central' : 'A FAQ question (keep the wording), answered in 40 to 60 words' })
  );
  related.forEach((r) => placement.push({ type: 'related', keyword: r.keyword, place: 'Natural wording in a heading or the body text' }));

  return { primary: keyword, secondary, coveredByPrimary, questions, related, surfer, placement };
}

// Text block for the writer's prompt.
function planForPrompt(chosen) {
  const lines = [
    'KEYWORD PLAN (decided from the research BEFORE writing; place each keyword where it says, in natural sentences; never repeat a phrase just to hit a count):',
    `- PRIMARY: "${chosen.primary}". ${chosen.placement.find((p) => p.type === 'primary')?.place || ''}.`,
  ];
  if (chosen.secondary.length) {
    lines.push('- SECONDARY (same search intent; use each as planned, in your own natural wording if needed):');
    chosen.placement.filter((p) => p.type === 'secondary').forEach((p) => lines.push(`  * "${p.keyword}"${p.volume ? ` (${p.volume}/month)` : ''}: ${p.place}.${p.alsoCounts?.length ? ` Close variants that also count: ${p.alsoCounts.slice(0, 3).map((v) => `"${v}"`).join(', ')}.` : ''}`));
  }
  if (chosen.coveredByPrimary.length) lines.push(`- Already covered by the primary keyword (do not force these): ${chosen.coveredByPrimary.slice(0, 6).map((c) => `"${c.keyword}"`).join(', ')}.`);
  if (chosen.questions.length) {
    lines.push('- QUESTIONS (real searches; these make the FAQ and answer-engine sections):');
    chosen.placement.filter((p) => p.type === 'question').forEach((p) => lines.push(`  * "${p.keyword}" (${p.source}): ${p.place}.`));
  }
  if (chosen.related.length) lines.push(`- RELATED SEARCHES (long-tail wording that fits): ${chosen.related.map((r) => `"${r.keyword}"`).join(', ')}.`);
  if (chosen.surfer.length) lines.push(`- COVERAGE TERMS from the top-ranking pages (cover the ones that fit; never exceed a maximum): ${chosen.surfer.map((t) => `${t.term}${t.min !== null ? ` (${t.min}${t.max ? `-${t.max}` : '+'})` : ''}`).join('; ')}.`);
  return lines.join('\n');
}

// ---------- checking an article against words/phrases ----------

function splitParts({ title, meta, content }) {
  const html = String(content || '');
  const faqAt = html.search(/<h[23][^>]*>(?:\s|<[^>]+>)*(FAQ|Frequently Asked Questions)/i);
  const faqHtml = faqAt === -1 ? '' : html.slice(faqAt);
  const headings = (html.match(/<h[2-4][^>]*>[\s\S]*?<\/h[2-4]>/gi) || []).map(stripHtml);
  const text = stripHtml(html);
  const units = [title, ...headings, ...text.split(/(?<=[.!?])\s+/)].filter(Boolean);
  return {
    titleN: norm(title),
    metaN: norm(meta),
    textN: norm(`${title} ${text}`),
    headings,
    headingsN: headings.map(norm),
    faqN: norm(stripHtml(faqHtml)),
    openingN: norm(text.split(' ').slice(0, 100).join(' ')),
    unitTerms: units.map((u) => new Set([...coreTerms(u)])),
    text,
  };
}

const count = (h, p) => (p.trim().length < 3 ? 0 : h.split(p).length - 1);

// used: the exact phrase appears. variant: all of its words appear together in one sentence or
// heading (a natural rewording). missing: neither.
function usage(phrase, parts) {
  const p = norm(phrase);
  const total = count(parts.textN, p);
  const terms = coreTerms(phrase);
  const variant = total === 0 && terms.size > 0 && parts.unitTerms.some((u) => [...terms].every((t) => u.has(t)));
  const where: any[] = [];
  if (count(parts.titleN, p)) where.push('title');
  if (count(parts.metaN, p)) where.push('meta description');
  if (parts.headingsN.some((h) => count(h, p))) where.push('heading');
  if (count(parts.faqN, p)) where.push('FAQ');
  if (count(parts.openingN, p)) where.push('first 100 words');
  return { count: total, status: total > 0 ? 'used' : variant ? 'variant' : 'missing', where };
}

function questionUsage(question, headings) {
  const ts = [...coreTerms(question)].filter((t) => !['much', 'many', 'long', 'when', 'where', 'why', 'who'].includes(t));
  if (!ts.length) return false;
  return headings.some((h) => {
    const hn = norm(h);
    return ts.filter((t) => hn.includes(` ${t}`) || hn.includes(` ${t}s `)).length / ts.length >= 0.6;
  });
}

// Did the article carry out the plan? A secondary cluster is covered when the article uses its
// representative or any close variant.
function coverage(chosen, article) {
  const parts = splitParts(article);
  const secondary = chosen.secondary.map((s) => {
    const all = [s.keyword, ...s.variants].map((k) => ({ k, ...usage(k, parts) }));
    const best = all.find((a) => a.status === 'used') || all.find((a) => a.status === 'variant');
    return { ...s, status: best ? best.status : 'missing', count: all.reduce((n, a) => n + a.count, 0), where: [...new Set(all.flatMap((a) => a.where))], matched: best ? best.k : null };
  });
  const questions = chosen.questions.map((q) => ({ ...q, status: questionUsage(q.keyword, parts.headings) ? 'used' : 'missing' }));
  const related = chosen.related.map((r) => ({ ...r, ...usage(r.keyword, parts) }));
  const covered = secondary.filter((s) => s.status !== 'missing').length;
  return { secondary, questions, related, coveredSecondary: covered, parts };
}

export { chooseKeywords, planForPrompt, coverage, usage, splitParts, questionUsage, coreTerms, clusterList, norm };
