// What the daily training teaches and how a lesson is asked for: the curriculum of each track, the
// prompts (official sources only, never an invented figure, date or section), and the parts built
// from a lesson without another AI call: the slide walkthrough, the game round and the videos
// (YouTube embeds only, checked). Pure functions, so they are tested without the database or the API.
import type { UicCatalogue, UicService } from './uicCatalogue';

export type Track = 'technical' | 'uic' | 'marketing';
export type Audience = 'associate' | 'manager';
export const TRACKS: Track[] = ['technical', 'uic', 'marketing'];

// Who takes the training: everyone but the admin (who watches). Managers at manager level.
export const isTrainee = (role: string) => role !== 'admin';
export const audienceFor = (role: string): Audience => (role === 'manager' ? 'manager' : 'associate');

// Today's lesson of each track, as a profile holds them (older profiles: one lesson, technical).
export function lessonIdsOf(p: { lesson_id: number | null; lesson_ids: string | null }): Partial<Record<Track, number>> {
  try {
    const v = JSON.parse(p.lesson_ids || 'null');
    if (v && typeof v === 'object') return v;
  } catch {}
  return p.lesson_id ? { technical: p.lesson_id } : {};
}
export const TRACK_LABEL: Record<Track, string> = { technical: 'Technical knowledge', uic: 'Know UIC', marketing: 'Marketing skills' };
// Know UIC is the third part of the Technical track; the page groups it there.
export const TRACK_GROUP: Record<Track, 'Technical' | 'Marketing'> = { technical: 'Technical', uic: 'Technical', marketing: 'Marketing' };

// Twelve levels in four bands. Everyone starts at level 1 (Basic) and moves up one level at a time
// with good test scores (lib/associateTraining adaptiveLevel), so the team builds from the ground up
// to CPA-level depth. Questions per lesson stay small: a test day asks at most MAX_TEST_QUESTIONS.
export const LEVEL_BANDS = ['Basic', 'Intermediate', 'Advanced', 'Expert'] as const;
export type Band = (typeof LEVEL_BANDS)[number];
export const bandOf = (level: number): Band => LEVEL_BANDS[Math.min(3, Math.max(0, Math.floor((Math.max(1, level) - 1) / 3)))];
export const levelLabel = (level: number) => `Level ${level} (${bandOf(level)} ${((Math.max(1, level) - 1) % 3) + 1}/3)`;
const BAND_DEPTH: Record<Band, string> = {
  Basic: 'Basic: what the term, law or form is, who files or uses it, the official form name, the deadline, and the government fee or penalty if an official source states one. Plain words, no jargon left unexplained.',
  Intermediate: 'Intermediate: how it works in practice for a client, documents needed, how it connects to other forms, common mistakes and penalties, and the thresholds that decide who must file.',
  Advanced: 'Advanced: client scenarios with exceptions, elections and thresholds, how two rules or forms interact (or seem to contradict each other), and how recent changes affect clients.',
  Expert: 'Expert (CPA level): multi-rule cases end to end (residency, treaty positions, entity choice, international information returns, penalty relief), what a CPA would check, and how to explain the advice to a client.',
};
export const LEVELS: Record<number, { words: number; questions: number; depth: string }> = Object.fromEntries(
  [350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900].map((words, i) => {
    const level = i + 1;
    const questions = [4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8][i];
    const step = (i % 3) + 1;
    return [level, { words, questions, depth: `${BAND_DEPTH[bandOf(level)]} Step ${step} of 3 in this band${step === 1 ? ' (start of the band: keep it simple)' : step === 3 ? ' (end of the band: harder scenarios)' : ''}.` }];
  }),
);
export const questionsFor = (track: Track, level: number) => {
  const n = (LEVELS[level] || LEVELS[1]).questions;
  return track === 'technical' ? n : Math.max(3, Math.ceil(n * 0.6));
};
// Typed (written-answer) questions per lesson. Kept small: each one is graded by an AI call, so this
// is also the per-lesson grading cost. Two at the higher levels, one otherwise.
export const writtenFor = (_track: Track, level: number) => (level >= 7 ? 2 : 1);

