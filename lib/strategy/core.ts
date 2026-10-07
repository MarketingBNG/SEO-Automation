// Strategy v2: the pure rules of the monthly SEO / AEO / GEO strategy. No database or network
// calls here, so every rule is unit tested (tests/strategy.test.ts) and shared by the server
// routes, the cron jobs and the UI.

export const CHANNELS = ['SEO', 'AEO', 'GEO'] as const;
export type Channel = (typeof CHANNELS)[number];

// Shown at the top of every strategy. Hardcoded on purpose: the AI cannot change it.
export const CORE_OBJECTIVE = {
  motive: "Grow the website's visibility and rankings across SEO, AEO and GEO.",
  channels: [
    { channel: 'SEO', meaning: 'Higher rankings in normal Google and Bing results.' },
    { channel: 'AEO', meaning: 'Featured snippets, People Also Ask, Google AI Overviews and voice answers.' },
    { channel: 'GEO', meaning: 'Mentions and citations in AI chat answers (ChatGPT, Perplexity, Gemini).' },
  ],
  signalNote: 'Organic leads from Zoho CRM are shown as a signal only, never as a goal.',
};

export const SECTION_ORDER = [
  { key: 'summary', title: '1. Strategy summary' },
  { key: 'included', title: "2. What's included" },
  { key: 'keywords', title: '3. Keyword and topic plan' },
  { key: 'blogPlan', title: '4. Blog plan' },
  { key: 'aeoGeo', title: '5. AEO and GEO plan' },
  { key: 'backlinks', title: '6. Backlink plan' },
  { key: 'automation', title: '7. Automation map' },
  { key: 'technical', title: '8. Technical and refresh plan' },
  { key: 'targets', title: '9. Monthly targets' },
  { key: 'safeguards', title: '10. Automatic safeguards' },
  { key: 'actions', title: '11. Action buttons' },
] as const;

// Sections a reviewer may edit (summary text, tables and targets). 7, 10 and 11 are fixed.
export const EDITABLE_SECTIONS = ['summary', 'included', 'keywords', 'blogPlan', 'aeoGeo', 'backlinks', 'technical', 'targets'] as const;

export const SAFE_BACKLINK_METHODS = [
  'Outreach to SE Ranking backlink gap site',
  'Unlinked brand mention',
  'Broken link replacement',
  'Directory or citation listing',
  'Internal linking (automatic)',
] as const;
const BANNED_LINK_WORDS = /\b(paid|buy|sponsored link|link farm|pbn|private blog network|comment spam|link exchange scheme)\b/i;

export const SAFEGUARDS = [
  { name: 'Daily rank check', rule: 'Every priority keyword is checked daily. An alert is raised when one drops 5 or more positions.' },
  { name: 'Weekly plan vs actual', rule: 'Every Monday the published blogs, backlink tasks and fixes are compared with the plan.' },
  { name: 'Automatic fact check', rule: 'Every claim in every blog is checked against official sources, corrected, and checked again until two checks in a row are clean (up to 50 rounds). A blog that cannot be fully verified is held, never published.' },
  { name: 'Crawl and indexing pause', rule: 'Auto-publishing pauses while the latest crawl shows server errors or the site is not indexable.' },
];

export const DATA_MISSING = (metric: string) => `DATA MISSING: ${metric}`;

// A number on the page always carries where it came from and for which dates.
export type Metric = { value: number | null; source: string; range: string; missing?: string };
export const metric = (value: number | null | undefined, source: string, range: string, name: string): Metric =>
  typeof value === 'number' && Number.isFinite(value) ? { value, source, range } : { value: null, source, range, missing: DATA_MISSING(name) };

