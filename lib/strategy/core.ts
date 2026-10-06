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
  { name: 'Facts Register gate', rule: 'A blog that states a tax figure, rate or deadline not in the Verified Facts Register is held and the sentence is flagged.' },
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
    if (seen.has(k)) errors.push(`Main keyword "${b.mainKeyword}" is used by more than one blog.`);
    if (usedKeywords.has(k)) errors.push(`Main keyword "${b.mainKeyword}" was already used in an earlier month.`);
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

// ---------- Blog 24-hour review window ----------
export const REVIEW_HOURS = 24;
const toMs = (s: string) => Date.parse(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));

// What the scheduler should do with one calendar row right now.
//   open_review: enter review (24h before slot)  publish: slot reached  wait: nothing yet
// The scheduler runs every 15 minutes, so a blog publishes within 15 minutes after its slot and
// never before it. `graceMinutes` lets a less frequent scheduler publish slightly early instead.
export function scheduleAction(row: { status: string; publish_at: string }, now = new Date(), graceMinutes = 0): 'open_review' | 'publish' | 'wait' {
  const slot = toMs(row.publish_at);
  const t = now.getTime();
  if (['published', 'failed'].includes(row.status)) return 'wait';
  if (t >= slot - graceMinutes * 60000 && ['in_review', 'held', 'drafting', 'planned'].includes(row.status)) return 'publish';
  if (t >= slot - (REVIEW_HOURS * 60 + graceMinutes) * 60000 && ['planned', 'drafting'].includes(row.status)) return 'open_review';
  return 'wait';
}

// ---------- Facts Register gate ----------
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

const normFig = (f: string) => f.toLowerCase().replace(/(rs\.?|inr|₹)\s?/g, 'rs ').replace(/(usd|\$)\s?/g, '$').replace(/[,\s]+/g, '');

// Returns the sentences whose figures are not all in the register. Empty means the blog may publish.
export function factsGate(html: string, register: { value: string }[]): { sentence: string; missing: string[] }[] {
  const known = new Set(register.map((r) => normFig(r.value)));
  const held: { sentence: string; missing: string[] }[] = [];
  for (const c of extractClaims(html)) {
    const missing = c.figures.filter((f) => !known.has(normFig(f)));
    if (missing.length) held.push({ sentence: c.sentence, missing });
  }
  return held;
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

// Next month's label, e.g. "November 2026", as used in seo_strategies.period.
export function nextPeriod(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function periodStart(period: string): Date {
  const d = new Date(`1 ${period} 00:00:00 UTC`);
  return Number.isFinite(d.getTime()) ? d : new Date();
}