// The technical curriculum: US taxation to CPA level (with the US-India cross-border rules our clients
// meet), ordered from Basic to Expert. A level rotates through its band's list.
export const TECH_CURRICULUM: Record<Band, string[]> = {
  Basic: [
    'How the US tax system works: the IRS, the Internal Revenue Code, the tax year and who must file',
    'Form 1040: the main sections, filing status, and the standard vs itemized deduction',
    'Forms W-2, 1099-NEC, 1099-MISC and 1099-INT: what each reports and who issues it',
    'SSN vs ITIN vs EIN: which number for which person or entity, and Form W-7 and Form SS-4',
    'US tax residency: the green card test and the substantial presence test',
    'Filing deadlines, Form 4868 extension, and the failure-to-file vs failure-to-pay penalties',
    'Estimated tax and Form 1040-ES: who pays quarterly and the underpayment penalty',
    'Forms W-9, W-8BEN and W-8BEN-E: who gives which form to whom, and why',
    'FBAR (FinCEN Form 114): who files, the account threshold, and how it differs from FATCA',
    'The LLC, the C-Corporation and the S-Corporation in plain words: how each is taxed',
    'IRS notices and letters: the common ones, what they mean and the response deadline',
    'Form W-4 and payroll withholding basics',
  ],
  Intermediate: [
    'Schedule C and self-employment tax (Schedule SE) for a sole proprietor or single-member LLC',
    'Form 1120 (C-Corporation): corporate tax, estimated payments, and the due date',
    'Form 1065 and Schedule K-1: partnership and multi-member LLC returns',
    'Form 1120-S and the Form 2553 S-Corporation election: who qualifies (and why a nonresident cannot be a shareholder)',
    'Form 8832 entity classification: check-the-box elections and their timing',
    'Form 5472 with the pro forma Form 1120 for a foreign-owned single-member LLC, and its penalty',
    'Form 1040-NR and dual-status years for people moving to or from the US',
    'FATCA Form 8938: specified foreign financial assets, thresholds, and the overlap with FBAR',
    'Foreign tax credit (Form 1116) vs the foreign earned income exclusion (Form 2555)',
    'The India-US tax treaty: residency tie-breaker, Form 8833 treaty disclosure, and Form 67 on the India side',
    'Payroll tax returns: Form 941, Form 940 and state payroll registration',
    'Penalty relief: first-time abatement and reasonable cause',
    'State income and franchise tax basics: Delaware, Wyoming, California and New York for a foreign owner',
  ],
  Advanced: [
    'PFIC rules and Form 8621: Indian mutual funds held by US persons',
    'Form 5471: US persons with foreign corporations, the filer categories and penalties',
    'GILTI and Subpart F in plain words: when a US shareholder is taxed on a foreign company income',
    'Forms 3520 and 3520-A: foreign gifts, inheritances and foreign trusts',
    'Withholding on payments to foreign persons: Chapter 3 and 4, Form 1042 and Form 1042-S',
    'Effectively connected income vs FDAP income, and the branch profits tax',
    'FIRPTA and Form 8288: a nonresident selling US real estate',
    'Qualified business income deduction (Section 199A) and who loses it',
    'The research credit (Form 6765) for startups, including the payroll tax election',
    'Sales tax nexus after Wayfair: economic nexus for SaaS and e-commerce sellers',
    'International information return penalties and how they stack',
    'Forms 15CA and 15CB, TDS on payments abroad, and how they interact with US treaty claims',
  ],
  Expert: [
    'Choosing the structure for an Indian founder: US LLC vs C-Corporation vs Indian parent, end to end',
    'Transfer pricing (IRC Section 482): arm\'s length pricing between a US company and its Indian subsidiary',
    'Treaty positions in practice: limitation on benefits, permanent establishment, and Form 8833',
    'Fixing past non-compliance: the Streamlined procedures and delinquent FBAR and information return submissions',
    'IRS examinations and appeals: Form 2848 power of attorney, Form 8821, and Circular 230 limits on advice',
    'Expatriation and Form 8854: covered expatriates and the exit tax',
    'US estate and gift tax for nonresidents: Form 706-NA and Form 709',
    'Qualified small business stock (Section 1202) and what an Indian founder must get right early',
    'Where US and India rules seem to contradict each other: timing, residency and credits, and how a CPA resolves it',
    'Reviewing a complete cross-border return package: what a CPA checks before signing',
  ],
};
// Kept for older callers: every technical topic, Basic first.
export const TECH_TOPICS = LEVEL_BANDS.flatMap((b) => TECH_CURRICULUM[b]);

