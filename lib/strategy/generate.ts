// @ts-nocheck -- the AI output is untyped JSON; every field is checked and rebuilt in code below.
// Monthly strategy generator. Claude does deep research (web search, no credit cap) and judgment;
// code fills every number from real dashboard data, computes the priority score, and validates.
import prisma from '../prisma';
import * as activity from '../activity';
import * as settings from '../settings';
import { callClaude } from '../anthropic';
import { gatherStrategyInputs, keywordData } from './inputs';
import {
  CORE_OBJECTIVE, SAFEGUARDS, SAFE_BACKLINK_METHODS, CHANNELS, priorityScore, validatePlan, keywordKey, nextPeriod, periodStart, metric,
} from './core';

// The strongest model available, at maximum effort, for strategy research. Override in Vercel.
const STRATEGY_MODEL = () => process.env.STRATEGY_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const STRATEGY_SEARCHES = () => Number(process.env.STRATEGY_MAX_SEARCHES) || 80;

function systemPrompt(siteUrl: string) {
  return `You are the head of search for USAIndiaCFO (${siteUrl}), a Virtual CFO firm for US-India
cross-border individuals and businesses (US and India tax, FEMA/RBI, entity setup, US GAAP, GST/ROC,
fundraising, family office). The site sits in a YMYL finance niche.

THE ONLY GOAL: ${CORE_OBJECTIVE.motive}
- SEO: ${CORE_OBJECTIVE.channels[0].meaning}
- AEO: ${CORE_OBJECTIVE.channels[1].meaning}
- GEO: ${CORE_OBJECTIVE.channels[2].meaning}
All three get real focus every month. The company name, the landing pages and the service pages must
win the top results for every related search: brand searches, service searches, and the questions
buyers ask. Organic leads are a signal only, never a goal.

RESEARCH LIKE IT MATTERS. Credits are not a constraint. Use web search extensively:
- Who ranks in the top 10 for each candidate topic in the US and India, what their pages cover, how
  fresh they are, what they miss (outdated law, ignored personas such as NRIs, Indian founders, US
  companies entering India, missing sub-questions).
- What Google AI Overviews, featured snippets and People Also Ask show for the topics, and which
  sources ChatGPT, Perplexity and Gemini tend to cite for them.
- Current rules: verify every regulatory claim against the primary source (irs.gov, incometax.gov.in,
  rbi.org.in, cbic-gst.gov.in, mca.gov.in, sebi.gov.in).
Read as many ranking pages as you need to be sure.

DATA RULES (strict):
- Use ONLY numbers from the JSON you are given. Never invent volumes, positions, clicks or counts.
  Code fills all metric columns from the data after you answer; you choose topics and set targets.
- If a number you need is missing, write "DATA MISSING: <metric>" in your text.
- Every item you output must carry "tags": one or more of "SEO", "AEO", "GEO".
- Targets must be strictly higher than last month's actual for every channel KPI that has a number.
- If a channel's lastMonthTrend is zero or negative, that channel gets top priority: at least 40% of
  blogs and 40% of tasks tagged with it, and summary.declineNotes.<channel> explains why it fell
  (from the data) and how this month fixes it.
- Keywords: one main keyword per blog; never reuse a keyword from "usedKeywords". At least 60% of
  blogs support a focus service. Intent mix about 50% informational, 35% commercial, 15% comparison.
  businessValue is 0-5 (5 = query names a paid service the firm sells).
- Backlinks: only these methods, spelled exactly: ${SAFE_BACKLINK_METHODS.join('; ')}. Use the
  SE Ranking backlink gap list for outreach targets. Never paid links, link farms, comment spam or PBNs.
- No em dashes anywhere.

Return ONLY JSON between ===JSON=== and ===END=== with this shape:
{
 "summary": { "focus": "one line", "strategyType": "e.g. Recovery | Growth | Authority | Defend and expand",
   "whyThisType": "based on last month's report numbers", "declineNotes": { "SEO|AEO|GEO": { "whyFell": "", "howFixed": "" } } },
 "included": [ { "item": "", "tags": ["SEO"] } ],
 "keywords": [ { "keyword": "", "intent": "informational|commercial|comparison", "serpFeature": "featured snippet|PAA|AI Overview|local pack|none",
   "tags": [], "businessValue": 0, "blogTitle": "", "newOrRefresh": "new|refresh", "refreshUrl": "", "focusService": "", "cluster": "" } ],
 "blogPlan": { "postingDays": ["Tue","Thu"], "calendar": [ { "title": "", "mainKeyword": "", "cluster": "", "tags": [], "focusService": "", "refreshUrl": "" } ] },
 "aeoGeo": { "items": [ { "type": "featured snippet|PAA|AI Overview|AI chat citation", "target": "query or topic", "page": "url or planned blog title",
   "directAnswerBlock": true, "faqSchema": true, "comparisonTable": false, "tags": [] } ] },
 "backlinks": [ { "targetSite": "", "method": "", "ourPage": "", "tags": [] } ],
 "technical": { "fixes": [ { "url": "", "issue": "", "fix": "", "tags": [] } ] },
 "targets": { "SEO": { "clicks": 0, "impressions": 0, "top3": 0, "top10": 0, "referringDomains": 0 },
   "AEO": { "featuredSnippets": 0, "paa": 0, "aiOverview": 0 }, "GEO": { "aiMentions": 0 } }
}`;
}

