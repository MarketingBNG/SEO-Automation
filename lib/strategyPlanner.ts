// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as activity from './activity';
import prisma from './prisma';
import { callClaude } from './anthropic';
import { priorityScore } from './strategyAnalysis';
import { deadlineFactor } from './seoCalendar';
import { gatherSnapshot } from './seoStrategy';
// The monthly SEO/GEO strategy and report. The analysis numbers come from code
// (lib/strategyAnalysis.js); the AI adds live competitor research, judgment on business value,
// confidence and effort, and the narrative. Each pick's priority is then computed in code with
// the published formula, so the approver can see and challenge every input.


const ACTIONS = ['new', 'refresh', 'consolidate', 'service_page'];
const EFFORTS = [1, 2, 3, 5];

function systemPrompt() {
  const siteUrl = process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com';
  return `You are the SEO and GEO strategist for USAIndiaCFO (${siteUrl}), a Virtual CFO firm for US-India
cross-border individuals and businesses (US and India tax, FEMA/RBI, entity setup, US GAAP, GST/ROC,
fundraising, family office). The firm has limited writing capacity, sells high-value services, and
publishes in a YMYL (financial) niche, so every piece must earn its place.

You receive this month's analysis, computed in code from Search Console, GA4, SE Ranking, SERPHouse
(live Google results incl. AI Overviews and "People also ask"), WordPress, Screaming Frog, PageSpeed
and Clarity. Treat those numbers as exact. Never invent a number; if something is missing, say so.

METHOD (verified research; follow it in this order)
1. Data hygiene first. Read "dataHygiene". Search Console impressions, CTR and position were
   over-reported from 2025-05-13 to 2026-04-27 (clicks were not), so trust impressions only in
   windows starting 2026-04-28 or later; compare year over year on clicks only. Do not react to a
   change that a listed Google event explains, and after a core update wait a full week before judging.
   Never cite the 7 May 2026 FAQ rich-result removal as a cause: those results had shown only for
   well-known government and health sites since 2023. Non-branded clicks include anonymized queries.
2. Scoreboard. Business outcomes first: organic conversions (GA4) and leads; then NON-BRANDED clicks by
   market (US and India); then tracked keywords in the top 10 and AI Overview visibility. Branded clicks
   mostly reflect existing demand, not SEO wins. Never set a goal on average position.
3. Diagnosis. Use the decay types exactly as classified: ranking_decay = upgrade the content;
   zero_click_capture = the AI Overview or SERP took the click, so rework the answer block, title and
   citable facts, not a rewrite; demand_decay = deprioritize or time it to the next deadline.
   Striking distance: positions 4-10 are click problems (title, meta description, a direct answer near
   the top, a section matching the query wording); 11-20 are ranking problems (depth, sub-questions,
   internal links from the pillar and siblings, fresher facts and citations). Skip minor slips.
4. Cannibalization. Before any NEW article, check the candidates: if an existing URL already earns
   impressions for the keyword (route "refresh" or an existingPage), refresh that URL instead. If two of
   our URLs split a query with the same intent, merge into the stronger one and 301 the weaker one.
   Never fix cannibalization with canonical, noindex or deletion.
5. Regulatory trigger. India's Income-tax Act 2025 applies from Tax Year 2026-27 and replaces the
   Assessment Year / Previous Year system. Posts in "regulatoryRefresh" need a transition note and
   updated references; the highest-traffic ones outrank normal picks. Verify any legal claim you state
   against the primary source (incometaxindia.gov.in, irs.gov, rbi.org.in) with web search.
6. Research. Use web search to see who ranks for the priority topics (start from "searchCompetitors"
   and "aiVisibility.topCompetitors"), what they do well, and where they are weak: outdated law, a
   persona they ignore (NRIs, Indian founders, US companies entering India), or sub-questions they miss.
   Competitors are whoever ranks, including publishers, fintechs and government pages.
   Mix rules for the 8 slots: at least 3 with business value 3, at most 2 with value 1, none with 0, at
   most 2 top-of-funnel explainers, between 2 and 6 refreshes, and at most 2 regulatory rewrites.
7. Pick the month's 8 pieces. Choose from "candidates" (reference its id) or propose new topics you
   found. Weight toward bottom-of-funnel: at least 3-4 picks with business value 3 (queries naming a paid
   service, comparisons, "how do I" jobs the firm does), at most about 2 pure explainers, and only when
   they fill a gap in a pillar. Existing URLs with impressions beat new URLs for the same keyword. Match
   the format to the live results (if the top results are service pages, upgrade a service page; if
   they are government pages, write the practitioner explainer that cites them; if they are tools,
   consider a simple calculator). Use FAQ questions from "People also ask". Every pick must map to a
   service the firm sells, add something the current top 5 lack (worked numbers, a practitioner example,
   a decision table, a client-question insight), and never be a templated near-duplicate
   (e.g. "[topic] for NRIs in [city]").
8. Score inputs (the code computes the final priority as
   TP12 x Business Value x Deadline Factor x Confidence / Effort, where TP12 is the expected extra
   clicks over the next 12 months, already computed for every candidate):
   - businessValue 0-3: 3 = the query names a paid service; 2 = our service solves the problem;
     1 = tangential; 0 = do not pick it.
   - confidence 0.3-1.0: higher when Search Console already shows impressions, lower when only a volume
     is known or the keyword is far harder than what the site ranks for today.
   - effort: 1 = quick edit (title, meta, answer block, FAQ additions, transition note), 2 = major refresh
     or consolidation (15-70% of the page changes), 3 = new article, 5 = calculator, tool or data asset.
     Effort-1 items go to a separate quick-edit track, not into the 8 slots, so propose up to 8 picks of
     effort 2 or more plus any number of effort-1 quick edits.
   - deadline: the ISO date from "deadlines" this piece is timed for, or null.
   - trafficPotentialEstimate: ONLY for a new topic with no candidate id: expected extra clicks over 12
     months = monthly volume x the site's CTR at position 5 (analysis.ctrCurve) x 12 x 0.1 (chance a new
     page reaches the top 5) x 0.5 (half the year at target), x 0.28 if an AI Overview shows and does not
     cite us. Otherwise null.
   - deadlines: a NEW page needs 90-180 days before a deadline to rank; a refresh of a ranking page pays
     off 45-90 days ahead. Do not plan a new page for a deadline under 90 days away.
9. GEO (AI search). There are no special tricks: AI Overviews and AI Mode use normal ranking plus
   "query fan-out" across sub-questions, and brand mentions on other sites correlate with AI visibility
   far more than backlinks. Recommend covering fan-out sub-questions in each pick, and earned-media
   actions (expert commentary through Qwoted, Featured or Source of Sources; HARO closed in 2024; one
   original data asset per quarter from anonymized client-question patterns). Never buy links. Any
   statistic drawn from client tax-return data must satisfy IRC section 7216: anonymous, aggregated from
   at least 10 returns, and no refund, credit or deduction amounts in marketing.
   Report AI visibility from the data you have: "aiVisibility" (does Google's AI Overview cite us),
   "aiReferrals" (visits from ChatGPT, Perplexity, Gemini, Copilot, Claude) and "questionBank" (new
   People also ask questions: say which existing pages should answer them). AI answers vary run to
   run, so talk in rates and trends, never an "AI rank".
10. Technical: the top 5 fixes from the Screaming Frog crawl, Core Web Vitals and Clarity data, each with
   impact and effort. Work with no clear route to leads does not get scheduled.
11. Quick wins outside the 8 slots: effort-1 fixes (title, meta description, answer block, FAQ additions)
   for click problems and pages cited nowhere, listed separately.
12. Measurement gaps: say plainly what cannot be measured yet and the one-time fix, for example: website
   forms not passing the first landing page and referrer into Zoho (so SEO leads look like "direct"),
   Bing Webmaster Tools not verified (it is the only first-party AI citation count, for Copilot),
   Search Console's Generative AI report being UI-only, and no data at all on ChatGPT, Perplexity or
   Gemini answers without a prompt-tracking tool.
13. YMYL quality bar on every pick: a named author and a CPA, EA or CA reviewer, primary-source
   citations, the tax year and a "last reviewed" date, and a real update before any date change.

WRITING: plain, specific English. No em dashes. No hype words. Name keywords, URLs and numbers.

Return ONLY this, with valid JSON between the markers and nothing else:
===JSON===
{
  "summary": "3-5 sentences: the state of search for the firm this month and the single top priority",
  "dataNotes": ["how the data-hygiene events affect reading this month's numbers", "..."],
  "scoreboardNotes": ["what the scoreboard says, with the numbers", "..."],
  "diagnosis": ["one finding per line: decay, striking distance, cannibalization, regulatory, with URL and numbers"],
  "picks": [
    {
      "candidateId": "C3 or null",
      "keyword": "primary keyword",
      "action": "new | refresh | consolidate | service_page",
      "targetUrl": "existing URL for refresh/consolidate/service_page, else null",
      "workingTitle": "50-60 character title",
      "format": "guide | checklist | comparison | calculator | deadline page | service page upgrade",
      "segment": "which reader: e.g. Indian founders entering the US",
      "funnel": "BOFU | MOFU | TOFU",
      "businessValue": 3,
      "confidence": 0.8,
      "effort": 3,
      "deadline": "YYYY-MM-DD or null",
      "trafficPotentialEstimate": null,
      "why": "why this, now, in one or two sentences with the evidence",
      "addsBeyondTop5": "the specific thing this piece has that the current top results lack",
      "subQuestions": ["fan-out sub-questions the piece must answer"],
      "faqQuestions": ["People also ask questions to use in the FAQ"],
      "internalLinks": ["link up to the pillar or service page URL", "sibling post URL"]
    }
  ],
  "quickWins": ["effort-1 fix: page URL, what to change and why"],
  "consolidation": [{ "query": "", "keepUrl": "", "mergeUrl": "", "reason": "" }],
  "technical": [{ "fix": "", "impact": "high | medium | low", "effort": "low | medium | high", "evidence": "" }],
  "geo": ["AI search actions for this month"],
  "authority": ["earned-mention actions for this month"],
  "competitors": [{ "domain": "", "whatWorks": "", "gap": "" }],
  "measurementGaps": ["what cannot be measured yet and the one-time fix"],
  "risks": ["risks and open questions for the approver"]
}
===END===`;
}