// Digital marketing for a cross-border tax and CFO firm, rotated the same way.
export const MARKETING_TOPICS = [
  'SEO basics: search intent, primary keyword, title and meta description',
  'On-page SEO for a tax article: headings, direct answer near the top, internal links',
  'AEO: writing answers that answer engines and featured snippets can quote',
  'GEO: being cited by AI search (ChatGPT, Perplexity, Google AI Overviews)',
  'People Also Ask and FAQ sections: finding and answering real questions',
  'LinkedIn posts for founders and NRIs: hooks, structure, comments, compliance-safe claims',
  'Turning a technical topic into blog angles, a LinkedIn post, FAQs and lead questions',
  'Lead generation: lead magnets, calls to action, booking a consultation',
  'Email outreach and follow-ups that are not spam',
  'Compliance-safe marketing claims: no guarantees, no unpublished prices, no unverified figures',
  'E-E-A-T for tax content: author, CA/CPA review, sources',
  'Measuring results: Search Console clicks and queries, GA4 conversions, leads in the CRM',
  'Content calendar and topic clusters for US-India tax services',
  'Local and directory listings: Google Business Profile, citations and reviews',
  'Repurposing one blog into posts, short videos and newsletters',
];

const MANAGER_TECH = 'Manager level: go deeper into strategy and client handling: which questions to ask a new client, how to scope the work, when to bring in a CA or CPA, how to review an associate\'s work, and the risks of getting it wrong.';
const MANAGER_UIC = 'Manager level: add client handling and scoping for this service (what to ask, what is in and out of scope, documents and timelines), pricing conversations without quoting any price that is not published on usaindiacfo.com, and the compliance limits of what marketing may claim about the service.';
const MANAGER_MKT = 'Manager level: plan and judge marketing work: choosing priorities from data, briefing associates, reviewing posts for accuracy and compliance, and reporting results to the owner.';

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
export function topicFor(track: Track, day: string, level: number): string {
  const list = track === 'marketing' ? MARKETING_TOPICS : TECH_CURRICULUM[bandOf(level)];
  return list[(((dayNumber(day) + level * 3) % list.length) + list.length) % list.length];
}

// Rules every lesson follows (in the system prompt).
export const RULES = `ACCURACY RULES (all required):
- Use web search. For every rule, form, threshold, deadline, rate or section number, use an OFFICIAL source: irs.gov, fincen.gov, treasury.gov, sec.gov, state government sites, incometax.gov.in, incometaxindia.gov.in, cbic-gst.gov.in, gst.gov.in, rbi.org.in, fema.rbi.org.in, mca.gov.in, egazette.gov.in, indiacode.nic.in. Give its URL.
- Never invent a figure, rate, threshold, date, deadline, form number, price or section number. If you cannot confirm it on an official source in this search, leave it out and say "check the current figure on <official site>" instead.
- Government-approved information only: never rely on blogs, forums or firm websites for a rule, fee or deadline. If two official pages disagree, say so and give both.
- Government fees and penalties: state the official fee (IRS user fee, state filing fee) and the penalty for late or missed filing ONLY when the official source states it, with its URL. If the official source says there is no fee, say so; if you cannot confirm, write "check the current fee on <official site>".
- Recent changes: if the rule, form, threshold or fee changed in the last 12 months (or a change is announced), say so clearly in a line starting "Recently changed:" with the date and the official source. Never present an old rule as current.
- Facts about USAIndiaCFO (what we do, our services, our process) come ONLY from usaindiacfo.com pages you open or from the catalogue given below. Never invent a service, a price, a client or a result.
- Simple English, no em dashes, no hype.`;