// ---------- Section 3: priority score ----------
// Priority score = (Business value x 3) + (Volume score x 2) + (Ease score x 2) + 5 if ranking 11-20.
// Business value is 0-5 (judged against the focus services), volume and ease are 0-5 from data.
export function volumeScore(volume: number | null | undefined): number {
  if (!volume || volume <= 0) return 0;
  if (volume >= 5000) return 5;
  if (volume >= 1000) return 4;
  if (volume >= 300) return 3;
  if (volume >= 100) return 2;
  return 1;
}
export function easeScore(difficulty: number | null | undefined): number {
  if (difficulty === null || difficulty === undefined || !Number.isFinite(difficulty)) return 0;
  if (difficulty <= 15) return 5;
  if (difficulty <= 30) return 4;
  if (difficulty <= 45) return 3;
  if (difficulty <= 60) return 2;
  if (difficulty <= 75) return 1;
  return 0;
}
export function priorityScore({ businessValue, volumeUs, volumeIndia, difficulty, currentPosition }: any): number {
  const bv = Math.max(0, Math.min(5, Number(businessValue) || 0));
  const vol = (Number(volumeUs) || 0) + (Number(volumeIndia) || 0);
  const striking = Number(currentPosition) >= 11 && Number(currentPosition) <= 20 ? 5 : 0;
  return bv * 3 + volumeScore(vol) * 2 + easeScore(difficulty === null ? null : Number(difficulty)) * 2 + striking;
}

export const keywordKey = (k: string) => String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- Validation ----------
export type ValidationResult = { errors: string[]; warnings: string[]; decliningChannels: Channel[] };

function tagsOk(tags: any): boolean {
  return Array.isArray(tags) && tags.length > 0 && tags.every((t) => (CHANNELS as readonly string[]).includes(t));
}

// Channels whose last-month KPIs were flat or down, read from the month-end report trend.
export function decliningChannels(trend: Partial<Record<Channel, number | null>>): Channel[] {
  return CHANNELS.filter((c) => typeof trend[c] === 'number' && (trend[c] as number) <= 0);
}