// Keeps the prompt focused: the computed analysis first (it must never be cut off), then the other
// sources, without the raw duplicates.
function buildInput(snapshot) {
  const { analysis, monthOverMonth, pageSpeed, clarity, technicalCrawl, zohoLeads } = snapshot;
  const errors = Object.fromEntries(Object.entries(snapshot).filter(([k]) => k.endsWith('Error')));
  const input = { analysis, monthOverMonth, pageSpeed, clarity, technicalCrawl, zohoLeads, unavailableSources: errors };
  return JSON.stringify(input, null, 1).slice(0, 150000);
}

function parseJsonBlock(text) {
  const start = text.indexOf('===JSON===');
  const body = start === -1 ? text : text.slice(start + '===JSON==='.length, text.indexOf('===END===', start) === -1 ? undefined : text.indexOf('===END===', start));
  const from = body.indexOf('{');
  const to = body.lastIndexOf('}');
  if (from === -1 || to === -1) throw new Error('The strategy response had no JSON.');
  return JSON.parse(body.slice(from, to + 1));
}

const str = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s*—\s*/g, ', ').trim().slice(0, max) : '');
const list = (v, max = 12) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, max) : []);

// Computes each pick's priority from its inputs and sorts the plan. Traffic potential comes from
// the data when the pick is one of the computed candidates; otherwise it is the AI's estimate and
// is labelled as such.
function finalizePlan(result, analysis) {
  const candidates = new Map((analysis?.candidates || []).map((c) => [c.id, c]));
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const picks = (Array.isArray(result.picks) ? result.picks : []).slice(0, 20).map((p, i) => {
    const candidate = p.candidateId ? candidates.get(String(p.candidateId).trim()) : null;
    const fromData = candidate && typeof candidate.trafficPotential === 'number';
    const trafficPotential = fromData ? candidate.trafficPotential : Math.max(0, Number(p.trafficPotentialEstimate) || 0);
    const action = ACTIONS.includes(p.action) ? p.action : candidate?.action === 'refresh' ? 'refresh' : 'new';
    let df = 1;
    let deadline: any = null;
    if (typeof p.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline)) {
      deadline = p.deadline;
      df = deadlineFactor(Math.round((Date.parse(`${p.deadline}T00:00:00Z`) - today) / 86400000), { refresh: action !== 'new' });
    }
    const businessValue = Math.max(0, Math.min(3, Math.round(Number(p.businessValue) || 0)));
    // Confidence comes from our own ranking data when we have it; a topic with no data is capped.
    const confidence =
      typeof candidate?.confidenceHint === 'number'
        ? candidate.confidenceHint
        : Math.max(0.4, Math.min(fromData ? 1 : 0.7, Number(p.confidence) || 0.5));
    const effort = EFFORTS.includes(Number(p.effort)) ? Number(p.effort) : candidate?.effortHint || 3;
    return {
      index: i,
      candidateId: candidate ? candidate.id : null,
      keyword: str(p.keyword, 120) || candidate?.keyword || '',
      action,
      targetUrl: str(p.targetUrl, 300) || candidate?.targetUrl || null,
      workingTitle: str(p.workingTitle, 120),
      format: str(p.format, 60),
      segment: str(p.segment, 120),
      funnel: ['BOFU', 'MOFU', 'TOFU'].includes(p.funnel) ? p.funnel : '',
      why: str(p.why),
      addsBeyondTop5: str(p.addsBeyondTop5),
      subQuestions: list(p.subQuestions, 10),
      faqQuestions: list(p.faqQuestions, 6),
      internalLinks: list(p.internalLinks, 8),
      source: candidate?.source || 'new topic from research',
      regulatory: Boolean(candidate?.regulatory),
      evidence: candidate?.evidence || '',
      basis: candidate?.basis || (fromData ? '' : 'AI estimate for a new topic'),
      score: {
        trafficPotential,
        trafficPotentialSource: fromData ? 'data' : 'estimate',
        businessValue,
        deadlineFactor: df,
        deadline,
        confidence,
        effort,
        priority: priorityScore({ trafficPotential, businessValue, deadlineFactor: df, confidence, effort }),
      },
      status: { keywordId: null, auditId: null },
    };
  });
  // Selection rules from the research. Value-0 work is never scheduled. Effort-1 items form a
  // separate quick-edit track. The 8 slots are filled by score, with at most 2 law-change rewrites
  // placed first; the mix rules are checked and reported for the approver.
  const kept = picks.filter((p) => p.score.businessValue > 0);
  const byScore = (a, b) => Number(b.regulatory) - Number(a.regulatory) || b.score.priority - a.score.priority;
  const quickEdits = kept.filter((p) => p.score.effort === 1).sort(byScore);
  const larger = kept.filter((p) => p.score.effort > 1).sort((a, b) => b.score.priority - a.score.priority);
  const regulatoryFirst = larger.filter((p) => p.regulatory).slice(0, 2);
  const slots = [...regulatoryFirst];
  const tally = (fn) => slots.filter(fn).length;
  const isRefresh = (p) => p.action !== 'new';
  for (const p of larger) {
    if (slots.length >= 8 || slots.includes(p)) continue;
    if (p.score.businessValue === 1 && tally((x) => x.score.businessValue === 1) >= 2) continue;
    if (p.funnel === 'TOFU' && tally((x) => x.funnel === 'TOFU') >= 2) continue;
    if (isRefresh(p) && tally(isRefresh) >= 6) continue;
    slots.push(p);
  }
  // Swap in bottom-of-funnel work and refreshes when the mix falls short, replacing the
  // lowest-scoring slot that is not itself needed for the mix.
  const swapIn = (need, candidatesFor, replaceable) => {
    for (const c of larger.filter((p) => !slots.includes(p) && candidatesFor(p))) {
      if (!need()) break;
      const victims = slots.filter((s) => !s.regulatory && replaceable(s)).sort((a, b) => a.score.priority - b.score.priority);
      if (!victims.length) break;
      slots.splice(slots.indexOf(victims[0]), 1, c);
    }
  };
  swapIn(() => tally((x) => x.score.businessValue === 3) < 3, (p) => p.score.businessValue === 3, (s) => s.score.businessValue !== 3);
  swapIn(() => tally(isRefresh) < 2, isRefresh, (s) => !isRefresh(s) && s.score.businessValue !== 3);
  slots.sort((a, b) => Number(b.regulatory && regulatoryFirst.includes(b)) - Number(a.regulatory && regulatoryFirst.includes(a)) || b.score.priority - a.score.priority);
  const overflow = larger.filter((p) => !slots.includes(p));
  [...slots, ...quickEdits, ...overflow].forEach((p, i) => (p.index = i));

  const planChecks: any[] = [];
  const dropped = picks.length - kept.length;
  if (dropped) planChecks.push(`${dropped} pick(s) with business value 0 were dropped.`);
  const count = (fn) => slots.filter(fn).length;
  const bv3 = count((p) => p.score.businessValue === 3);
  const bv1 = count((p) => p.score.businessValue === 1);
  const tofu = count((p) => p.funnel === 'TOFU');
  const refreshes = count((p) => p.action !== 'new');
  if (bv3 < 3) planChecks.push(`Only ${bv3} of the 8 slots are bottom-of-funnel (value 3); the method asks for at least 3.`);
  if (bv1 > 2) planChecks.push(`${bv1} slots are only tangential (value 1); the method allows at most 2.`);
  if (tofu > 2) planChecks.push(`${tofu} slots are top-of-funnel explainers; the method allows at most 2.`);
  if (slots.length >= 4 && (refreshes < 2 || refreshes > 6)) planChecks.push(`${refreshes} of the slots are refreshes; the method keeps it between 2 and 6.`);
  if (overflow.length) planChecks.push(`${overflow.length} more pick(s) scored lower and are listed as next in line.`);
  if (kept.some((p) => p.score.trafficPotentialSource === 'estimate')) {
    planChecks.push('Traffic figures marked "est." are AI estimates for new topics, not from your data.');
  }

  return {
    planChecks,
    summary: str(result.summary, 1500),
    dataNotes: list(result.dataNotes),
    scoreboardNotes: list(result.scoreboardNotes),
    diagnosis: list(result.diagnosis, 15),
    picks: slots,
    quickEdits,
    nextInLine: overflow,
    consolidation: (Array.isArray(result.consolidation) ? result.consolidation : []).slice(0, 8).map((c) => ({
      query: str(c.query, 150),
      keepUrl: str(c.keepUrl, 300),
      mergeUrl: str(c.mergeUrl, 300),
      reason: str(c.reason),
    })),
    technical: (Array.isArray(result.technical) ? result.technical : []).slice(0, 5).map((t) => ({
      fix: str(t.fix),
      impact: str(t.impact, 10),
      effort: str(t.effort, 10),
      evidence: str(t.evidence),
    })),
    quickWins: list(result.quickWins),
    geo: list(result.geo),
    authority: list(result.authority),
    measurementGaps: list(result.measurementGaps),
    competitors: (Array.isArray(result.competitors) ? result.competitors : []).slice(0, 8).map((c) => ({
      domain: str(c.domain, 100),
      whatWorks: str(c.whatWorks),
      gap: str(c.gap),
    })),
    risks: list(result.risks),
  };
}