export const QUESTION_RULES = `QUESTIONS (all required):
- Scenario-based multiple choice: a short, realistic, anonymised client situation (US and India rules), then the question.
- Exactly 4 options, ONE correct. The 3 wrong options are plausible (common confusions such as FBAR vs Form 8938, 1040 vs 1040-NR, W-8BEN vs W-9, ROR vs RNOR), never silly.
- "explain": one line saying why the answer is right, and "source": the official URL that supports it.
- Every question can be answered from the lesson.
- Inside string values never use a double quote: use single quotes, so the JSON stays valid.`;

const EXTRAS_SPEC = `Also return, built only from the lesson's own content (for the slide walkthrough and the game round):
- "terms": 4 to 6 {"term","definition"} pairs (definition under 20 words);
- "steps": {"title","items":[3 to 6 steps in the right order]} for a process in the lesson (filing steps, client onboarding, a marketing workflow);
- "cases": 2 or 3 {"scenario","options":[3 or 4],"answer":index,"explain"} puzzles such as "which form applies to this client";
- "blanks": 3 or 4 {"sentence" with ___ for the missing word,"answer","options":[3 or 4 including the answer]};
- "slides": 4 to 6 {"heading","points":[2 to 4 short points]} summarising the lesson;
- "videos": up to 2 {"title","url","channel"} YouTube videos found with web search from official or reputable educational channels (IRS, Income Tax Department, RBI, well-known educators) that explain this topic. Only youtube.com or youtu.be links you actually found; none is better than a guess.`;

// Typed questions the person answers by writing. Each carries a model answer and the key points, so
// the AI can grade the typed answer later.
const writtenSpec = (n: number) => `WRITTEN QUESTIONS (${n}, all required):
- ${n} open-ended question(s) the person answers by typing a few sentences (not multiple choice).
- Each: a short realistic scenario or an "explain ..." ask that can be answered from the lesson.
- Give a "model_answer" (3 to 5 sentences, correct and specific) and "key_points" (3 to 5 short points a full answer must contain), used later to grade the typed answer.
- Inside string values use single quotes, never a double quote, so the JSON stays valid.`;

const JSON_SHAPE = `Return ONLY JSON between ===JSON=== and ===END===:
{"title":"...","topic":"...","content_html":"<h3>...</h3><p>...</p>","sources":[{"title":"...","url":"https://..."}],
 "questions":[{"q":"...","options":["...","...","...","..."],"answer":0,"explain":"...","source":"https://..."}],
 "written":[{"q":"...","model_answer":"...","key_points":["...","..."]}],
 "terms":[],"steps":{"title":"...","items":[]},"cases":[],"blanks":[],"slides":[],"videos":[]}`;

export function systemPrompt(goal: string) {
  return `${goal}

You train the team of USAIndiaCFO (UIC, usaindiacfo.com), a cross-border finance, tax and compliance firm serving Indian founders with US companies, NRIs and US-India businesses. You write one short, accurate study lesson a day per track and level, the test questions on it, and the material for a short game round.

${RULES}`;
}

export type LessonAsk = { day: string; level: number; track: Track; audience: Audience; earlier: string[]; meetings?: string; focus?: string; service?: UicService | null; catalogue?: UicCatalogue | null; technicalTopic?: string };