export function validatePlan(
  plan: any,
  { usedKeywords = new Set<string>(), focusServices = [] as string[] }: { usedKeywords?: Set<string>; focusServices?: string[] } = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!plan || typeof plan !== 'object') return { errors: ['The strategy is empty.'], warnings, decliningChannels: [] };

  // 1. Every item carries at least one channel tag.
  const tagged: [string, any[], (x: any) => string][] = [
    ["What's included", plan.included || [], (x) => x.item],
    ['Keyword plan', plan.keywords || [], (x) => x.keyword],
    ['Blog calendar', plan.blogPlan?.calendar || [], (x) => x.title],
    ['AEO and GEO plan', plan.aeoGeo?.items || [], (x) => x.target],
    ['Backlink plan', plan.backlinks || [], (x) => x.targetSite],
    ['Technical fixes', plan.technical?.fixes || [], (x) => x.issue],
    ['Refresh triggers', plan.technical?.refreshes || [], (x) => x.page],
  ];
  for (const [section, items, label] of tagged) {
    for (const it of items) if (!tagsOk(it?.tags)) errors.push(`${section}: "${label(it) || 'item'}" has no SEO, AEO or GEO tag.`);
  }

  // 2. Targets: every channel present and every target above last month's actual.
  const targets: any[] = plan.targets || [];
  for (const c of CHANNELS) {
    if (!targets.some((t) => t.channel === c)) errors.push(`Monthly targets: no ${c} target.`);
  }
  for (const t of targets) {
    if (t.channel === 'Signal') {
      if (t.target !== null && t.target !== undefined && t.target !== '') errors.push(`Organic leads are a signal only and cannot have a target.`);
      continue;
    }
    const last = t.lastMonth?.value;
    const target = Number(t.target);
    if (!Number.isFinite(target)) {
      errors.push(`Monthly targets: ${t.channel} ${t.kpi} has no numeric target.`);
    } else if (typeof last === 'number') {
      if (target <= last) errors.push(`Monthly targets: ${t.channel} ${t.kpi} target ${target} is not higher than last month's ${last}.`);
    } else {
      warnings.push(`Monthly targets: ${t.channel} ${t.kpi} has no last-month number (${t.lastMonth?.missing || 'DATA MISSING'}), so growth cannot be checked.`);
    }
  }

  // 3. A channel that was flat or fell gets 40%+ of blogs and tasks, and an explanation.
  const declining = decliningChannels(plan.lastMonthTrend || {});
  const blogs: any[] = plan.blogPlan?.calendar || [];
  const tasks: any[] = [...(plan.backlinks || []), ...(plan.technical?.fixes || []), ...(plan.aeoGeo?.items || [])];
  for (const c of declining) {
    const share = (list: any[]) => (list.length ? list.filter((x) => x.tags?.includes(c)).length / list.length : 1);
    if (share(blogs) < 0.4) errors.push(`${c} was flat or down last month, so at least 40% of blogs must be tagged ${c} (now ${Math.round(share(blogs) * 100)}%).`);
    if (share(tasks) < 0.4) errors.push(`${c} was flat or down last month, so at least 40% of tasks must be tagged ${c} (now ${Math.round(share(tasks) * 100)}%).`);
    const note = plan.summary?.declineNotes?.[c];
    if (!note?.whyFell || !note?.howFixed) errors.push(`Summary must explain why ${c} fell and how this month fixes it.`);
  }

  // 4. Keywords: one main keyword per blog, never repeated within the plan or across months.
  const seen = new Set<string>();
  for (const b of blogs) {
    const k = keywordKey(b.mainKeyword);
    if (!k) { errors.push(`Blog "${b.title}" has no main keyword.`); continue; }
    const twin = [...seen].find((s) => sameTopic(s, k));
    if (twin) errors.push(`Main keyword "${b.mainKeyword}" repeats the topic "${twin}" of another blog in this plan.`);
    const used = usedKeywords.has(k) ? k : [...usedKeywords].find((u) => sameTopic(u, k));
    if (used) errors.push(`Main keyword "${b.mainKeyword}" repeats "${used}", already used in an earlier month or published.`);
    seen.add(k);
  }

  // 5. At least 60% of blogs support a focus service.
  const kwByKey = new Map((plan.keywords || []).map((k: any) => [keywordKey(k.keyword), k]));
  if (blogs.length) {
    const supports = blogs.filter((b) => {
      const svc = String(b.focusService || (kwByKey.get(keywordKey(b.mainKeyword)) as any)?.focusService || '').trim();
      if (!svc) return false;
      return !focusServices.length || focusServices.some((f) => f.toLowerCase() === svc.toLowerCase());
    }).length;
    if (supports / blogs.length < 0.6) errors.push(`Only ${Math.round((supports / blogs.length) * 100)}% of blogs support a focus service; at least 60% must.`);
    if (!focusServices.length) warnings.push('Focus services are not set in Settings (key "focus_services"), so any named service counts.');
  }

  // 6. Intent mix about 50% informational, 35% commercial, 15% comparison (15 point tolerance).
  const kws: any[] = plan.keywords || [];
  if (kws.length >= 4) {
    const share = (i: string) => kws.filter((k) => String(k.intent).toLowerCase() === i).length / kws.length;
    const mix: [string, number][] = [['informational', 0.5], ['commercial', 0.35], ['comparison', 0.15]];
    for (const [intent, want] of mix) {
      const got = share(intent);
      if (Math.abs(got - want) > 0.15) errors.push(`Intent mix: ${intent} is ${Math.round(got * 100)}%, target is about ${Math.round(want * 100)}%.`);
    }
  }

  // 7. Backlinks: safe methods only.
  for (const b of plan.backlinks || []) {
    if (!(SAFE_BACKLINK_METHODS as readonly string[]).includes(b.method)) errors.push(`Backlink "${b.targetSite}": method "${b.method}" is not an approved safe method.`);
    if (BANNED_LINK_WORDS.test(`${b.method} ${b.targetSite} ${b.notes || ''}`)) errors.push(`Backlink "${b.targetSite}" looks like a paid or spam link.`);
  }

  // 8. All three channels must have work this month (equal focus on SEO, AEO and GEO).
  const all = [...blogs, ...tasks, ...kws];
  for (const c of CHANNELS) if (!all.some((x) => x.tags?.includes(c))) errors.push(`No item this month is tagged ${c}.`);

  return { errors, warnings, decliningChannels: declining };
}

// ---------- Screaming Frog gate ----------
export const CRAWL_MAX_AGE_DAYS = 7;
export function crawlIsFresh(uploadedAt: string | null | undefined, now = new Date()): boolean {
  if (!uploadedAt) return false;
  const t = Date.parse(String(uploadedAt).replace(' ', 'T') + (String(uploadedAt).endsWith('Z') ? '' : 'Z'));
  return Number.isFinite(t) && now.getTime() - t <= CRAWL_MAX_AGE_DAYS * 86400000;
}