function parseJson(text: string) {
  const m = text.match(/===JSON===([\s\S]*?)===END===/);
  const raw = (m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, '');
  return JSON.parse(raw);
}

const TAGS = (t) => (Array.isArray(t) ? t.filter((x) => CHANNELS.includes(x)) : []);
const noDash = (v) => (typeof v === 'string' ? v.replace(/\u2014/g, ', ').replace(/\u2013/g, '-') : v);
function scrub(o) {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scrub(v)]));
  return noDash(o);
}

// Publish slots for the month: the given weekdays at the given IST time, in UTC text.
export function calendarSlots(period: string, days: string[], timeIst: string, count: number) {
  const start = periodStart(period);
  const [h, m] = String(timeIst || '10:00').split(':').map(Number);
  const wanted = new Set(days.map((d) => d.slice(0, 3).toLowerCase()));
  const out: string[] = [];
  for (let d = new Date(start); d.getUTCMonth() === start.getUTCMonth() && out.length < count; d.setUTCDate(d.getUTCDate() + 1)) {
    const name = d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' }).toLowerCase();
    if (!wanted.has(name)) continue;
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - 330 * 60000); // IST is UTC+5:30
    out.push(utc.toISOString().slice(0, 19).replace('T', ' '));
  }
  return out;
}