async function generateSeoStrategy(snapshot, period, { signal, onProgress, batch = false }: any = {}) {
  onProgress?.('Researching competitors and writing the plan…', 55);
  const messages = [
    {
      role: 'user',
      content: `Period: ${period}. Today is ${new Date().toISOString().slice(0, 10)}.\n\nThis month's data (JSON):\n${buildInput(snapshot)}\n\nProduce the strategy for this period.`,
    },
  ];
  const { text, assistantMessages } = await callClaude(systemPrompt(), messages, signal, { maxUses: 10, batch });
  let parsed: any;
  try {
    parsed = parseJsonBlock(text);
  } catch (err: any) {
    // One repair round with the exact previous turn sent back (the model rejects edited history).
    onProgress?.('Fixing the plan format…', 85);
    const retry = await callClaude(
      systemPrompt(),
      [...messages, ...assistantMessages, { role: 'user', content: `That was not valid JSON (${err.message}). Return the same strategy again as valid JSON between ===JSON=== and ===END===, nothing else.` }],
      signal,
      { maxUses: 1, effort: 'medium', batch }
    );
    parsed = parseJsonBlock(retry.text);
  }
  const report = finalizePlan(parsed, snapshot.analysis);
  // Kept so a stored plan can be re-scored if the formula changes, without another AI run.
  report.aiOutput = parsed;

  // The older columns stay filled so the blog writer's "approved strategy" context and the
  // assistant keep working.
  return {
    report,
    summary: report.summary,
    keywordPriorities: report.picks.map((p) => `${p.keyword} (${p.action}${p.targetUrl ? `: ${p.targetUrl}` : ''}): ${p.why}`),
    contentRecommendations: [
      ...report.picks.map((p) => `${p.workingTitle || p.keyword} [${p.format || p.action}] adds: ${p.addsBeyondTop5}`),
      ...report.quickEdits.map((p) => `Quick edit: ${p.targetUrl || p.keyword}: ${p.why}`),
    ],
    technicalRecommendations: report.technical.map((t) => `${t.fix} (impact ${t.impact}, effort ${t.effort})`),
    competitorNotes: report.competitors.map((c) => `${c.domain}: ${c.whatWorks} Gap: ${c.gap}`).join('\n'),
    raw: text,
  };
}