export function approvalBlockers(plan: any, validation: ValidationResult | null, crawl: { created_at?: string } | null, now = new Date()): string[] {
  const out: string[] = [];
  if (!crawlIsFresh(crawl?.created_at, now)) out.push('Upload a Screaming Frog crawl export dated within the last 7 days.');
  if (!plan) out.push('The strategy has no plan.');
  if (validation?.errors?.length) out.push(`Fix ${validation.errors.length} validation error(s) first.`);
  return out;
}

// ---------- Blog 48-hour review window ----------
export const REVIEW_HOURS = 48;
const toMs = (s: string) => Date.parse(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));

type ScheduleRow = { status: string; publish_at: string; review_started?: string | null; reviewed_at?: string | null; main_keyword?: string | null; title?: string | null };

// When a blog in review publishes: at its slot if a reviewer approved it; otherwise at its slot or
// when its 48-hour review window ends, whichever is later, so a reviewer always gets the full 48 hours
// (including after a rewrite, which opens a new window).
export function autoPublishAt(row: ScheduleRow): number {
  const slot = toMs(row.publish_at);
  if (row.reviewed_at || !row.review_started) return slot;
  return Math.max(slot, toMs(row.review_started) + REVIEW_HOURS * 3600000);
}

// What the scheduler should do with one calendar row right now.
//   open_review: enter the 48-hour review  publish: time to publish  wait: nothing yet
// Rejected blogs wait for their rewrite (handled separately); they never publish on their own.
// The scheduler runs every 15 minutes; `graceMinutes` lets a less frequent scheduler publish early.
// With requireExpert, a tax, legal or compliance blog never publishes on its own: it waits in review
// until a named CA/CPA reviewer approves it (then it publishes at its slot).
export function scheduleAction(row: ScheduleRow, now = new Date(), graceMinutes = 0, { requireExpert = false }: { requireExpert?: boolean } = {}): 'open_review' | 'publish' | 'wait' {
  const slot = toMs(row.publish_at);
  const t = now.getTime();
  const grace = graceMinutes * 60000;
  if (['published', 'failed', 'rejected', 'revising'].includes(row.status)) return 'wait';
  if (row.status === 'in_review') {
    if (requireExpert && !row.reviewed_at && needsExpertReview(row.main_keyword, row.title)) return 'wait';
    return t >= autoPublishAt(row) - grace ? 'publish' : 'wait';
  }
  if (t >= slot - grace && ['held', 'drafting', 'planned'].includes(row.status)) return 'publish';
  if (t >= slot - REVIEW_HOURS * 3600000 - grace && ['planned', 'drafting'].includes(row.status)) return 'open_review';
  return 'wait';
}

// ---------- Figure sentences (each must be covered by the fact check) ----------
// Sentences that state a tax figure, rate or deadline: a percentage, a currency amount, a dated
// deadline, or a section/form number next to tax words.
const FIGURE = /(\d+(?:\.\d+)?\s?%|(?:₹|rs\.?|inr|\$|usd)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakh|crore|million|billion|k))?|\d[\d,]*(?:\.\d+)?\s?(?:lakh|crore)|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b|\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b)/gi;
const TAX_CONTEXT = /\b(tax|rate|tds|tcs|gst|deadline|due|file|filing|return|penalty|interest|exemption|deduction|threshold|limit|slab|surcharge|cess|fbar|fatca|irs|cbdt|itr|dtaa|withholding|levy|duty|lrs)\b/i;

export function extractClaims(html: string): { sentence: string; figures: string[] }[] {
  // Block-level tags end a sentence, so a flagged sentence never runs across paragraphs or cells.
  const text = String(html || '')
    .replace(/<\/(p|li|h[1-6]|td|th|tr|div|caption)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ');
  const sentences = text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean);
  const out: { sentence: string; figures: string[] }[] = [];
  for (const s of sentences) {
    if (!TAX_CONTEXT.test(s)) continue;
    const figs = [...s.matchAll(FIGURE)].map((m) => m[0].trim());
    if (figs.length) out.push({ sentence: s.trim(), figures: figs });
  }
  return out;
}