// Turns the AI's choices plus real data into the stored 11-section plan.
export async function buildPlan(ai, inputs, period) {
  ai = scrub(ai);
  const rankBy = new Map((inputs.rankings || []).map((r) => [keywordKey(r.keyword), r]));

  const keywords = [];
  for (const k of ai.keywords || []) {
    const r = rankBy.get(keywordKey(k.keyword));
    const d = r ? { volumeUs: null, volumeIndia: null, difficulty: null } : await keywordData(k.keyword);
    const row = {
      keyword: k.keyword,
      intent: k.intent,
      volumeUs: metric(d.volumeUs ?? (r?.volume || null), 'SE Ranking', 'current monthly average', 'US volume'),
      volumeIndia: metric(d.volumeIndia, 'SE Ranking', 'current monthly average', 'India volume'),
      difficulty: metric(d.difficulty, 'SE Ranking', 'current', 'difficulty'),
      currentPosition: metric(r?.position > 0 ? r.position : null, 'SE Ranking', r?.date || inputs.gatheredAt, 'current position'),
      serpFeature: k.serpFeature,
      tags: TAGS(k.tags),
      businessValue: Math.max(0, Math.min(5, Number(k.businessValue) || 0)),
      blogTitle: k.blogTitle,
      newOrRefresh: k.newOrRefresh === 'refresh' ? 'refresh' : 'new',
      refreshUrl: k.refreshUrl || '',
      focusService: k.focusService || '',
      cluster: k.cluster || '',
    };
    row.score = priorityScore({
      businessValue: row.businessValue,
      volumeUs: row.volumeUs.value,
      volumeIndia: row.volumeIndia.value,
      difficulty: row.difficulty.value,
      currentPosition: row.currentPosition.value,
    });
    keywords.push(row);
  }
  keywords.sort((a, b) => b.score - a.score);

  const days = (ai.blogPlan?.postingDays?.length ? ai.blogPlan.postingDays : String((await settings.get('posting_days')) || 'Tue,Thu').split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  const time = (await settings.get('posting_time_ist')) || '10:00';
  const cal = ai.blogPlan?.calendar || [];
  const slots = calendarSlots(period, days, time, cal.length);
  const calendar = cal.slice(0, slots.length).map((b, i) => ({
    publishDate: slots[i],
    title: b.title,
    mainKeyword: b.mainKeyword,
    cluster: b.cluster || '',
    tags: TAGS(b.tags),
    focusService: b.focusService || '',
    refreshUrl: b.refreshUrl || '',
    reviewDeadline: slots[i],
    reviewOpens: new Date(Date.parse(slots[i].replace(' ', 'T') + 'Z') - 24 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
    status: 'planned',
  }));

  // Backlink send dates spread across weekdays of the month.
  const sendSlots = calendarSlots(period, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '11:00', 40);
  const backlinks = (ai.backlinks || []).map((b, i) => ({
    targetSite: b.targetSite,
    method: b.method,
    ourPage: b.ourPage,
    sendDate: (sendSlots[i % Math.max(1, sendSlots.length)] || '').slice(0, 10),
    status: 'planned',
    tags: TAGS(b.tags),
  }));

  // Section 8: refresh triggers computed in code from the data.
  const refreshes = [];
  for (const r of inputs.rankings || []) {
    if (r.previousPosition > 0 && r.position > 0 && r.position - r.previousPosition >= 3)
      refreshes.push({ page: r.keyword, trigger: `Dropped ${r.position - r.previousPosition} positions (${r.previousPosition} to ${r.position})`, source: `SE Ranking, ${r.date}`, tags: ['SEO'] });
    else if (r.position >= 11 && r.position <= 20)
      refreshes.push({ page: r.keyword, trigger: `Stuck at position ${r.position} (11 to 20)`, source: `SE Ranking, ${r.date}`, tags: ['SEO'] });
  }
  const a = inputs.snapshot?.analysis || {};
  for (const s of a.strikingDistance?.clickProblems || []) {
    if (s.impressions >= 500 && s.ctr < 2)
      refreshes.push({ page: s.page, trigger: `High impressions (${s.impressions}), low CTR (${s.ctr}%) for "${s.query}"`, source: `Search Console, last ${s.windowDays} days`, tags: ['SEO', 'AEO'] });
  }
  for (const g of a.regulatoryRefresh || []) refreshes.push({ page: g.url || g.page, trigger: 'Changed tax rule (Income-tax Act 2025 wording)', source: 'WordPress content scan', tags: ['SEO', 'AEO', 'GEO'] });

  const L = inputs.lastMonth;
  const t = ai.targets || {};
  const tg = (channel, kpi, last, target) => ({ channel, kpi, lastMonth: last, target: target === undefined || target === null ? null : Number(target) });
  const targets = [
    tg('SEO', 'Clicks', L.SEO.clicks, t.SEO?.clicks),
    tg('SEO', 'Impressions', L.SEO.impressions, t.SEO?.impressions),
    tg('SEO', 'Top 3 keywords', L.SEO.top3, t.SEO?.top3),
    tg('SEO', 'Top 10 keywords', L.SEO.top10, t.SEO?.top10),
    tg('SEO', 'Referring domains', L.SEO.referringDomains, t.SEO?.referringDomains),
    tg('AEO', 'Featured snippets', L.AEO.featuredSnippets, t.AEO?.featuredSnippets),
    tg('AEO', 'PAA appearances', L.AEO.paa, t.AEO?.paa),
    tg('AEO', 'AI Overview citations', L.AEO.aiOverview, t.AEO?.aiOverview),
    tg('GEO', 'AI chat mentions', L.GEO.aiMentions, t.GEO?.aiMentions),
    { channel: 'Signal', kpi: 'Organic leads (Zoho CRM)', lastMonth: L.Signal.organicLeads, target: null },
  ];

  const crawl = inputs.crawl;
  return {
    schema: 2,
    period,
    coreObjective: CORE_OBJECTIVE,
    lastMonthTrend: inputs.lastMonthTrend,
    trendSources: inputs.trendSources,
    reportRange: inputs.reportRange,
    dataMissing: inputs.missing,
    summary: {
      month: period,
      focus: ai.summary?.focus || '',
      strategyType: ai.summary?.strategyType || '',
      whyThisType: ai.summary?.whyThisType || '',
      declineNotes: ai.summary?.declineNotes || {},
    },
    included: (ai.included || []).map((x) => ({ item: x.item, tags: TAGS(x.tags) })),
    keywords,
    blogPlan: {
      newCount: calendar.filter((b) => !b.refreshUrl).length,
      refreshCount: calendar.filter((b) => b.refreshUrl).length,
      postingDays: days,
      postingTime: `${time} IST`,
      calendar,
    },
    aeoGeo: { items: (ai.aeoGeo?.items || []).map((x) => ({ ...x, tags: TAGS(x.tags) })) },
    backlinks,
    automation: [
      { platform: 'Claude API', what: 'Writes each blog with deep research, then an independent maximum-effort fact check', when: '2 days before each publish slot' },
      { platform: 'Dashboard', what: 'Opens the 24-hour review window and notifies reviewers', when: '24 hours before each publish slot' },
      { platform: 'Website CMS (WordPress)', what: 'Publishes the reviewed or auto-approved blog with FAQ schema', when: 'At each publish slot' },
      { platform: 'Bing IndexNow', what: 'Submits each new or updated URL', when: 'Right after publishing' },
      { platform: 'Google Search Console', what: 'Sitemap resubmitted so Google recrawls the new URL', when: 'Right after publishing' },
      { platform: 'SE Ranking', what: 'Adds the main keyword to rank tracking; daily rank check with 5+ drop alert', when: 'After publishing; daily' },
      { platform: 'Website CMS (WordPress)', what: 'Adds internal links from 2 to 3 older related posts', when: 'Right after publishing' },
      { platform: 'Surfer', what: 'Content score check (75+ required)', when: 'Before each publish' },
      { platform: 'SERPHouse', what: 'Featured snippet, PAA and AI Overview checks', when: 'Weekly plan vs actual' },
      { platform: 'Screaming Frog', what: 'Crawl upload parsed into Section 8 fixes', when: 'On each upload (required before approval)' },
    ],
    technical: {
      crawl: crawl ? { uploadedAt: crawl.uploadedAt, uploadedBy: crawl.uploadedBy, totalUrls: crawl.totalUrls } : null,
      fixes: [...(crawl ? technicalFixesFromCrawl(crawl) : []), ...(ai.technical?.fixes || []).map((f) => ({ ...f, tags: TAGS(f.tags), fromAi: true }))],
      refreshes: refreshes.slice(0, 40),
    },
    targets,
    safeguards: SAFEGUARDS,
  };
}

// Section 8 only, rebuilt from a new crawl without another AI run.
export function technicalFixesFromCrawl(crawl) {
  const fixes = [];
  for (const p of crawl?.problems || []) {
    for (const issue of p.issues || []) {
      const fix = /status code/.test(issue) ? 'Fix or 301 redirect the URL and update links pointing to it'
        : /Missing title/.test(issue) ? 'Write a unique title under 60 characters'
        : /Duplicate title/.test(issue) ? 'Make the title unique to this page'
        : /meta/.test(issue) ? 'Write a meta description under 160 characters'
        : /Thin/.test(issue) ? 'Expand with a direct answer, FAQ and examples, or merge into a stronger page'
        : 'Review';
      fixes.push({ url: p.url, issue, fix, tags: /Thin/.test(issue) ? ['SEO', 'AEO'] : ['SEO'] });
    }
  }
  for (const l of crawl?.linkIssues || []) fixes.push({ url: l.source, issue: `Broken link to ${l.target} (${l.status})`, fix: 'Replace or remove the broken link', tags: ['SEO'] });
  return fixes.slice(0, 80);
}

export async function generateStrategy({ period = nextPeriod(), actor = 'Monthly auto-run', onProgress, signal }: any = {}) {
  const siteUrl = process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com';
  onProgress?.('Collecting real data from every connected tool', 3);
  const inputs = await gatherStrategyInputs({ onStep: (l, f) => onProgress?.(l, Math.round(3 + 40 * f)) });

  onProgress?.('Deep research and writing the strategy', 45);
  const { snapshot, rankings, ...rest } = inputs;
  const payload = {
    period,
    today: new Date().toISOString().slice(0, 10),
    ...rest,
    trackedKeywords: (rankings || []).slice(0, 150),
    analysis: snapshot?.analysis ? {
      scoreboard: snapshot.analysis.scoreboard,
      strikingDistance: snapshot.analysis.strikingDistance,
      decay: snapshot.analysis.decay,
      cannibalization: snapshot.analysis.cannibalization,
      regulatoryRefresh: snapshot.analysis.regulatoryRefresh,
      aiVisibility: snapshot.analysis.aiVisibility,
      searchCompetitors: snapshot.analysis.searchCompetitors,
      candidates: snapshot.analysis.candidates,
    } : 'DATA MISSING: site analysis',
  };
  const messages = [{ role: 'user', content: `Build the ${period} strategy from this data (JSON):\n${JSON.stringify(payload).slice(0, 180000)}` }];
  const opts = { maxUses: STRATEGY_SEARCHES(), effort: 'max', model: STRATEGY_MODEL() };
  const { text, assistantMessages } = await callClaude(systemPrompt(siteUrl), messages, signal, opts);
  let ai;
  try {
    ai = parseJson(text);
  } catch (err: any) {
    const retry = await callClaude(systemPrompt(siteUrl), [...messages, ...assistantMessages, { role: 'user', content: `Not valid JSON (${err.message}). Return the same strategy as valid JSON between ===JSON=== and ===END===.` }], signal, { ...opts, maxUses: 1 });
    ai = parseJson(retry.text);
  }

  onProgress?.('Filling numbers from data and validating', 85);
  const plan = await buildPlan(ai, inputs, period);
  const used = new Set((await prisma.strategy_keywords.findMany({ select: { keyword_key: true } })).map((k) => k.keyword_key));
  const validation = validatePlan(plan, { usedKeywords: used, focusServices: inputs.focusServices });

  // Older strategies for the same month that were never approved are replaced by this one.
  await prisma.seo_strategies.updateMany({ where: { period, status: { in: ['pending_review'] } }, data: { status: 'superseded' } });
  const row = await prisma.seo_strategies.create({
    data: {
      period,
      summary: plan.summary.focus,
      plan_json: JSON.stringify(plan),
      validation: JSON.stringify(validation),
      data_snapshot: JSON.stringify(snapshot || {}),
      status: 'pending_review',
      version: 1,
    },
  });
  await activity.log('strategy.generated', { entityType: 'seo_strategy', entityId: row.id, details: `${period}: ${validation.errors.length} validation error(s)`, actor });
  onProgress?.('Done', 100);
  return row.id;
}