// The request for one lesson. Know UIC gets the day's service from the catalogue (or, with no
// catalogue, finds a service page on usaindiacfo.com itself, and skips the day if it cannot read one).
export function lessonPrompt(a: LessonAsk) {
  const spec = LEVELS[a.level] || LEVELS[1];
  const n = questionsFor(a.track, a.level);
  const words = a.track === 'technical' ? spec.words : Math.round(spec.words * 0.75);
  const head = `Today is ${a.day} (India). Track: ${TRACK_LABEL[a.track]}. ${levelLabel(a.level)} of 12 (${a.audience === 'manager' ? 'managers' : 'associates'}).
Level ${a.level}: ${spec.depth}
Earlier lessons in this track and level (do not repeat them; build on them): ${a.earlier.join(' | ') || 'none yet'}.`;
  let body = '';
  if (a.track === 'technical') {
    const topic = topicFor('technical', a.day, a.level);
    body = `CURRICULUM (US taxation to CPA level, with the US-India cross-border rules our clients meet, taught from Basic to Expert. This lesson is in the ${bandOf(a.level)} band).
Today's topic: ${topic}.
The lesson MUST have these parts, each with its own <h3>:
1. "What it is": the law or rule (with its Internal Revenue Code section or official name), the form, who it applies to and who it does not.
2. "Deadlines, government fees and penalties": the due date, the official fee (or that there is none) and the penalty for late or missed filing, each from an official source as the rules above require.
3. "Recently changed": what changed in the last 12 months, with the date and the official source, or "No change in the last 12 months on <official source>".
4. "Example": a realistic client scenario with sample figures, clearly marked as an example and not a real client, worked step by step.
5. "Using it in marketing and offers": how to explain it to a prospect in one or two lines, an offer or service angle it supports (only services on usaindiacfo.com), a lead question to ask, and which claims are compliance-safe (no guarantees, no unpublished prices, no figure without an official source).
From the Advanced band, also cover the exceptions and where this rule interacts with, or seems to contradict, another rule or form. Always include at least one short WORKED EXAMPLE: a realistic client scenario with sample figures or details, clearly marked "Example" and clearly not a real client, walked through step by step so the concept is concrete. Add one current update on this topic from the last 60 days if an official source has one.
${a.focus ? `Services we sell (to link the topic to): ${a.focus}.` : ''}
${a.meetings ? `What clients asked about in recent meetings:\n${a.meetings}` : ''}
${a.audience === 'manager' ? MANAGER_TECH : ''}`;
  } else if (a.track === 'uic') {
    const svc = a.service;
    const process = a.catalogue?.process?.length ? a.catalogue.process.map((p) => `- ${p.title} (${p.url}): ${p.text.slice(0, 600)}`).join('\n') : 'none in the catalogue: use only what you can open on usaindiacfo.com, or leave the process out.';
    const all = a.catalogue?.services?.length ? a.catalogue.services.map((s) => `- ${s.name}: ${s.url}`).join('\n') : 'empty';
    body = `KNOW UIC: what USAIndiaCFO is, what it does, how it works with a client step by step, every service it offers, and for each service the rules and regulations that apply (US and India laws, forms, deadlines, who it is for).
UIC services catalogue (built from our website; the only services that exist):
${all}
How we work with a client (our process, from our website):
${process}
${svc ? `Today's service: ${svc.name} (${svc.url}). What our website says: ${svc.summary || '(open the page)'}${svc.posts.length ? `\nOur blog posts on it: ${svc.posts.join(' | ')}` : ''}
Open ${svc.url} with web search (search usaindiacfo.com for it) and describe the service ONLY as the page does: what it is, who it is for, how we deliver it step by step. Then the rules behind it from official sources (forms, deadlines, thresholds, who must file).` : `The catalogue is empty: use web search limited to usaindiacfo.com to find ONE service page, open it, and teach that service as the page describes it.`}
If you cannot open the service page, return ONLY ===JSON==={"skip":true,"reason":"..."}===END=== and nothing else.
${a.audience === 'manager' ? MANAGER_UIC : ''}`;
  } else {
    const topic = topicFor('marketing', a.day, a.level);
    body = `CURRICULUM (digital marketing for a cross-border tax and CFO firm: SEO, AEO/GEO, LinkedIn, content, lead generation, and marketing our services in a compliance-safe way).
Today's topic: ${topic}.
Use today's technical concept as the worked example: ${a.technicalTopic || topicFor('technical', a.day, a.level)}. Show how to use it in marketing: 2 blog angles, a LinkedIn post outline, 3 FAQs, 2 lead questions to ask a prospect, and which claims are compliance-safe (and which are not: no guarantees, no unpublished prices, no figures without an official source).
${a.audience === 'manager' ? MANAGER_MKT : ''}`;
  }
  return `${head}
${body}

The lesson: about ${words} words, no more. Write it mostly as POINTERS, so it is quick to read and easy to remember: under each <h3>, short bullet points (<ul><li>, one idea per point, at most about 20 words each), a one-line <p> only where a point needs an introduction, and <strong> on the key term, form or number in a point. No long paragraphs.
Then write ${n} questions.
${QUESTION_RULES}
${writtenSpec(writtenFor(a.track, a.level))}
${EXTRAS_SPEC}
${JSON_SHAPE}`;
}