// ---------- Writing rules (checked before auto-publish) ----------
export function writingRuleIssues({ title, meta, html, surferScore, siteHost }: { title: string; meta: string; html: string; surferScore?: number | null; siteHost: string }): string[] {
  const issues: string[] = [];
  if (!title || title.length >= 60) issues.push(`Meta title must be under 60 characters (now ${title?.length || 0}).`);
  if (!meta || meta.length >= 160) issues.push(`Meta description must be under 160 characters (now ${meta?.length || 0}).`);
  const hrefs = [...String(html).matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const internal = hrefs.filter((h) => h.startsWith('/') || h.includes(siteHost)).length;
  if (internal < 3) issues.push(`Needs 3+ internal links (has ${internal}).`);
  const official = hrefs.filter((h) => /\.gov(\.[a-z]{2})?\/|\.gov\b|\.nic\.in|rbi\.org\.in|sebi\.gov\.in|incometax\.gov\.in|irs\.gov/i.test(h)).length;
  if (official < 1) issues.push('Needs 1+ official source link.');
  if (!/<h2[^>]*>\s*(frequently asked questions|faqs?)\b/i.test(html)) issues.push('Needs an FAQ section.');
  // A direct 40-60 word answer under each question heading.
  const qHeads = [...String(html).matchAll(/<h[23][^>]*>([^<]*\?)\s*<\/h[23]>\s*<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of qHeads) {
    const words = m[2].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    if (words < 40 || words > 60) issues.push(`Answer under "${m[1].trim()}" is ${words} words; it must be 40 to 60.`);
  }
  if (typeof surferScore === 'number' && surferScore < 75) issues.push(`Surfer score is ${surferScore}; it must be 75 or more.`);
  if (/[\u2014]/.test(html + title + meta)) issues.push('Contains an em dash.');
  issues.push(...aiLeftovers(title, meta, html));
  return issues;
}

// FAQ schema from the FAQ section, added automatically to every published blog.
export function faqSchema(html: string): string | null {
  const faq = String(html).split(/<h2[^>]*>\s*(?:frequently asked questions|faqs?)[^<]*<\/h2>/i)[1];
  if (!faq) return null;
  const pairs = [...faq.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => ({
    '@type': 'Question',
    name: m[1].replace(/<[^>]+>/g, '').trim(),
    acceptedAnswer: { '@type': 'Answer', text: m[2].replace(/<[^>]+>/g, '').trim() },
  }));
  if (!pairs.length) return null;
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: pairs })}</script>`;
}

// Next month's label, e.g. "November 2026" (strategies made before the 30-day windows).
export function nextPeriod(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function periodStart(period: string): Date {
  const d = new Date(`1 ${period} 00:00:00 UTC`);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

// ---------- 30-day strategy window ----------
// A strategy covers 30 days starting the day it is generated (India time).
export type StrategyWindow = { start: string; end: string; label: string };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nice = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function strategyWindow(now = new Date(), days = 30): StrategyWindow {
  const ist = new Date(now.getTime() + 330 * 60000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const end = new Date(start.getTime() + (days - 1) * 86400000);
  return { start: ymd(start), end: ymd(end), label: `${nice(ymd(start))} to ${nice(ymd(end))}` };
}

// The window of a stored plan; older plans named a calendar month ("November 2026").
export function windowOf(planOrPeriod: any): StrategyWindow {
  if (planOrPeriod && typeof planOrPeriod === 'object' && planOrPeriod.startDate && planOrPeriod.endDate) {
    return { start: planOrPeriod.startDate, end: planOrPeriod.endDate, label: planOrPeriod.period };
  }
  const period = typeof planOrPeriod === 'string' ? planOrPeriod : planOrPeriod?.period;
  const s = periodStart(period);
  const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
  return { start: ymd(s), end: ymd(e), label: period };
}

// ---------- Leftover AI text (K1) ----------
// Lines the writer meant for us, not for readers ("Here is your soft CTA section..."), chat closers,
// and template placeholders. Any match blocks approval and publishing.
const AI_LEFTOVER: [RegExp, string][] = [
  [/\bhere(?:'s| is) (?:your|the) (?:\w+ ){0,4}(?:section|draft|article|blog|post|cta|paragraph|version|faq|outline|intro|conclusion)\b/i, 'an instruction line ("Here is your ...")'],
  [/\b(?:below|above) is (?:your|the) (?:\w+ ){0,3}(?:section|draft|article|blog|post|cta|version)\b/i, 'an instruction line ("Below is the ...")'],
  [/\b(?:as an ai|as a language model|i hope this helps|let me know if you(?:'d| would)? like|feel free to (?:adjust|modify|tweak)|i(?:'ve| have) (?:written|drafted|created) (?:the|this|your))\b/i, 'chat text from the AI'],
  [/\b(?:soft|hard) cta\b|\bcta section\b|\bmeta description:|\bfocus keyword:|\bword count:/i, 'a writing note (CTA section, meta or keyword label)'],
  [/\[(?:insert|add|your|company|client|name|date|link|todo|tbd|placeholder)[^\]]*\]|\{\{[^}]*\}\}|<<[^>]*>>|\blorem ipsum\b|\bTODO\b|\bTBD\b|\bXX+%/i, 'a placeholder'],
];

export function aiLeftovers(...texts: (string | null | undefined)[]): string[] {
  const plain = texts.map((t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).join('\n');
  const out: string[] = [];
  for (const [re, what] of AI_LEFTOVER) {
    const m = plain.match(re);
    if (m) out.push(`Remove ${what}: "${m[0].trim().slice(0, 80)}".`);
  }
  return out;
}

// ---------- Expert review (K2, K3) ----------
// Tax, legal and compliance topics need a named CA/CPA reviewer before they publish.
const EXPERT_TOPIC = /\b(tax|taxes|taxation|tds|tcs|gst|itr|irs|cbdt|fema|rbi|lrs|fbar|fatca|boi|fincen|dtaa|treaty|section \d|form \d|ein|itin|llc|c-?corp|s-?corp|incorporat|company (?:registration|formation)|us company|subsidiar|entity|odi|fdi|ecb|private limited|pvt ltd|stamp duty|visa|compliance|legal|law|act\b|penalt|audit|nri|oci|repatriat|withholding|dividend|capital gains?|transfer pricing|roc|mca|filing|return|deduction|exemption)/i;
export const needsExpertReview = (...texts: (string | null | undefined)[]) => EXPERT_TOPIC.test(texts.filter(Boolean).join(' '));

// ---------- Official sources (K4) ----------
const OFFICIAL_HOST = /(^|\.)((irs|treasury|fincen|ssa|uscis|state|sec|ftc|dol|sba|congress|ecfr|federalregister)\.gov|[a-z.]*\.gov|gov\.in|nic\.in|rbi\.org\.in|sebi\.gov\.in|incometax\.gov\.in|incometaxindia\.gov\.in|cbic-gst\.gov\.in|gst\.gov\.in|mca\.gov\.in|egazette\.gov\.in|indiacode\.nic\.in|oecd\.org|law\.cornell\.edu|uscode\.house\.gov|icai\.org|aicpa\.org)$/i;
export function isOfficialSource(url: string | null | undefined): boolean {
  try {
    return OFFICIAL_HOST.test(new URL(String(url)).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

// ---------- Calls to action per service (rule 9, K7) ----------
export type ServiceCta = { service: string; match: string; text: string; url: string };
export const DEFAULT_CTAS: ServiceCta[] = [
  { service: 'ITIN', match: 'itin|w-7|individual taxpayer', text: 'Need an ITIN without mailing your original passport? Our Certified Acceptance Agent team can handle the W-7 for you.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'EIN', match: '\\bein\\b|employer identification|ss-4', text: 'Get your EIN without the back-and-forth with the IRS. Talk to our team about your company.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'US company formation', match: 'llc|c-?corp|delaware|wyoming|incorporat|company (?:registration|formation)|register a (?:us )?company|boi', text: 'Planning a US company from India? Book a call to pick the right state and entity before you file.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'US tax filing', match: '1040|1120|5472|fbar|fatca|us tax return|irs|state tax|sales tax', text: 'Get your US returns and FBAR filed on time by a team that handles both sides of the border.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'NRI and India tax', match: 'nri|itr|tds|dtaa|capital gains|lower deduction|section 197|repatriat|fema|lrs|oci|dividend', text: 'NRI with income or property in India? Talk to our CA team about TDS, DTAA relief and your return.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'GST and India compliance', match: 'gst|roc|mca|india compliance|private limited|pvt ltd', text: 'Keep your Indian entity compliant. Our team handles GST, ROC and annual filings for cross-border groups.', url: 'https://usaindiacfo.com/contact-us/' },
  { service: 'Virtual CFO', match: 'cfo|bookkeeping|accounting|us gaap|fundrais|valuation|transfer pricing|financial', text: 'Need finance help across the US and India? See how our virtual CFO team works with founders like you.', url: 'https://usaindiacfo.com/contact-us/' },
];

export function pickCta(ctas: ServiceCta[], ...texts: (string | null | undefined)[]): ServiceCta | null {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  let best: ServiceCta | null = null;
  let bestScore = 0;
  for (const c of ctas) {
    let re: RegExp;
    try {
      re = new RegExp(c.match, 'gi');
    } catch {
      continue;
    }
    const score = (hay.match(re) || []).length;
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

// Adds UTM tags so Zoho can show which blog and service a lead came from.
export function withUtm(url: string, { campaign, content, medium = 'blog' }: { campaign: string; content?: string; medium?: string }): string {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'usaindiacfo_blog');
    u.searchParams.set('utm_medium', medium);
    u.searchParams.set('utm_campaign', campaign);
    if (content) u.searchParams.set('utm_content', content);
    return u.toString();
  } catch {
    return url;
  }
}

// ---------- Length fits the topic (rule 8) ----------
// The target is set from the word counts of the pages that rank now (median, with room either side).
export function lengthTarget(counts: number[], fallback = 1600): { min: number; max: number; median: number | null; basedOn: number } {
  const ok = counts.filter((n) => Number.isFinite(n) && n >= 300 && n <= 12000).sort((a, b) => a - b);
  if (ok.length < 2) return { min: Math.round(fallback * 0.7), max: Math.round(fallback * 1.4), median: null, basedOn: ok.length };
  const median = ok[Math.floor(ok.length / 2)];
  return { min: Math.max(600, Math.round(median * 0.8)), max: Math.min(5000, Math.round(median * 1.3)), median, basedOn: ok.length };
}

// ---------- Duplicate topics (K10) ----------
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'your', 'how', 'what', 'is', 'are', 'vs', 'best', 'guide', '2025', '2026', '2027']);
const tokens = (s: string) => new Set(keywordKey(s).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).map((w) => w.replace(/ies$/, 'y').replace(/(?<=ss)es$/, '').replace(/(?<!s)s$/, '')));
export function sameTopic(a: string, b: string): boolean {
  if (keywordKey(a) === keywordKey(b)) return true;
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return false;
  const inter = [...x].filter((t) => y.has(t)).length;
  return inter / new Set([...x, ...y]).size >= 0.75;
}
export function duplicateOf(keyword: string, existing: { keyword: string; where: string }[]): { keyword: string; where: string } | null {
  return existing.find((e) => sameTopic(keyword, e.keyword)) || null;
}

// ---------- Overdue reviews (K9) ----------
export function reviewOverdue(row: ScheduleRow, now = new Date()): boolean {
  return row.status === 'in_review' && !row.reviewed_at && !!row.review_started && now.getTime() > toMs(row.review_started) + REVIEW_HOURS * 3600000;
}

// ---------- Time left for a running job ----------
// Blends how long this kind of work usually takes with the run's own pace. The old formula weighted
// pace and history so that the elapsed time cancelled out, which froze the estimate whenever the
// percentage did not move; this one never freezes, and the caller flags a late step as overdue.
export function blendEta({ elapsed, progress, typical }: { elapsed: number; progress: number; typical: number | null }): number {
  const p = Math.max(0, Math.min(0.99, progress || 0));
  const t = typical && typical > 0 ? typical : 600;
  const byHistory = Math.max(t - elapsed, t * 0.1);
  if (p < 0.02) return Math.round(byHistory);
  // How much slower than usual this run is going, from the share done so far (0.5x to 3x), applied
  // to the usual time for the rest; so a stuck step shows a growing number until "overdue" takes over.
  const slowness = Math.max(0.5, Math.min(3, elapsed / p / t));
  const byPace = t * (1 - p) * slowness;
  return Math.round(0.6 * byPace + 0.4 * byHistory);
}
export const etaSeconds = ({ elapsed, percent, typical }: { elapsed: number; percent: number; typical: number | null }) => blendEta({ elapsed, progress: (percent || 0) / 100, typical });