// The month the plan is for: from the 25th on, a new plan is for next month.
function currentPeriod(now = new Date()) {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const target = ist.getDate() >= 25 ? new Date(ist.getFullYear(), ist.getMonth() + 1, 1) : ist;
  return target.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Gathers every source, writes the plan and stores it for review.
async function createStrategy({ period = currentPeriod(), signal, onProgress, actor, batch = false }: any = {}) {
  onProgress?.('Collecting data from Search Console, GA4, SE Ranking, SERPHouse, WordPress and the crawl…', 5);
  const snapshot = await gatherSnapshot({ onStep: (label, fraction) => onProgress?.(`${label}…`, Math.round(5 + 45 * fraction)) });
  if (signal?.aborted) throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

  const result = await generateSeoStrategy(snapshot, period, { signal, onProgress, batch });
  onProgress?.('Saving the plan…', 95);

  const r = await prisma.seo_strategies.create({
    data: {
      period,
      summary: result.summary,
      keyword_priorities: JSON.stringify(result.keywordPriorities),
      content_recommendations: JSON.stringify(result.contentRecommendations),
      technical_recommendations: JSON.stringify(result.technicalRecommendations),
      competitor_notes: result.competitorNotes,
      data_snapshot: JSON.stringify(snapshot),
      report_json: JSON.stringify(result.report),
      status: 'pending_review',
    },
  });
  await activity.log('strategy.generated', {
    entityType: 'seo_strategy',
    entityId: r.id,
    details: `${period}: ${result.report.picks.length} picks, ${result.report.quickEdits.length} quick edits`,
    ...(actor ? { actor } : {}),
  });
  return Number(r.id);
}

function parseStrategyRow(r) {
  return {
    ...r,
    keyword_priorities: JSON.parse(r.keyword_priorities || '[]'),
    content_recommendations: JSON.parse(r.content_recommendations || '[]'),
    technical_recommendations: JSON.parse(r.technical_recommendations || '[]'),
    data_snapshot: JSON.parse(r.data_snapshot || '{}'),
    report: r.report_json ? JSON.parse(r.report_json) : null,
  };
}

// The brief that goes into the blog pipeline with an approved "new" pick, so the writer follows
// the plan: angle, reader, format, sub-questions, FAQ and internal links.
function pickBrief(pick, period) {
  return [
    `From the ${period} SEO strategy.`,
    pick.workingTitle && `Working title: ${pick.workingTitle}.`,
    pick.segment && `Reader: ${pick.segment}.`,
    pick.format && `Format: ${pick.format}.`,
    pick.addsBeyondTop5 && `Must add beyond the current top results: ${pick.addsBeyondTop5}`,
    pick.subQuestions.length && `Answer these sub-questions: ${pick.subQuestions.join(' | ')}`,
    pick.faqQuestions.length && `Suggested FAQ questions (prefer the live Google "People also ask" list in the research brief where they differ): ${pick.faqQuestions.join(' | ')}`,
    pick.internalLinks.length && `Internal links to include: ${pick.internalLinks.join(' | ')}`,
    pick.score.deadline && `Time it for the ${pick.score.deadline} deadline.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export { generateSeoStrategy, createStrategy, finalizePlan, parseStrategyRow, pickBrief, currentPeriod, parseJsonBlock };