// ---------- Videos: YouTube embeds only ----------

// The video id of a YouTube link (watch, youtu.be, embed, shorts; youtube.com or youtube-nocookie.com),
// or null for anything else. Ids are exactly 11 characters of letters, digits, - and _.
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
// Never auto-plays; the privacy-enhanced domain.
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0`;

export type Video = { id: string; title: string; channel: string; embed: string };
export function cleanVideos(list: any): Video[] {
  const out: Video[] = [];
  for (const v of Array.isArray(list) ? list : []) {
    const id = youtubeId(v?.url);
    if (!id || out.some((x) => x.id === id)) continue;
    out.push({ id, title: String(v?.title || 'Video').slice(0, 150), channel: String(v?.channel || '').slice(0, 80), embed: embedUrl(id) });
    if (out.length >= 2) break;
  }
  return out;
}

// ---------- Slides (the Watch area) ----------

export type Slide = { heading: string; points: string[]; flow?: string[] };
const plain = (h: string) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// From the lesson's slides, or made from its own headings and lists when it has none; the process
// steps become a flow diagram slide.
export function buildSlides(l: { title: string; content_html: string; extras?: any }): Slide[] {
  const x = l.extras || {};
  let slides: Slide[] = (Array.isArray(x.slides) ? x.slides : [])
    .filter((s: any) => s?.heading && Array.isArray(s.points) && s.points.length)
    .slice(0, 8)
    .map((s: any) => ({ heading: String(s.heading).slice(0, 120), points: s.points.slice(0, 4).map((p: any) => String(p).slice(0, 200)) }));
  if (!slides.length) {
    const parts = String(l.content_html || '').split(/<h3\b[^>]*>/i).slice(1);
    slides = parts.slice(0, 6).map((part) => {
      const [h, rest = ''] = part.split(/<\/h3>/i);
      const items = [...rest.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => plain(m[1]));
      const sentences = items.length ? items : plain(rest).split(/(?<=[.!?])\s+/);
      return { heading: plain(h).slice(0, 120), points: sentences.filter(Boolean).slice(0, 3).map((s) => s.slice(0, 200)) };
    }).filter((s) => s.heading && s.points.length);
  }
  const intro: Slide = { heading: String(l.title).slice(0, 120), points: ['Today\'s lesson in a few slides.', 'Press play, or step through at your own pace.'] };
  const steps = x.steps?.items && Array.isArray(x.steps.items) ? x.steps.items.slice(0, 6).map((s: any) => String(s).slice(0, 80)) : [];
  return [intro, ...slides, ...(steps.length >= 3 ? [{ heading: String(x.steps.title || 'The steps').slice(0, 120), points: [], flow: steps }] : [])];
}

// ---------- Games, built from the lesson ----------

export type Games = {
  match: { terms: string[]; definitions: string[]; answer: number[] } | null; // answer[i]: index of terms[i]'s definition
  order: { title: string; shuffled: string[]; answer: number[] } | null; // answer: shuffled indexes in the right order
  cases: { scenario: string; options: string[]; answer: number; explain: string }[];
  blanks: { sentence: string; options: string[]; answer: number }[];
  lightning: { statement: string; answer: boolean }[];
};

// A small seeded shuffle, so a lesson's game is the same for everyone and on every load.
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildGames(l: { id: number; extras?: any; questions?: string | any[] }): Games {
  void l.questions;
  const x = l.extras || {};
  const rnd = seeded(l.id * 7919 + 13);
  const terms = (Array.isArray(x.terms) ? x.terms : []).filter((t: any) => t?.term && t?.definition).slice(0, 6).map((t: any) => ({ term: String(t.term).slice(0, 80), definition: String(t.definition).slice(0, 200) }));
  let match: Games['match'] = null;
  if (terms.length >= 3) {
    const defs = shuffle<{ d: string; i: number }>(terms.map((t: any, i: number) => ({ d: t.definition, i })), rnd);
    match = { terms: terms.map((t: any) => t.term), definitions: defs.map((d) => d.d), answer: terms.map((_: any, i: number) => defs.findIndex((d) => d.i === i)) };
  }
  const items: string[] = Array.isArray(x.steps?.items) ? x.steps.items.slice(0, 6).map((s: any) => String(s).slice(0, 160)) : [];
  let order: Games['order'] = null;
  if (items.length >= 3) {
    let idx = shuffle(items.map((_, i) => i), rnd);
    if (idx.every((v, i) => v === i)) idx = [...idx.slice(1), idx[0]];
    order = { title: String(x.steps.title || 'Put the steps in order').slice(0, 120), shuffled: idx.map((i) => items[i]), answer: items.map((_, i) => idx.indexOf(i)) };
  }
  const cases = (Array.isArray(x.cases) ? x.cases : [])
    .filter((c: any) => c?.scenario && Array.isArray(c.options) && c.options.length >= 2)
    .slice(0, 3)
    .map((c: any) => ({ scenario: String(c.scenario).slice(0, 500), options: c.options.slice(0, 4).map((o: any) => String(o).slice(0, 160)), answer: Math.max(0, Math.min(Number(c.answer) || 0, Math.min(c.options.length, 4) - 1)), explain: String(c.explain || '').slice(0, 300) }));
  const blanks = (Array.isArray(x.blanks) ? x.blanks : [])
    .filter((b: any) => b?.sentence && String(b.sentence).includes('___') && b.answer && Array.isArray(b.options))
    .slice(0, 4)
    .map((b: any) => {
      const opts = [...new Set([String(b.answer), ...b.options.map((o: any) => String(o))])].slice(0, 4);
      const shuffled = shuffle(opts, rnd);
      return { sentence: String(b.sentence).slice(0, 300), options: shuffled, answer: shuffled.indexOf(String(b.answer)) };
    });
  // Lightning round: a term with its own definition (true) or with another one (false).
  const lightning = terms.map((t: any, i: number) => {
    const truthy = rnd() < 0.5 || terms.length < 2;
    const other = terms[(i + 1 + Math.floor(rnd() * (terms.length - 1))) % terms.length];
    return { statement: `${t.term}: ${truthy || other === t ? t.definition : other.definition}`, answer: truthy || other === t };
  });
  // Never built from the lesson's test questions: tomorrow's test asks them.
  return { match, order, cases, blanks, lightning };
}

export const POINTS = { match: 10, order: 20, cases: 15, blanks: 10, lightning: 5 };
export type GameAnswers = { match?: number[]; order?: number[]; cases?: number[]; blanks?: number[]; lightning?: boolean[]; seconds?: number };

// Marks a game round on the server from the lesson's own game, so the points are the same for all.
// The lightning round gives 1 extra point per answer for finishing within 60 seconds.
export function scoreGame(g: Games, a: GameAnswers) {
  let points = 0;
  let max = 0;
  if (g.match) {
    max += g.match.terms.length * POINTS.match;
    g.match.answer.forEach((v, i) => a.match?.[i] === v && (points += POINTS.match));
  }
  if (g.order) {
    max += POINTS.order;
    if (a.order && a.order.length === g.order.answer.length && a.order.every((v, i) => v === g.order!.answer[i])) points += POINTS.order;
  }
  g.cases.forEach((c, i) => {
    max += POINTS.cases;
    if (a.cases?.[i] === c.answer) points += POINTS.cases;
  });
  g.blanks.forEach((b, i) => {
    max += POINTS.blanks;
    if (a.blanks?.[i] === b.answer) points += POINTS.blanks;
  });
  const fast = typeof a.seconds === 'number' && a.seconds > 0 && a.seconds <= 60;
  g.lightning.forEach((s, i) => {
    max += POINTS.lightning + 1;
    if (a.lightning?.[i] === s.answer) points += POINTS.lightning + (fast ? 1 : 0);
  });
  return { points, max };
}

export function badgeFor(totalPoints: number, gameStreak: number): string | null {
  if (gameStreak >= 20 || totalPoints >= 5000) return 'Cross-border expert';
  if (gameStreak >= 10 || totalPoints >= 2000) return 'Compliance pro';
  if (gameStreak >= 5 || totalPoints >= 750) return 'Rising star';
  if (gameStreak >= 1) return 'Getting started';
  return null;
}
