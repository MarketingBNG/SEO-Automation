// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as settings from './settings';
import prisma from './prisma';
import { rethrowFriendly } from './apiErrors';
import { anthropicClient, clientKeyKind, secondaryKeyConfigured, switchedToSecondary } from './anthropicClient';
import { replayScope, requestHash, savedStep, saveStep } from './aiReplay';
import { assertCredits, recordUsage, onApiError, CreditPausedError } from './aiCredits';
import { validateDraft, markUsedQuestions } from './validation';
import { getWriterPlaybook, getAuditGates } from './playbook';
import { gatherBrief, formatBrief, aiOverviewSummary } from './researchBrief';
import { buildKeywordPlan } from './blogKeywords';
import { chooseKeywords, planForPrompt } from './keywordPlanner';
import { getTopLandingPages } from './ga4';
import { topResultsLength } from './topLength';
import { DEFAULT_CTAS, pickCta, withUtm, isOfficialSource, sameTopic, extractClaims } from './strategy/core';

// The call to action for one blog: the service it fits best (Settings > service CTAs, else the
// built-in list), with UTM tags so Zoho can show which blog and service a lead came from.
export async function ctaFor(keyword, title = '', notes = '') {
  let list = DEFAULT_CTAS;
  try {
    const custom = JSON.parse((await settings.get('service_ctas')) || '[]');
    if (Array.isArray(custom) && custom.length) list = custom;
  } catch {}
  const c = pickCta(list, keyword, title, notes) || { service: 'Cross-border advisory', match: '', text: (await settings.get('cta_text')) || 'Talk to the USAIndiaCFO cross-border team about your situation', url: (await settings.get('cta_url')) || 'https://usaindiacfo.com/contact-us/' };
  const slug = String(keyword).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return { service: c.service, text: c.text, url: withUtm(c.url, { campaign: slug, content: c.service.toLowerCase().replace(/[^a-z0-9]+/g, '-') }) };
}

// K5 Facts Register: facts already verified from an official source, reused across drafts.
export async function approvedFactsFor(keyword, limit = 15) {
  const rows = await prisma.verified_facts.findMany({ orderBy: { id: 'desc' }, take: 500 }).catch(() => []);
  const words = String(keyword).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return rows
    .filter((r) => isOfficialSource(r.source_url) && (words.some((w) => r.claim.toLowerCase().includes(w)) || sameTopic(keyword, r.claim)))
    .slice(0, limit);
}

// Saves every claim the fact check confirmed from an official source, so the next draft reuses it.
export async function rememberFacts(checks, model) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let saved = 0;
  for (const c of checks || []) {
    if (c.verdict !== 'correct' || !isOfficialSource(c.source_url) || !c.claim) continue;
    const claim = String(c.claim).slice(0, 1000);
    const value = (claim.match(/\d[\d,.]*\s?%|(?:\$|rs\.?|inr|₹)\s?\d[\d,.]*|\d[\d,.]*/i) || [''])[0];
    await prisma.verified_facts
      .upsert({ where: { claim }, create: { claim, value, source_url: c.source_url, verified_by: model, last_checked_at: now }, update: { source_url: c.source_url, verified_by: model, last_checked_at: now, times_used: { increment: 1 } } })
      .then(() => saved++)
      .catch(() => {});
  }
  return saved;
}

// Main key, with the secondary key as a backup when the main one runs out of credit.
const getClient = anthropicClient;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_REPAIR_ATTEMPTS = 3;

async function buildSystemPrompt() {
  const maxWords = await settings.get('max_words');
  const voiceGuidelines = await settings.get('voice_guidelines');

  const activeSkill = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });

  const skillReference = activeSkill
    ? `\n\nCONTENT WRITING SKILL (self-researched, refreshed every ~15 days from real
high-engagement blogs and our own analytics) - apply these techniques on top of the house voice
rules below, without ever compromising accuracy or the anti-filler rules:\n${activeSkill.skill_content}`
    : '';

  const approvedInsights = await prisma.client_insights.findMany({
    where: { status: 'approved' },
    select: { title: true, overview: true },
    orderBy: { id: 'desc' },
    take: 5,
  });

  const clientInsightReference = approvedInsights.length
    ? `\n\nREAL CLIENT QUESTIONS/CONTEXT: themes from recent client conversations (via Fireflies
meeting notes) the team has reviewed and approved for use. Use these to understand what buyers
actually ask and struggle with, to pick angles/examples that match real demand, and specifically
to source questions for the required FAQ section when a theme below is genuinely relevant to this
article's topic - real questions people actually ask beat generic ones. Always write the FAQ (and
the rest of the article) in English, regardless of what language the original conversation was in.
NEVER mention or imply any specific client's name, company, or identifying detail from these - use
them only for the general question/pain point, never the individual case:\n` +
      approvedInsights.map((i) => `- ${i.overview}`).join('\n')
    : '';

  const activeStrategy = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  const activePlan = activeStrategy?.plan_json ? JSON.parse(activeStrategy.plan_json) : null;

  const strategyReference = activePlan
    ? `\n\nCURRENT APPROVED SEO / AEO / GEO STRATEGY (${activeStrategy.period}): ${activePlan.coreObjective?.motive || ''}
Focus this month: ${activePlan.summary?.focus || ''}
Every article must help USAIndiaCFO, its landing pages and service pages rank at the top in Google and
Bing (SEO), win snippets, People Also Ask and AI Overviews (AEO), and be cited by ChatGPT, Perplexity and
Gemini (GEO): direct 40-60 word answers under each question heading, a real FAQ, citable specific facts,
and links to the relevant service page.
Planned topics: ${(activePlan.blogPlan?.calendar || []).map((b) => `${b.title} [${(b.tags || []).join('/')}]`).join('; ')}`
    : '';

  const playbook = getWriterPlaybook();
  const lessons = String((await settings.get('writer_lessons')) || '').trim();
  const playbookReference = playbook
    ? `\n\nSEO / GEO / AEO PLAYBOOK (permanent, researched and fact-checked; follow it on every article,
together with the house rules above; if anything here conflicts with accuracy or the house voice,
accuracy and the house voice win):\n${playbook}

HOW THE PLAYBOOK MAPS TO THIS DASHBOARD (these override the playbook where they differ):
- Do NOT write an <h1> in the content: WordPress prints the SEO title as the H1. Start at <h2>.
- Byline: do NOT write a byline, author name or reviewer line. The dashboard adds the author, the CA/CPA reviewer and the "last reviewed" date when the post is published. Do not write "Published" or "Last updated" dates either.
- Call to action: end the article (after the disclaimer) with exactly one call to action written for THIS article's reader, using the CALL TO ACTION given in the request (its service, link and idea). Make it specific to the problem the article solved, one or two sentences, no hype, with the link on descriptive anchor text.
- The Facts Register goes ONLY in the ===FACTS=== section of the output format below, never in ===CONTENT===. List the FAQ sources (each FAQ question with its source and market, e.g. "paa, US") as bullets at the end of ===RESEARCH_NOTES===.
- Placeholders such as [PRACTITIONER NOTE NEEDED] and [VISUAL SUGGESTION: ...] are allowed; the reviewer replaces them and publishing is blocked until they do. NEVER write notes to us inside the article ("Here is your...", "CTA section", "Meta description:", "I hope this helps"): a check blocks any draft that has them.`
    : '';

  return `You are the USAIndiaCFO blog writer. USAIndiaCFO is a Virtual CFO firm serving the USA
and India: cross-border tax, compliance, entity setup, GST/ROC, US GAAP, FEMA/RBI, fundraising,
and family office / HNI wealth work. Blog readers include founders, SMEs, HNIs, family offices,
and finance peers (CAs, CPAs) - some of them will notice a wrong number or a misquoted statute, so
accuracy comes before cleverness, every time.

RESEARCH (do this before writing, using web search; the request gives your search budget, so spend it
on official primary sources and the pages ranking now, one search per source):
- Primary sources: IRS, US Treasury, FinCEN, CBDT, RBI, SEBI, GST Council, MCA, DGFT, USCIS/DOL,
  official gazettes and circulars, the actual text of the relevant act/section.
- Secondary sources (Big Four advisories, Economic Times, Mint, Bloomberg, Reuters, WSJ, ICAI/AICPA)
  are for context only. Every hard claim (a number, rate, threshold, deadline, section reference, or
  "new" rule) must be confirmed by, and linked to, an official primary source: the automatic fact
  checker accepts only official sources and sends the draft back for anything else. If sources
  disagree, say so and give the range. Confirm the rule/figure is current as of today.
- Never invent a statute, form number, rate, or deadline you have not found via search.
- If you cannot verify something, either drop it or mark it inline as [VERIFY: what's uncertain].

VOICE (USAIndiaCFO blog house style): ${voiceGuidelines}
- Cite specific statutes, sections, forms and agencies by name (e.g. "Section 197 of the Income
  Tax Act, 1961", "Form 8833", "IRC Section 6651").
- Structure: open with a 40-55 word direct answer to the reader's question in complete sentences
  (caveats after it), then clear H2/H3 sections, real HTML tables for comparisons, rates,
  thresholds and deadlines, a common-mistakes or recommended-practices section where relevant, and
  a REQUIRED FAQ section near the end: an <h2>Frequently Asked Questions</h2> with 2-4 real reader
  questions as <h3>s (at least 3 from Google's "People also ask" list in the research brief whenever 3
  relevant ones exist), each answered directly in about 40-60 words, not repeating the body. When PAA
  is thin, fill from approved real client questions below, then the question searches in the brief.
  Keep Google's wording (fix only grammar) and use only questions that genuinely fit the topic.
- HOOK AND ENGAGEMENT: right after the direct answer, add a short hook paragraph (2-3 sentences)
  that makes the stakes concrete for this reader: a real deadline, a real penalty amount, a common
  costly mistake, or a specific scenario (e.g. "An NRI who sells a Pune flat in 2026 ..."). Use only
  verified facts in the hook. Keep every section earning its place: open sections with the point,
  use short paragraphs, concrete numbers, worked examples and tables, and end with a clear next step.
  Write like a senior practitioner talking to a client, not like a textbook.
- RESEARCH DEPTH: read widely before writing. Check every page currently ranking in the top 10 in
  the US and India for this keyword, the AI Overview, People Also Ask, and the primary sources. Cover
  every sub-question they cover and the ones they miss, within the search budget in the request.
- No AI filler or hype vocabulary ("delve", "unlock", "seamless", "robust", "game-changer",
  "navigate the landscape", "unprecedented", "in today's fast-paced world", canned hooks like
  "Here's what nobody tells you", empty closers like "The future is bright"). No em dashes.
- Where the piece gives guidance, include a brief line noting it is general information, not
  individualized tax/legal advice.
- Length: match what the pages ranking now cover. The request gives a LENGTH TARGET measured from the
  current top results; aim for it. Without one, about ${maxWords} words. Never more than ${maxWords}
  words in any case. Never pad, and cut
  background, generic definitions and repeated caveats before adding words. But completeness beats
  length: never shorten a rule by dropping its conditions, limits, timing, exceptions or the steps
  around it (see COMPLETENESS in the playbook). If the topic cannot be covered fully within the
  limit, drop whole low-value sections (side topics, background) instead of going over, and say so
  in ===RESEARCH_NOTES===.
- Both sides of the border: where the topic touches both countries, cover the US side, the India side
  and how they connect (treaty relief, credits, reporting in both places).${playbookReference}${
    lessons ? `\n\nLESSONS LEARNED (from our reviewers' rejections, blogs held by checks, fact-check corrections and how published posts performed; follow them):\n${lessons}` : ''
  }${skillReference}${clientInsightReference}${strategyReference}

CHECKED AUTOMATICALLY (a draft that fails any of these is sent back to you):
- Title 50-60 characters (never over 65) with the target keyword early. Meta description 120-156
  characters that restates the answer plus one concrete detail.
- No <h1> in the body (WordPress uses the title as the H1).
- Internal links to genuinely related USAIndiaCFO posts or service pages from the brief: never zero,
  3-8 by default, with descriptive anchor text (never "click here", "read more" or "here").
- Key rates, thresholds, deadlines and rules linked inline to their official primary source
  (irs.gov, fincen.gov, incometax.gov.in, rbi.org.in, mca.gov.in, cbic-gst.gov.in, the treaty
  text), at least 2 such links, using the URLs you put in the Facts Register.
- The FAQ section described above, using the fitting "People also ask" questions from the brief.
  No em dashes, no banned phrases, no leftover [VERIFY] markers, and no repeating the exact
  keyword phrase unnaturally.
- No canned opener ("In today's...", "Are you wondering...", "Imagine...") and no hype in the title
  (exclamation marks, "secret", "guaranteed", shouting capitals).
- A one-line "general information, not individualized tax or legal advice" note near the end, and
  never the obsolete Circular 230 legend.

ALSO REVIEWED (not blocking, but the reviewer sees each miss): the first 150 words state the country
and tax year; a worked example with real numbers; tables have header cells and comparisons use a
table; how-to steps use a numbered list; FAQ answers of about 40-60 words; sentences mostly under 35
words; one real practitioner observation. NEVER invent client experience: where a first-hand
observation would help, write [PRACTITIONER NOTE NEEDED: what to add] and the team fills it in.
India direct-tax content must reflect the Income-tax Act 2025 ("Tax Year", from 1 April 2026) unless
it is about an earlier period.

KEYWORD COVERAGE: a KEYWORD PLAN is given in the request. It was chosen from keyword research before you
started: follow its placements (which keyword goes in which heading, which questions go in the FAQ). It
is checked automatically afterwards. You are given one target keyword, but do not just repeat that exact phrase
throughout the piece - that reads as keyword-stuffed and ranks worse. Identify the closely related
terms, synonyms, and natural variations a reader would actually search for around this topic (for
example, for "FBAR filing deadline" also naturally use terms like "FinCEN Form 114",
"foreign bank account reporting", "FBAR due date"), and weave them in naturally across headings and
body text. This broadens topical coverage for both traditional search and AI answer engines,
without ever making the target keyword itself feel forced.

Given a single target keyword (and optional extra context), research it, then write a complete,
publish-ready blog article targeting that keyword, and produce a Facts Register entry for every
hard claim (a number, rate, threshold, deadline, statute/section, or "new" rule).

Return your final answer as plain text in EXACTLY this format, with no extra commentary before or
after:

===TITLE===
<SEO title, 50-60 characters, target keyword early, accurate and without hype>
===META===
<meta description, 120-156 characters, restates the answer plus one concrete detail, keyword once>
===CONTENT===
<full blog post body as clean HTML using only <h2>, <h3>, <p>, <ul>/<ol>/<li>, <strong>,
<a href="...">, and <table> with <caption>/<thead>/<tbody>/<tr>/<th>/<td>. No <h1>, no
<html>/<body> wrapper, no inline styles, no scripts>
===FACTS===
<one line per hard claim, pipe-delimited, in EXACTLY this order and using literal "|" separators:
FactID | claim | source name | source URL | jurisdiction (US/India/Both) | effective date or period
Example: F1 | FBAR filing deadline is April 15, auto-extended to October 15 | IRS FBAR page | https://www.irs.gov/... | US | 2026 tax year
List every hard claim from the article, in the order they appear. If a claim has no findable
source, still list it and leave source name/URL as "NONE - could not verify".>
===RESEARCH_NOTES===
<3-6 bullet points summarizing your research process, for human review>
===LINKEDIN===
<a LinkedIn post for the firm's page that promotes this article: a specific first line, 3-5 short
lines with the key takeaway and one real number from the article, then "Read the full guide:" and the
words LINK HERE. 120-200 words, no hashtag spam (3 at most), no emojis, no em dashes>
===END===`;
}

// One model turn with live web search. Streams (long research turns would otherwise risk HTTP
// timeouts), resumes when a long search pauses the turn, and returns the text plus the exact
// assistant messages, so a repair round can send the turn back unchanged (the current models
// reject edited history).
// batch: true sends the turn through the Message Batches API instead (50% cheaper, but it can take
// minutes to hours to come back, and refusal fallbacks are not allowed there). Only for unattended
// jobs nobody is waiting on.
// maxParts: how many times a long turn that the API paused (pause_turn, common with many web
// searches) is continued before giving up.
// Errors worth retrying: dropped connections, timeouts, overloaded or server errors, rate limits.
function isTransient(err: any) {
  const status = Number(err?.status);
  if ([408, 409, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  if (status >= 400 && status < 500) return false;
  return /connection|socket|ECONNRESET|ETIMEDOUT|EPIPE|terminated|network|fetch failed|timed? ?out|overloaded|stream (ended|closed)|premature/i.test(`${err?.name} ${err?.message} ${err?.cause?.code || ''}`);
}

// Live activity of one call, for progress bars: web searches done, characters written, which
// continuation part is running, retries so far, and when the API last sent anything.
type Activity = { part: number; searches: number; chars: number; retries: number; lastEventAt: number; note?: string };
// A stream that sends nothing for this long is treated as dead and started again. Long thinking at
// maximum effort can be silent for minutes (the SDK also drops keep-alive pings), so 10 minutes.
const IDLE_MS = () => Math.max(60000, Number(process.env.CLAUDE_IDLE_TIMEOUT_MS) || 10 * 60 * 1000);

// The system prompt and the first user message (the research brief) are the same on every
// continuation part of a long research turn (and on a quick retry), so they are cached: each part
// then re-reads them at the cache price instead of processing 15-25k tokens again. The cache lives
// 5 minutes, so it does not reach a repair round that comes after a fact check; and a repair round
// changes the tool's search cap, which starts a new cache anyway. Only used for research calls.
function withCache(systemPrompt, conversation) {
  const system = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  const first = conversation[0];
  const messages =
    first && typeof first.content === 'string'
      ? [{ role: first.role, content: [{ type: 'text', text: first.content, cache_control: { type: 'ephemeral' } }] }, ...conversation.slice(1)]
      : conversation;
  return { system, messages };
}

// Inside a resumable run (lib/aiReplay.ts) a request made before returns its saved answer, so a
// blog or strategy started again after it stopped pays only for the steps not done yet.
async function callClaude(systemPrompt, userMessages, signal, opts: any = {}) {
  const ctx = replayScope();
  if (!ctx) return callClaudeLive(systemPrompt, userMessages, signal, opts);
  const { onActivity, idleMs, ...rest } = opts;
  const hash = requestHash({ systemPrompt, userMessages, rest });
  const saved = await savedStep(ctx.scope, hash);
  if (saved && saved.run !== ctx.run) return { ...saved, activity: { part: 0, searches: 0, chars: 0, retries: 0, lastEventAt: Date.now(), note: 'reused from the earlier run' } };
  const result = await callClaudeLive(systemPrompt, userMessages, signal, opts);
  await saveStep(ctx.scope, hash, { run: ctx.run, text: result.text, assistantMessages: result.assistantMessages, stopReason: result.stopReason });
  return result;
}

// Haiku has only the basic web search tool; the dynamic-filtering version is Opus and Sonnet only.
const searchTool = (model: string): any => (/haiku/.test(model) ? 'web_search_20250305' : 'web_search_20260209');

async function callClaudeLive(systemPrompt, userMessages, signal, { maxUses = 8, effort = 'high', batch = false, model = MODEL, feature = 'other', maxParts = 40, onActivity, idleMs = IDLE_MS(), cache = false }: any = {}) {
  const client = getClient();
  const conversation = [...userMessages];
  const assistantMessages: any[] = [];
  const activity: Activity = { part: 0, searches: 0, chars: 0, retries: 0, lastEventAt: Date.now() };
  // What the screen shows never goes backwards, even when a retry recounts a part from zero.
  const shown = { searches: 0, chars: 0 };
  const report = (note?: string) => {
    shown.searches = Math.max(shown.searches, activity.searches);
    shown.chars = Math.max(shown.chars, activity.chars);
    try {
      onActivity?.({ ...activity, searches: shown.searches, chars: shown.chars, note });
    } catch {}
  };

  let lastStop = '';
  for (let part = 0; part < maxParts; part++) {
    activity.part = part;
    // Refuses to start when AI work is paused for low credits (see lib/aiCredits.ts).
    await assertCredits();
    if (batch) {
      const response = await runBatchTurn(client, {
        model,
        max_tokens: 32000,
        output_config: { effort },
        system: systemPrompt,
        tools: [{ type: searchTool(model), name: 'web_search', max_uses: maxUses }],
        messages: conversation,
      }, signal).catch(async (err: any) => {
        await onApiError(err, 'secondary');
        throw err;
      });
      await recordUsage({ model, usage: response.usage, feature, batch: true });
      if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');
      const message = { role: 'assistant', content: response.content };
      assistantMessages.push(message);
      conversation.push(message);
      lastStop = response.stop_reason;
      if (response.stop_reason !== 'pause_turn') break;
      continue;
    }

    // Long turns that search the web are often continued in several parts, each re-sending the same
    // system prompt and article; caching them makes each re-read cost a tenth (same request, same answer).
    const longFirst = typeof conversation[0]?.content === 'string' && conversation[0].content.length > 15000;
    const cached = cache || maxUses >= 10 || (maxUses >= 4 && longFirst) ? withCache(systemPrompt, conversation) : { system: systemPrompt, messages: conversation };
    const params = {
      model,
      max_tokens: 32000,
      // Haiku has no server-side refusal fallback.
      ...(/haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
      output_config: { effort },
      system: cached.system,
      tools: [{ type: searchTool(model), name: 'web_search', max_uses: maxUses }],
      messages: cached.messages,
    };
    if (part > 0) report(`research continues (part ${part + 1})`);
    // A long research turn can lose its connection, stall silently or hit a busy API part-way.
    // Those are retried (same request, up to 4 times with a growing wait) instead of failing the
    // whole blog, and every retry is reported so the screen never claims "still working" blindly.
    const searchesAtStart = activity.searches;
    const charsAtStart = activity.chars;
    let response;
    for (let attempt = 0; ; attempt++) {
      activity.searches = searchesAtStart;
      activity.chars = charsAtStart;
      const stream = client.beta.messages.stream(params, { signal });
      let idleTimer: any;
      let stalled = false;
      let lastTextReport = 0;
      let lastEventReport = 0;
      const arm = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          stalled = true;
          stream.abort();
        }, idleMs);
      };
      stream.on('streamEvent', () => {
        activity.lastEventAt = Date.now();
        arm();
        // Every 15 s at most: the heartbeat then knows the AI is alive even while it only thinks.
        if (Date.now() - lastEventReport > 15000) {
          lastEventReport = Date.now();
          report();
        }
      });
      stream.on('contentBlock', (block: any) => {
        if (block?.type === 'server_tool_use') {
          activity.searches++;
          report();
        }
      });
      stream.on('text', (delta: string) => {
        activity.chars += delta.length;
        if (Date.now() - lastTextReport > 2000) {
          lastTextReport = Date.now();
          report();
        }
      });
      arm();
      try {
        response = await stream.finalMessage();
        break;
      } catch (err: any) {
        if (signal?.aborted) throw err; // stopped by the user
        if (!stalled && (err?.name === 'AbortError' || err?.name === 'APIUserAbortError')) throw err;
        await onApiError(err, clientKeyKind(client));
        if (attempt >= 4 && stalled) {
          throw Object.assign(new Error(`The AI sent nothing for ${Math.round(idleMs / 60000)} minutes, ${attempt + 1} times in a row. Try again, or raise CLAUDE_IDLE_TIMEOUT_MS.`), { cause: err });
        }
        if (attempt >= 4 || !(stalled || isTransient(err))) return rethrowFriendly(err, signal);
        activity.retries++;
        const why = stalled ? `no reply from the AI for ${Math.round(idleMs / 60000)} minutes` : `connection problem (${err?.status || err?.name || 'error'})`;
        console.warn(`Claude call: ${why}; ${String(err?.message).slice(0, 120)}; retry ${attempt + 1} of 4`);
        report(`${why}, connecting again (retry ${attempt + 1} of 4)`);
        await new Promise((r) => setTimeout(r, Math.min(60000, 5000 * 2 ** attempt)));
      } finally {
        clearTimeout(idleTimer);
      }
    }
    await recordUsage({ model: response.model || model, usage: response.usage, feature });
    if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');

    const message = { role: 'assistant', content: response.content };
    assistantMessages.push(message);
    conversation.push(message);
    lastStop = response.stop_reason;
    if (response.stop_reason !== 'pause_turn') break;
  }

  const text = assistantMessages
    .flatMap((m) => m.content)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  // stopReason 'pause_turn' here means the turn was still unfinished after maxParts continuations.
  return { text, assistantMessages, stopReason: lastStop, activity };
}

const BATCH_POLL_MS = 30_000;
const BATCH_MAX_WAIT_MS = 25 * 60 * 60 * 1000; // batches expire after 24h

// Submits one request as a single-item batch, waits for it to end and returns its message.
async function runBatchTurn(client, params, signal) {
  const created = await client.messages.batches
    .create({ requests: [{ custom_id: 'turn', params }] })
    .catch((err: any) => rethrowFriendly(err, signal));
  const started = Date.now();
  let status = created.processing_status;
  while (status !== 'ended') {
    if (signal?.aborted) {
      await client.messages.batches.cancel(created.id).catch(() => {});
      throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
    }
    if (Date.now() - started > BATCH_MAX_WAIT_MS) throw new Error(`Batch ${created.id} did not finish in time.`);
    await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
    status = (await client.messages.batches.retrieve(created.id)).processing_status;
  }

  for await (const item of await client.messages.batches.results(created.id)) {
    if (item.custom_id !== 'turn') continue;
    if (item.result.type === 'succeeded') return item.result.message;
    if (item.result.type === 'errored') {
      const why = item.result.error?.error?.message || item.result.error?.type || 'unknown error';
      // The main key ran out of credit while the batch waited: send it again on the secondary key.
      if (/credit balance is too low|out of credit/i.test(why) && clientKeyKind(client) === 'main' && secondaryKeyConfigured()) {
        switchedToSecondary();
        return runBatchTurn(anthropicClient(), params, signal);
      }
      throw new Error(`Batch request failed: ${why}`);
    }
    throw new Error(`Batch request ${item.result.type}.`);
  }
  throw new Error(`Batch ${created.id} returned no result.`);
}

function parseBlogResponse(text) {
  const get = (start, end) => {
    const startIdx = text.indexOf(start);
    if (startIdx === -1) return '';
    const from = startIdx + start.length;
    const endIdx = end ? text.indexOf(end, from) : text.length;
    return text.slice(from, endIdx === -1 ? text.length : endIdx).trim();
  };

  const title = get('===TITLE===', '===META===');
  const meta = get('===META===', '===CONTENT===');
  const content = get('===CONTENT===', '===FACTS===');
  const factsBlock = get('===FACTS===', '===RESEARCH_NOTES===');
  const researchNotes = text.includes('===LINKEDIN===') ? get('===RESEARCH_NOTES===', '===LINKEDIN===') : get('===RESEARCH_NOTES===', '===END===');
  const linkedin = text.includes('===LINKEDIN===') ? get('===LINKEDIN===', '===END===') : '';

  if (!title || !content) {
    throw new Error(
      "Could not parse a valid blog draft from Claude's response. Try generating again."
    );
  }

  const facts = factsBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('F') && line.includes('|'))
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const [factId, claim, sourceName, sourceUrl, jurisdiction, effectiveDate] = parts;
      return {
        fact_id: factId || '',
        claim: claim || '',
        source_name: sourceName && sourceName !== 'NONE - could not verify' ? sourceName : '',
        source_url: sourceUrl && sourceUrl !== 'NONE - could not verify' ? sourceUrl : '',
        jurisdiction: jurisdiction || '',
        effective_date: effectiveDate || '',
      };
    })
    .filter((f) => f.claim);

  return { title, meta, content, researchNotes, facts, linkedin, raw: text };
}

const WRITER_SEARCHES = () => Number(process.env.WRITER_MAX_SEARCHES) || 40;
// Writer effort: 'high' is the usual sweet spot; the separate maximum-effort fact check guards the
// facts. Set WRITER_EFFORT=max to make the writer think longer again.
const WRITER_EFFORT = () => process.env.WRITER_EFFORT || 'high';
// A repair round already has all the research in the conversation, so it searches far less.
const REPAIR_SEARCHES = () => Number(process.env.REPAIR_MAX_SEARCHES) || 12;
const FACT_CHECK_SEARCHES = 60;
// The claims are split between this many checkers that run at the same time (1 to 4).
const FACT_CHECK_PARALLEL = () => Math.max(1, Math.min(4, Number(process.env.FACT_CHECK_PARALLEL) || 3));

// Splits the claims into up to `groups` lists of at least 8, in order, without duplicates.
export function batchClaims(claims: string[], groups: number): string[][] {
  const uniq = [...new Set(claims.map((c) => String(c || '').trim()).filter(Boolean))];
  const n = Math.max(1, Math.min(groups, Math.ceil(uniq.length / 8)));
  const size = Math.ceil(uniq.length / n) || 1;
  return Array.from({ length: n }, (_, i) => uniq.slice(i * size, (i + 1) * size)).filter((g) => g.length);
}
// The fact checker can run on a different (stronger) model than the writer. Default: the same top model.
// Default: Haiku at low effort, made to follow the deep method below (FACT_CHECK_METHOD), so it
// works the way the maximum-effort run did at a fraction of the cost. FACT_CHECK_EFFORT overrides.
const FACT_CHECK_MODEL = () => process.env.FACT_CHECK_MODEL || 'claude-haiku-5-5';
const FACT_CHECK_EFFORT = () => process.env.FACT_CHECK_EFFORT || 'low';
// K6: a second, different model checks every draft too. The rounds alternate between the two, so a
// draft only passes when both models find nothing wrong in two checks in a row.
const SECOND_CHECK_MODEL = () => {
  const m = process.env.SECOND_CHECK_MODEL || 'claude-sonnet-5-5';
  return m === FACT_CHECK_MODEL() ? (m === 'claude-sonnet-5-5' ? 'claude-opus-5-5' : 'claude-sonnet-5-5') : m;
};

// The deep research method (skills/fact-check-method/SKILL.md), written out so a cheaper model or
// effort level follows the same steps the maximum-effort run took on its own.
export const FACT_CHECK_METHOD = `METHOD (follow every step, do not skip any to save time):
1. List every checkable claim: figures, rates, thresholds, dates, deadlines, form and section numbers,
   penalties, who must file, exceptions, and implied rules ("no penalty applies"). Split a sentence that
   holds two facts into two claims. A 2,000 word tax article usually holds 40 to 50 claims.
2. Check money, penalties, deadlines and thresholds first, then process steps, then background.
3. Never answer from memory: search for every claim. Go to the law itself first (uscode.house.gov,
   ecfr.gov, indiacode.nic.in, incometaxindia.gov.in), then official instructions, the IRM, FinCEN
   notices, CBDT or RBI circulars, then agency pages. Firm or blog sites are never the source; use them
   only to find the official page. If a search fails, search again with the form number, the section
   number or the official page title.
4. Check the source is current: this year's amounts and rates, and that the page or procedure still
   exists. A removed page or retired procedure is itself an error in the article.
5. For a cross-border point, check the India side rule too (EPF, FEMA, DTAA), not only the US side.
6. Check what is missing: a condition, limit or exception an expert would add makes the claim incorrect.
7. Use "unverifiable" only after 3 different searches found no official source.
8. Every check needs a source_url to the official source. For "incorrect", the correction is the full
   corrected sentence ready to paste (no em dashes) with the reason.
9. Before answering, confirm every claim has a verdict and a source_url.
HABITS OF A DEEP CHECKER:
- First ask "is this figure still right this year?" for adjusted amounts (inflation adjusted penalties,
  thresholds): search for this year's adjustment or a notice cancelling it.
- Confirm key figures in the law (eCFR, US Code) and the official notice, not one page.
- Open the full official document (form instructions, treaty, IGA) and use it for every claim it covers.
- For any penalty or limit, read the statute for tiers and conditions (base vs aggravated).
- A page that fails (404, redirect) or an options list shorter than the article means: search whether
  the program or rule was changed or removed.
- Note conditions the source states that the article leaves out.
- Test absolute words (never, always, every, automatic, does not) against the law.
- If an official site is blocked, try another official page; blocked is not unverifiable.
- Prefer the newest, most specific official source; check the page's updated date.
ASK OF EVERY CLAIM:
- Does a country-specific rule (treaty, IGA, India agreement) replace the general rule stated?
- Is the rule different for THIS reader (NRIs, US persons living abroad, Indian founders)?
- Is an obligation stated as automatic when it only applies on triggers or above a small-amount limit?
- Is the law settled? Split the claim into the confirmed part and the part with no official answer.
- Does the sentence answer the question its heading raises? Check counting rules (full value vs
  share, per account vs total).
- Does the rule still hold if the property was rented out or inherited (depreciation, non-main-home
  use, inherited cost basis)? Does the form depend on who the buyer and seller are and on the date?
- Does one tax credit or exemption also cover a second tax the article mentions, or not?
- Is every date, circular or notification cited one you actually read? Never supply a date yourself.
HARD POINT SIGNALS (dig deeper): a yearly adjusted figure, a penalty or prison term, a named program or
procedure, an absolute word, a cross-border rule, a page that fails to load.`;

// Re-verifies every hard claim in a draft (numbers, rates, thresholds, deadlines, sections, forms,
// "new" rules) against primary sources with web search, independently of the writer. The claims are
// shared between up to FACT_CHECK_PARALLEL checkers that run at the same time, so a 30-claim article
// is checked in a third of the time; the first checker also looks for claims nobody listed.
// targeted: check only the given sentences (the ones a correction changed), not the whole article.
async function factCheckDraft(result, signal, opts: any = {}) {
  return FACT_CHECK_MODE() === 'grouped' ? factCheckGrouped(result, signal, opts) : factCheckPerClaim(result, signal, opts);
}

// One claim per request: a low-effort checker cannot stop early when it has only one claim, and an
// article of any length (up to MAX_CLAIMS) is fully covered. Every request also gets the whole
// article (cached, so re-sending it costs a tenth) to judge "true but incomplete" claims.
const FACT_CHECK_MODE = () => process.env.FACT_CHECK_MODE || 'per-claim';
const MAX_CLAIMS = 200;
const PER_CLAIM_PARALLEL = () => Math.max(1, Math.min(20, Number(process.env.FACT_CHECK_PER_CLAIM_PARALLEL) || 8));

// Claims that share a topic are checked together, a few per request, so one official page read once
// answers all of them (the deep checker's habit) instead of every claim searching for the same page.
const CLAIMS_PER_GROUP = () => Math.max(1, Number(process.env.FACT_CHECK_GROUP_SIZE) || 5);
const SEARCHES_PER_GROUP = () => Number(process.env.FACT_CHECK_GROUP_SEARCHES) || 4;

// Lists every checkable claim in the article (no verdicts), up to MAX_CLAIMS, each with a short topic
// and whether it needs a search (arithmetic, unit conversions and the article's own assumptions do not).
export async function listClaims(result, signal, { model = FACT_CHECK_MODEL() }: any = {}): Promise<{ text: string; topic: string; search: boolean }[]> {
  const system = `You list the checkable claims in a US-India tax article. Do not judge them.
A claim is any figure, rate, threshold, date, deadline, form or section number, penalty, who must file,
exception, procedure name, or rule stated or implied ("no penalty applies"). Split a sentence that holds
two facts into two claims. Quote each claim exactly as it appears in the article. Up to ${MAX_CLAIMS}
claims. Give each a short topic (claims answered by the same official source share a topic, e.g.
"India TDS on NRI sale", "RBI repatriation", "US home sale exclusion") and "search": false only for
arithmetic, unit conversions and the article's own stated assumptions.
Return ONLY JSON between ===JSON=== and ===END===: {"claims":[{"text":"...","topic":"...","search":true}]}`;
  const { text } = await callClaude(system, [{ role: 'user', content: `Title: ${result.title}\nMeta: ${result.meta}\n\n${result.content}` }], signal, {
    maxUses: 1,
    effort: process.env.FACT_CHECK_LIST_EFFORT || 'high',
    model,
    feature: 'fact-check',
  });
  const m = text.match(/===JSON===([\s\S]*?)===END===/);
  try {
    const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
    if (!Array.isArray(parsed.claims)) return [];
    return parsed.claims
      .map((c) => (typeof c === 'string' ? { text: c, topic: '', search: true } : { text: String(c?.text || ''), topic: String(c?.topic || ''), search: c?.search !== false }))
      .map((c) => ({ ...c, text: c.text.trim() }))
      .filter((c) => c.text);
  } catch {
    return [];
  }
}

// Stronger model for the two whole-topic steps (the brief before the claim checks and the review after).
const FACT_CHECK_BRIEF_MODEL = () => process.env.FACT_CHECK_BRIEF_MODEL || 'claude-sonnet-5-5';

// Topic brief, made once per article before the claim checks: what changed this year and in each
// earlier year back to the oldest date the article mentions, the law and section/form numbers in force
// today, the full rules with their exceptions (NRI ones especially), and who the reader is. Every
// one-claim check gets it, so a checker that sees one sentence still knows the whole law changed.
export async function buildTopicBrief(result, signal, { model = FACT_CHECK_BRIEF_MODEL() }: any = {}): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const system = `You prepare a short research brief for fact checkers of a US-India tax article. Today is ${today}.
Think about the whole topic first, then research it on official sources (incometaxindia.gov.in,
incometax.gov.in, indiacode.nic.in, rbi.org.in, irs.gov, ecfr.gov, uscode.house.gov, the treaty text):
1. What changed on this topic THIS year (new Acts, renumbered sections, new or renamed forms, new rates,
   thresholds, deadlines, circulars, removed procedures). Then the previous year, then each earlier year,
   back to the oldest year or date the article mentions. Start from the latest and give each change's date.
2. The law, sections and form numbers in force today (old number -> new number where renumbered).
3. The full rule for each main point, including the exceptions inside it (for NRIs, US persons living
   abroad, residents vs non-residents, joint owners).
4. Who the reader is (the article's audience) and which rules apply to that reader.
Read full official pages, not snippets. Keep it under 600 words, as plain bullet points with source links.
End with SOURCES: each official page you read, with the key rule it states, so checkers can reuse it.
Return ONLY the brief between ===BRIEF=== and ===END===.`;
  const { text } = await callClaude(system, [{ role: 'user', content: `Title: ${result.title}\nMeta: ${result.meta}\n\n${result.content}` }], signal, {
    maxUses: 15,
    effort: 'high',
    model,
    feature: 'fact-check',
  });
  const m = text.match(/===BRIEF===([\s\S]*?)===END===/);
  return (m ? m[1] : text).trim().slice(0, 8000);
}

// Whole-article review after the claim checks: reads the article, the brief and every claim result
// together in one call, and reports what single-claim checks cannot see (one part contradicting another,
// calculations that do not follow, rules superseded by a law change, the wrong reader) plus any claim
// result that is wrong in the light of the whole topic.
async function reviewWholeArticle(result, brief, checks, signal, { model = FACT_CHECK_BRIEF_MODEL() }: any = {}) {
  const system = `You are the final reviewer of a US-India tax article. You see the article, a research brief on the
whole topic (latest law changes, current sections and forms, full rules with exceptions, the reader) and
the result of a separate check of every claim. Read all of it together and find what single-claim checks
miss: parts of the article that contradict each other, calculations or examples that do not follow from
the stated rules, old sections or forms that the brief shows were replaced, rules applied to the wrong
reader, and claim results that are wrong given the brief. You have up to 8 web searches to confirm.
Do not repeat problems the claim results already flag correctly.
Return ONLY JSON between ===JSON=== and ===END===:
{"checks":[{"claim":"exact sentence or phrase","verdict":"incorrect|unverifiable","correction":"","source_url":""}]}`;
  const results = checks.map((c) => `- [${c.verdict}] ${c.claim}${c.correction ? ` | ${c.correction}` : ''}`).join('\n');
  const user = `BRIEF\n${brief}\n\nCLAIM RESULTS\n${results}\n\nARTICLE\nTitle: ${result.title}\nMeta: ${result.meta}\n\n${result.content}`;
  const { text } = await callClaude(system, [{ role: 'user', content: user }], signal, { maxUses: 8, effort: 'high', model, feature: 'fact-check' });
  const m = text.match(/===JSON===([\s\S]*?)===END===/);
  try {
    const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
    return Array.isArray(parsed.checks) ? parsed.checks.filter((c) => c && c.claim && c.verdict !== 'correct') : [];
  } catch {
    // An unreadable review never lets the draft through as checked.
    return [{ claim: 'Whole-article review output could not be read', verdict: 'unverifiable', correction: '', source_url: '' }];
  }
}

// `brief`: the topic brief from an earlier round of the same draft, reused so it is built once per blog.
async function factCheckPerClaim(result, signal, { mustCheck = [], model = FACT_CHECK_MODEL(), onActivity, targeted = false, brief: givenBrief = '' }: any = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const [listed, brief] = await Promise.all([targeted ? [] : listClaims(result, signal, { model }), givenBrief || buildTopicBrief(result, signal)]);
  const seen = new Set<string>();
  const items = [
    ...(targeted ? [] : (result.facts || []).map((f) => ({ text: f.claim, topic: '', search: true }))),
    ...mustCheck.map((c) => ({ text: c, topic: '', search: true })),
    ...listed,
  ]
    .map((c) => ({ ...c, text: String(c.text || '').trim() }))
    .filter((c) => c.text && !seen.has(c.text) && seen.add(c.text))
    .slice(0, MAX_CLAIMS);
  // The listing failed and there is nothing else to check: never let the draft through as checked.
  if (!items.length) return { checks: [{ claim: 'No claims could be listed for the fact check', verdict: 'unverifiable', correction: '', source_url: '' }], model, checkers: 0, brief };
  // Groups of up to CLAIMS_PER_GROUP claims on one topic; claims that need no search go in their own groups.
  const byTopic = new Map<string, string[]>();
  for (const c of items) {
    const key = c.search ? `s:${c.topic.toLowerCase() || c.text}` : 'n:';
    byTopic.set(key, [...(byTopic.get(key) || []), c.text]);
  }
  const groups: { claims: string[]; search: boolean }[] = [];
  for (const [key, list] of byTopic) {
    for (let i = 0; i < list.length; i += CLAIMS_PER_GROUP()) groups.push({ claims: list.slice(i, i + CLAIMS_PER_GROUP()), search: key.startsWith('s:') });
  }
  // Same system prompt for every group (instructions + brief + article), so it is cached after the first call.
  const system = `You are a senior US-India tax fact checker. You did not write this article. Today is ${today}.
You check the numbered claims you are given (usually on one topic) against a primary source (irs.gov,
treasury.gov, fincen.gov, ecfr.gov, uscode.house.gov, incometax.gov.in, incometaxindia.gov.in,
cbic-gst.gov.in, rbi.org.in, sebi.gov.in, mca.gov.in, the treaty text). Use the official sources already
in the TOPIC BRIEF first and search only for what the brief does not settle; one official page read in
full usually answers every claim on its topic. Give every claim its own verdict: do not skip any.
Read the whole article for context: a claim that is true but leaves out a condition that changes what the
reader must do (who it applies to, the trigger, a threshold or limit, "whichever is earlier", the order of
steps, an exemption or exception the source states), and that the article does not give elsewhere, is
"incorrect", with the complete version as the correction.
Use the TOPIC BRIEF: if it shows a law, section or form was replaced or a rule changed, a claim using the
old one is "incorrect". Check the full rule including the exceptions inside it, for the reader the brief
describes. Keep a correction short: one or two sentences.

${FACT_CHECK_METHOD}

Return ONLY JSON between ===JSON=== and ===END===, one entry per claim number:
{"checks":[{"n":1,"verdict":"correct|incorrect|unverifiable","correction":"","source_url":""}]}

TOPIC BRIEF (latest law, changes by year, full rules, reader, sources)
${brief}

ARTICLE
Title: ${result.title}
Meta: ${result.meta}

${result.content}`;

  const totals = groups.map(() => ({ searches: 0, chars: 0 }));
  let done = 0;
  const maxSearches = groups.reduce((n, g) => n + (g.search ? SEARCHES_PER_GROUP() : 0), 0);
  const report = (note?: string) =>
    onActivity?.({ searches: totals.reduce((n, t) => n + t.searches, 0), chars: totals.reduce((n, t) => n + t.chars, 0), maxSearches, checkers: groups.length, note: note || `${done} of ${items.length} claims checked` });
  const local = new AbortController();
  const onAbort = () => local.abort();
  signal?.addEventListener('abort', onAbort);
  const checks: any[] = [];
  let next = 0;
  const worker = async () => {
    while (next < groups.length) {
      const i = next++;
      const group = groups[i];
      const failed = (note: string) => group.claims.map((claim) => ({ claim, verdict: 'unverifiable', correction: note, source_url: '' }));
      try {
        const user = `${group.search ? '' : 'These claims are arithmetic, conversions or the article\'s own assumptions: check them against the article and the brief, without searching.\n'}CLAIMS TO CHECK:\n${group.claims.map((c, k) => `${k + 1}. ${c}`).join('\n')}`;
        const { text } = await callClaude(system, [{ role: 'user', content: user }], local.signal, {
          maxUses: group.search ? SEARCHES_PER_GROUP() : 1,
          effort: FACT_CHECK_EFFORT(),
          model,
          feature: 'fact-check',
          cache: true,
          onActivity: (a) => {
            totals[i] = { searches: a.searches, chars: a.chars };
            report();
          },
        });
        const m = text.match(/===JSON===([\s\S]*?)===END===/);
        const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
        const list = Array.isArray(parsed.checks) ? parsed.checks : [];
        group.claims.forEach((claim, k) => {
          const r = list.find((x) => Number(x?.n) === k + 1);
          // A claim the checker skipped is not checked: never let it through as correct.
          if (!r) return checks.push({ claim, verdict: 'unverifiable', correction: 'The checker gave no verdict for this claim; check it again.', source_url: '' });
          const verdict = ['correct', 'incorrect', 'unverifiable'].includes(r.verdict) ? r.verdict : 'unverifiable';
          checks.push({ claim, verdict, correction: String(r.correction || ''), source_url: String(r.source_url || '') });
        });
      } catch (err: any) {
        // Stopped, or out of credit: stop every checker. Anything else marks only this group unchecked.
        if (local.signal.aborted || err instanceof CreditPausedError) throw err;
        checks.push(...failed('The check for this claim failed; check it again.'));
      }
      done += group.claims.length;
      report();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PER_CLAIM_PARALLEL(), groups.length) }, worker));
  } catch (err) {
    local.abort();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  // K4: a rule backed only by a blog or news site is not confirmed. Arithmetic and assumptions need no link.
  const noSearch = new Set(groups.filter((g) => !g.search).flatMap((g) => g.claims));
  for (const c of checks) {
    if (c.verdict === 'correct' && c.source_url && !isOfficialSource(c.source_url) && !noSearch.has(c.claim)) {
      c.verdict = 'unverifiable';
      c.correction = `Only a non-official source (${c.source_url}) was found; link the official source (IRS, CBDT, FinCEN, RBI, MCA, the treaty text or the state site) or remove the claim.`;
    }
  }
  // One review of the whole article with every claim result, for what single-claim checks cannot see.
  if (!targeted) checks.push(...(await reviewWholeArticle(result, brief, checks, signal)));
  return { checks, model, checkers: groups.length, brief };
}

async function factCheckGrouped(result, signal, { mustCheck = [], model = FACT_CHECK_MODEL(), onActivity, targeted = false }: any = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = batchClaims([...(targeted ? [] : (result.facts || []).map((f) => f.claim)), ...mustCheck], FACT_CHECK_PARALLEL());
  if (!groups.length) groups.push([]);
  const perChecker = Math.ceil(FACT_CHECK_SEARCHES / groups.length) + (groups.length > 1 ? 5 : 0);
  const article = `Title: ${result.title}\nMeta: ${result.meta}\n\nArticle HTML:\n${result.content}\n\nWriter's Facts Register:\n${(result.facts || [])
    .map((f) => `${f.fact_id} | ${f.claim} | ${f.source_url}`)
    .join('\n')}`;
  const system = (i: number) => `You are a senior US-India tax fact checker. You did not write this article.${
    groups.length > 1 ? ` You are checker ${i + 1} of ${groups.length}; each checker has its own list of claims.` : ''
  } Verify each claim assigned to you against a primary source (irs.gov, treasury.gov, fincen.gov,
incometax.gov.in, incometaxindia.gov.in, cbic-gst.gov.in, rbi.org.in, sebi.gov.in, mca.gov.in, the
treaty text) as of today, ${today}. You have up to ${perChecker} web searches: one per claim where
possible, grouping claims that share a source.${
    i === 0 && !targeted
      ? ' Also find any OTHER hard claim in the article (a number, rate, threshold, deadline, statute or section, form number, or "new" rule) that is in none of the lists, and verify it too.'
      : ''
  }
verdict is "correct" only when a primary source confirms it as currently applicable AND the claim is
complete enough not to mislead: a claim that is true but leaves out a condition that changes what the
reader must do (who it applies to, the trigger, a threshold or limit, "whichever is earlier", the order
of steps, an exemption or exception the source states) is "incorrect", with the complete version as
the correction. Otherwise "incorrect" (give the correction) or "unverifiable".

${FACT_CHECK_METHOD}

Return ONLY JSON between ===JSON=== and ===END===:
{"checks":[{"claim":"exact sentence or phrase","verdict":"correct|incorrect|unverifiable","correction":"","source_url":""}]}`;
  const user = (group: string[], i: number) =>
    `${article}${
      group.length ? `\n\nCLAIMS ASSIGNED TO YOU (each MUST appear in "checks", quoted as "claim"):\n${group.map((x) => `- ${x}`).join('\n')}` : ''
    }${i === 0 && groups.length > 1 ? `\n\nClaims the other checkers cover (do not repeat these):\n${groups.slice(1).flat().map((x) => `- ${x}`).join('\n')}` : ''}`;

  const totals = groups.map(() => ({ searches: 0, chars: 0 }));
  const report = (note?: string) =>
    onActivity?.({ searches: totals.reduce((n, t) => n + t.searches, 0), chars: totals.reduce((n, t) => n + t.chars, 0), maxSearches: perChecker * groups.length, checkers: groups.length, note });
  // One controller for all checkers: when one fails for good, the others stop too (no stray
  // maximum-effort streams billing on after the draft has already been sent back).
  const local = new AbortController();
  const onAbort = () => local.abort();
  signal?.addEventListener('abort', onAbort);
  let outputs;
  try {
    outputs = await Promise.all(
      groups.map((g, i) =>
        callClaude(system(i), [{ role: 'user', content: user(g, i) }], local.signal, {
          maxUses: perChecker,
          effort: FACT_CHECK_EFFORT(),
          model,
          feature: 'fact-check',
          onActivity: (a) => {
            totals[i] = { searches: a.searches, chars: a.chars };
            report(a.note);
          },
        })
      )
    );
  } catch (err) {
    local.abort();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const checks: any[] = [];
  let unreadable = 0;
  outputs.forEach(({ text }, i) => {
    const m = text.match(/===JSON===([\s\S]*?)===END===/);
    try {
      const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
      // No "checks" list, or an empty one from a checker that had claims to check, is not a result.
      if (!Array.isArray(parsed.checks) || (!parsed.checks.length && groups[i].length)) unreadable++;
      else checks.push(...parsed.checks);
    } catch {
      unreadable++;
    }
  });
  // An unreadable check never lets a draft through as checked.
  if (unreadable) checks.push({ claim: `Fact check output could not be read (${unreadable} of ${groups.length} checkers)`, verdict: 'unverifiable', correction: '', source_url: '' });
  // K4: a rule backed only by a blog or news site is not confirmed.
  for (const c of checks) {
    if (c.verdict === 'correct' && c.source_url && !isOfficialSource(c.source_url)) {
      c.verdict = 'unverifiable';
      c.correction = `Only a non-official source (${c.source_url}) was found; link the official source (IRS, CBDT, FinCEN, RBI, MCA, the treaty text or the state site) or remove the claim.`;
    }
  }
  return { checks, model, checkers: groups.length };
}

const FACT_CHECK_ROUNDS = () => Math.max(3, Number(process.env.FACT_CHECK_ROUNDS) || 8);

// Fixes the claims a fact check flagged: corrects each one from its primary source, or removes it
// (or rewrites the sentence without the figure) when no primary source confirms it.
async function correctClaims(draft, bad, signal) {
  const system = `You correct a US-India tax article. Change ONLY the flagged claims below. For each one: if a
correction and primary source are given, use the corrected fact and link the source; if it is
unverifiable, remove the claim or rewrite the sentence without the unverified figure. Keep everything
else exactly as it is (structure, headings, links, FAQ, tone). Never add a new number, rate or deadline.
Keep each fix short and complete: merge several fixes to one sentence into one clean sentence, state the
condition in as few words as possible, and keep the article under 1,600 words (tighten nearby wording if a
fix adds words). Nothing a correction requires may be left out.
Keep it easy to read: put the action first and the section or form number after it in brackets, use at
most one section or form number per sentence, and when old law numbers changed, list old and new numbers
once in a small table instead of repeating "formerly ..." in sentences.
No em dashes. Return ONLY: ===TITLE===<title>===META===<meta description>===CONTENT===<full HTML>===END===`;
  const user = `Flagged claims:\n${bad
    .map((c) => `- "${c.claim}" (${c.verdict})${c.correction ? ` Correct: ${c.correction}` : ''}${c.source_url ? ` Source: ${c.source_url}` : ''}`)
    .join('\n')}\n\nTitle: ${draft.title}\nMeta: ${draft.meta}\n\nHTML:\n${draft.content}`;
  // Rewriting the whole article is long output: the stronger brief model at high effort does it
  // reliably (a small model at max effort can spend its output on thinking and searches and return
  // no article). The corrections already carry their sources, so few searches are needed.
  // A correction must not grow the article: it may be at most 10% longer than before, and never
  // past the length cap (unless the article was already longer). One retry with the count if it is.
  const wordsOf = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const cap = Math.max(parseInt(await settings.get('max_words'), 10) || 1600, Math.round(wordsOf(draft.content) * 1.1));
  const contentOf = (x: string) => {
    const i = x.indexOf('===CONTENT===');
    return i < 0 ? '' : x.slice(i + 13, x.indexOf('===END===', i) < 0 ? undefined : x.indexOf('===END===', i));
  };
  let text = '';
  let note = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    ({ text } = await callClaude(system, [{ role: 'user', content: user + note }], signal, { maxUses: 5, effort: 'high', model: FACT_CHECK_BRIEF_MODEL(), feature: 'fact-check' }));
    if (!text.includes('===CONTENT===')) continue;
    const n = wordsOf(contentOf(text));
    if (n <= cap) break;
    note = `\n\nYOUR LAST ANSWER WAS ${n} WORDS. The corrected article must be at most ${cap} words: apply the same corrections, and cut repetition, background and low-value sections instead of adding.`;
  }
  const get = (a, b) => {
    const i = text.indexOf(a);
    if (i < 0) return '';
    const j = text.indexOf(b, i + a.length);
    return text.slice(i + a.length, j < 0 ? undefined : j).trim();
  };
  const content = get('===CONTENT===', '===END===');
  if (!content) throw new Error('Correction pass returned no article');
  return { title: get('===TITLE===', '===META===') || draft.title, meta: get('===META===', '===CONTENT===') || draft.meta, content };
}

// Fact-checks a draft against primary sources, correcting it between rounds. It passes only when two
// FULL checks in a row, by two different models, find nothing wrong (and every figure sentence was
// checked). After a correction, the next round checks only the sentences the correction changed
// (cheap); once those are clean, full checks run again. So the final gate is the same as before, but
// the article is not re-checked from scratch after every small fix. Gives up after
// FACT_CHECK_ROUNDS (default 8) rounds in total; the caller then holds the blog for a person instead
// of publishing it, so nothing unverified goes live.
// `check` and `correct` are injectable for tests.
// `startClean` = 1 when the writer's own independent check already found this exact text clean:
// then one more clean full check, by the other model, is enough (K6: two different models agree).
async function verifyAndCorrect(draft, { signal, mustCheckOf = (_html) => [], check = factCheckDraft, correct = correctClaims, maxRounds = FACT_CHECK_ROUNDS(), startClean = 0, onActivity }: any = {}) {
  let current = { title: draft.title, meta: draft.meta, content: draft.content };
  let clean = Math.max(0, Math.min(1, Number(startClean) || 0));
  // Full checks alternate models (FACT, SECOND, FACT...; or SECOND first when the inline check by
  // FACT already counts), so two clean full checks in a row always come from two different models.
  let fullRounds = clean;
  let targets: string[] | null = null; // sentences changed by the last correction
  let brief = ''; // the topic brief, built in the first round and reused after
  const log = [];
  for (let round = 1; round <= maxRounds; round++) {
    const all = mustCheckOf(current.content);
    const targeted = Boolean(targets && targets.length);
    const mustCheck = targeted ? targets : all;
    const model = targeted ? FACT_CHECK_MODEL() : fullRounds % 2 === 0 ? FACT_CHECK_MODEL() : SECOND_CHECK_MODEL();
    onActivity?.({ round, model, note: targeted ? `re-checking ${mustCheck.length} corrected sentence(s), round ${round}` : `full check round ${round}` });
    const result = await check({ ...current, facts: draft.facts || [] }, signal, { mustCheck, model, onActivity, targeted, brief });
    if (result.brief) brief = result.brief;
    const bad = result.checks.filter((c) => c.verdict !== 'correct');
    // A figure sentence the checker skipped counts as unverified.
    const checked = result.checks.map((c) => String(c.claim || '').toLowerCase());
    const skipped = mustCheck.filter((sent) => !checked.some((c) => c && (sent.toLowerCase().includes(c) || c.includes(sent.toLowerCase().slice(0, 60)))));
    log.push({ round, model: result.model || model, scope: targeted ? 'corrected sentences' : 'full', claims: result.checks.length, wrong: bad.length, skipped: skipped.length });
    if (!targeted) fullRounds++;
    if (!bad.length && !skipped.length) {
      if (targeted) {
        targets = null; // corrections confirmed: back to full checks
        continue;
      }
      clean++;
      if (clean >= 2) {
        await rememberFacts(result.checks, result.model || model).catch(() => 0);
        return { ok: true, rounds: round + (startClean ? 1 : 0), draft: current, log };
      }
      continue;
    }
    clean = 0;
    if (!bad.length) {
      // Only skipped sentences: check exactly those again.
      targets = skipped;
      continue;
    }
    const before = new Set(all);
    current = await correct(current, bad, signal);
    // The next round checks what the correction changed, plus anything that was skipped.
    const changed = mustCheckOf(current.content).filter((sent) => !before.has(sent));
    const next = [...new Set([...changed, ...skipped])];
    targets = next.length ? next : null; // nothing identifiable changed: a full check runs
  }
  return { ok: false, rounds: maxRounds, draft: current, log };
}

// Runs the full "select+research -> draft+optimize -> validate+package" pipeline for one
// keyword, auto-repairing up to MAX_REPAIR_ATTEMPTS times, per the Frozen Playbook.
async function researchAndWriteBlog(keyword, notes, { signal, onProgress }: any = {}) {
  const systemPrompt = await buildSystemPrompt();
  // Progress: (text, percent, { key, round, progress 0..1, lastActivityAt }). The percent scale is
  // weighted by how long each step usually takes: brief 3-9, write 10-50, validate 52, check 54-92,
  // save 96. A repair round starts the scale again and says so in the text.
  let attempt = 0;
  const stage = (key, percent, text, extra: any = {}) => onProgress?.(text, Math.round(percent), { key, round: attempt, ...extra });
  const words = (chars) => Math.round(chars / 6.5).toLocaleString('en-US');

  stage('brief', 3, 'Gathering data from SE Ranking, Google, Search Console, WordPress and Surfer…', { progress: 0 });
  const brief = await gatherBrief(keyword, { includeSurfer: true });
  if (signal?.aborted) throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

  // Keyword research comes first: decide the plan (which keywords, which questions, and where each
  // goes) from the research, then write to it. The plan is saved with the draft and checked after.
  const keywordPlan = buildKeywordPlan(brief, keyword);
  const chosen = chooseKeywords(keywordPlan, keyword);
  stage('plan', 8, `Keyword plan ready: ${chosen.secondary.length} secondary keywords, ${chosen.questions.length} questions. Measuring the pages ranking now…`, { progress: 0.3 });

  const maxWordsCap = parseInt(await settings.get('max_words'), 10) || 1600;
  const measured = await topResultsLength(brief, maxWordsCap).catch(() => null);
  // The length target follows the pages ranking now, but never above the word cap set in Settings.
  const length = measured ? { ...measured, max: Math.min(measured.max, maxWordsCap), median: Math.min(measured.median, maxWordsCap), min: Math.min(measured.min, Math.round(maxWordsCap * 0.8)) } : null;
  const cta = await ctaFor(keyword, '', notes);
  const known = await approvedFactsFor(keyword).catch(() => []);
  const expectedChars = (length?.median || 1800) * 8 + 4000;

  const userPrompt = [
    `Target keyword: "${keyword}"`,
    `SEARCH BUDGET: up to ${WRITER_SEARCHES()} web searches for the research.`,
    notes ? `Additional context from the content team: ${notes}` : '',
    length?.median
      ? `LENGTH TARGET: ${length.min}-${length.max} words. The ${length.basedOn} pages ranking now that we could read use about ${length.median} words (median). Cover what they cover and what they miss, without padding.`
      : '',
    `CALL TO ACTION: service "${cta.service}". Idea: ${cta.text} Link (use exactly): ${cta.url}`,
    known.length
      ? `FACTS REGISTER (already verified from official sources; reuse them with the same source link when relevant, and still check that each is current):\n${known.map((f) => `- ${f.claim} | ${f.source_url} | checked ${f.last_checked_at || f.created_at}`).join('\n')}`
      : '',
    planForPrompt(chosen),
    formatBrief(brief),
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [{ role: 'user', content: userPrompt }];
  let result: any;
  let validation: any;

  while (attempt <= MAX_REPAIR_ATTEMPTS) {
    const repair = attempt > 0;
    const budget = repair ? REPAIR_SEARCHES() : WRITER_SEARCHES();
    const roundText = repair ? `Repair round ${attempt} of up to ${MAX_REPAIR_ATTEMPTS}: ` : '';
    stage('write', 10, `${roundText}Researching sources and writing the draft (up to ${budget} web searches)…`, { progress: 0 });
    const { text: rawText, assistantMessages } = await callClaude(systemPrompt, messages, signal, {
      maxUses: budget,
      effort: repair ? 'high' : WRITER_EFFORT(),
      feature: 'blog',
      onActivity: (a) => {
        const p = Math.min(0.97, 0.65 * Math.min(1, a.searches / budget) + 0.35 * Math.min(1, a.chars / expectedChars));
        stage(
          'write',
          10 + 40 * p,
          `${roundText}${a.searches} of up to ${budget} web searches done, about ${words(a.chars)} words written${a.part ? ` (research part ${a.part + 1})` : ''}${a.note ? `. ${a.note}` : ''}`,
          { progress: p, lastActivityAt: a.lastEventAt }
        );
      },
    });

    stage('validate', 52, `${roundText}Checking the draft against the writing rules…`, { progress: 0.5 });
    result = parseBlogResponse(rawText);
    validation = await validateDraft({
      title: result.title,
      meta: result.meta,
      content: result.content,
      facts: result.facts,
      keyword,
      paaQuestions: brief.peopleAlsoAsk,
      keywordPlan,
      lengthTarget: length,
      ctaUrl: cta.url,
    });

    // Independent fact check: a separate maximum-effort pass (FACT_CHECK_MODEL) re-verifies every
    // hard claim against primary sources. Any wrong or unverifiable claim sends the draft back.
    if (validation.passed) {
      stage('check', 54, `${roundText}Independent fact check against official sources (about ${FACT_CHECK_SEARCHES} web searches)…`, { progress: 0 });
      // Every sentence with a figure, rate or deadline must be covered, as in the review's own check.
      const mustCheck = extractClaims(result.content).map((c) => c.sentence);
      const check = await factCheckDraft(result, signal, {
        mustCheck,
        onActivity: (a) => {
          const max = a.maxSearches || FACT_CHECK_SEARCHES;
          const p = Math.min(0.97, 0.8 * Math.min(1, a.searches / max) + 0.2 * Math.min(1, a.chars / 6000));
          stage('check', 54 + 38 * p, `${roundText}Fact check: ${a.searches} of up to ${max} web searches done${a.checkers > 1 ? ` (${a.checkers} checkers at once)` : ''}${a.note ? `. ${a.note}` : ''}`, { progress: p, lastActivityAt: Date.now() });
        },
      });
      const checked = check.checks.map((c) => String(c.claim || '').toLowerCase());
      const skipped = mustCheck.filter((sent) => !checked.some((c) => c && (sent.toLowerCase().includes(c) || c.includes(sent.toLowerCase().slice(0, 60)))));
      result.factCheck = { ...check, covered: skipped.length === 0 };
      const bad = check.checks.filter((c) => c.verdict !== 'correct');
      if (bad.length) {
        validation.passed = false;
        validation.issues = [
          ...validation.issues,
          ...bad.map((c) => `Fact check (${c.verdict}): "${c.claim}". ${c.correction ? `Correct version: ${c.correction}. ` : ''}${c.source_url ? `Source: ${c.source_url}` : 'Remove it if it cannot be verified.'}`),
        ];
      }
    }

    if (validation.passed) break;
    if (attempt === MAX_REPAIR_ATTEMPTS) break;

    messages.push(...assistantMessages);
    messages.push({
      role: 'user',
      content: `This draft failed validation. Fix these specific issues and return the FULL
corrected draft again in the exact same format (===TITLE=== through ===END===). The research is
already in this conversation: SEARCH BUDGET for this round is up to ${REPAIR_SEARCHES()} web searches,
only to confirm a corrected fact from its official source.\n- ${validation.issues.join('\n- ')}`,
    });
    attempt++;
  }

  stage('save', 96, 'Saving draft…', { progress: 0.5 });

  return {
    ...result,
    validation,
    peopleAlsoAsk: markUsedQuestions(result.content, brief.peopleAlsoAsk),
    keywordPlan,
    lengthTarget: length,
    cta,
    repairAttempts: attempt,
    productionState: validation.passed ? 'READY_FOR_REVIEW' : 'NEEDS_ATTENTION',
  };
}

async function generateDailyDigest(topics) {
  const topicList = topics && topics.length ? topics.join(', ') : 'US-India cross-border tax and compliance';

  const { text } = await callClaude(
    `You are a research analyst for USAIndiaCFO. Search the web for genuinely new
developments (last 7 days preferred) in these topics: ${topicList}. Only report real findings
with real, checkable source links - never invent news. If nothing materially new was found, say
so plainly.

Return plain text in EXACTLY this format:

===SUMMARY===
<3-8 bullet points, each one a specific finding, written for a busy operator to skim>
===SOURCES===
<one per line, format: Title | URL>
===END===`,
    [{ role: 'user', content: `What's new this week on: ${topicList}?` }],
    undefined,
    { maxUses: 6, effort: 'medium' }
  );

  const get = (start, end) => {
    const startIdx = text.indexOf(start);
    if (startIdx === -1) return '';
    const from = startIdx + start.length;
    const endIdx = end ? text.indexOf(end, from) : text.length;
    return text.slice(from, endIdx === -1 ? text.length : endIdx).trim();
  };

  const summary = get('===SUMMARY===', '===SOURCES===');
  const sourcesBlock = get('===SOURCES===', '===END===');
  const sources = sourcesBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [title, url] = l.split('|').map((p) => p.trim());
      return { title, url };
    });

  return { summary: summary || text, sources };
}

// Audits an existing blog (pasted content or fetched from a URL) against the same six quality
// gates the writer itself is held to: SEO, AEO, GEO/AI, voice/humanize, accuracy, and CTA.
// Distinct from researchAndWriteBlog: this reviews something that already exists, it doesn't
// write anything new.
async function auditBlog({ title, content, sourceUrl }) {
  // Google's live "People also ask" questions for the post's topic, so the audit can check the FAQ
  // against what searchers actually ask.
  let peopleAlsoAsk: any[] = [];
  let paaReference = '';
  if (title) {
    const brief = await gatherBrief(title.replace(/&[#a-z0-9]+;/gi, ' ').slice(0, 80), { only: ['serp', 'serpIndia'] });
    peopleAlsoAsk = brief.peopleAlsoAsk || [];
    const overview = aiOverviewSummary(brief.serp) || aiOverviewSummary(brief.serpIndia);
    if (peopleAlsoAsk.length) {
      paaReference += `\n\nGOOGLE "PEOPLE ALSO ASK" for this topic (live search):\n${peopleAlsoAsk
        .map((q) => `- ${q.question}`)
        .join('\n')}\nCheck the FAQ against these. If the post has no FAQ, or its FAQ misses the ones that fit the topic, report an AEO issue and add a suggestion that lists the exact questions to add.`;
    }
    if (overview) {
      paaReference += `\n\nGOOGLE AI OVERVIEW for this topic (what AI search answers today):\n${overview.points
        .map((p) => `- ${p}`)
        .join('\n')}${overview.cited.length ? `\nSites it cites: ${overview.cited.slice(0, 8).join(', ')}.` : ''}\nFlag important points the post fails to cover, and anything where the post contradicts current facts.`;
    }
  }

  const voiceGuidelines = await settings.get('voice_guidelines');
  const maxWords = await settings.get('max_words');

  const gates =
    getAuditGates() ||
    `1. SEO: clear search intent match, title/H1 present and a reasonable length, sensible heading
   structure, no keyword stuffing, internal links present if this is a USAIndiaCFO post.
2. AEO: a direct answer near the top (not buried), question-style subheadings where natural, and a
   REQUIRED FAQ section near the end (under an FAQ/Frequently Asked Questions heading, 2-4 real
   questions with direct answers, ideally Google's "People also ask" questions). Flag its absence
   as an issue every time.
3. GEO/AI: claims linked inline to primary official sources, named expertise/author signal,
   content freshness (flag anything referencing an outdated year, rate, or since-changed rule).
4. ACCURACY: verify every hard claim (a number, rate, threshold, deadline, statute/section, or
   "new" rule) using web search. Flag anything wrong, outdated, or unverifiable, and say what the
   correct figure or status actually is where you can find it.
5. VOICE/HUMANIZE: flag AI filler and hype vocabulary, em dashes, and generic padding.
6. CONVERT: is there one clear call to action; is it appropriate for the content.`;

  const systemPrompt = `You are the USAIndiaCFO content auditor. You review an existing blog
post (someone else's, an old USAIndiaCFO post, or a fresh draft) and report exactly what's wrong
with it and how to fix it. You do not rewrite it. Review it against these gates:

${gates}

House voice guideline: ${voiceGuidelines}. House length guideline: about ${maxWords} words; length
should follow what the query needs, so flag padding or missing coverage, never length by itself.${paaReference}

Research using web search before judging any factual claim - do not guess.

Recording the gates in the output below: report every FAIL and WARN as one ISSUES line, naming the
gate in the description (e.g. "Gate 9: FAQ uses no People also ask questions..."). A FAIL on Gate 1,
2, 3, 4 or 14 is critical; any other FAIL is moderate; a WARN is minor. Use the category that fits
(SEO, AEO, GEO, Accuracy, Voice, Convert). If you only have the article text (no live page), mark
checks that need the rendered page or Search Console as "not checked" instead of guessing. Any FAIL
on Gates 1-4 or 14 means the verdict is NEEDS_ATTENTION.

Return plain text in EXACTLY this format, with no extra commentary before or after:

===VERDICT===
<exactly one of: READY or NEEDS_ATTENTION>
===SUMMARY===
<2-4 sentences, the overall verdict in plain language for a busy operator>
===ISSUES===
<one per line, pipe-delimited: severity (critical/moderate/minor) | category (SEO/AEO/GEO/Accuracy/Voice/Convert) | specific description of the problem and where it is in the piece. List every real issue found. If none, write a single line: none | none | No issues found.>
===SUGGESTIONS===
<one per line: a concrete, actionable fix - not vague advice. If none needed, write: No changes needed.>
===FACTS===
<one line per hard claim actually present in the piece, pipe-delimited, same order as
researchAndWriteBlog's format plus a verdict column:
FactID | claim | source name | source URL | jurisdiction | verdict (confirmed/outdated/incorrect/unverifiable)
If the piece has no checkable hard claims, leave this section empty.>
===END===`;

  const userPrompt = sourceUrl
    ? `Audit the blog post at this URL: ${sourceUrl}\n\nHere is the raw fetched page content (it includes navigation/header/footer noise - identify and audit only the actual article body):\n\n${content.slice(0, 20000)}`
    : `Audit this blog post${title ? ` titled "${title}"` : ''}:\n\n${content.slice(0, 20000)}`;

  const { text } = await callClaude(systemPrompt, [{ role: 'user', content: userPrompt }], undefined, { maxUses: 8, feature: 'audit' });

  const get = (start, end) => {
    const startIdx = text.indexOf(start);
    if (startIdx === -1) return '';
    const from = startIdx + start.length;
    const endIdx = end ? text.indexOf(end, from) : text.length;
    return text.slice(from, endIdx === -1 ? text.length : endIdx).trim();
  };

  const verdict = get('===VERDICT===', '===SUMMARY===').includes('NEEDS_ATTENTION')
    ? 'NEEDS_ATTENTION'
    : 'READY';
  const summary = get('===SUMMARY===', '===ISSUES===');
  const issuesBlock = get('===ISSUES===', '===SUGGESTIONS===');
  const suggestionsBlock = get('===SUGGESTIONS===', '===FACTS===');
  const factsBlock = get('===FACTS===', '===END===');

  const issues = issuesBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [severity, category, description] = l.split('|').map((p) => p.trim());
      return { severity, category, description };
    })
    .filter((i) => i.category && i.category !== 'none');

  const suggestions = suggestionsBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'No changes needed.');

  const facts = factsBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('F') && l.includes('|'))
    .map((l) => {
      const parts = l.split('|').map((p) => p.trim());
      const [factId, claim, sourceName, sourceUrlPart, jurisdiction, verdictPart] = parts;
      return {
        fact_id: factId || '',
        claim: claim || '',
        source_name: sourceName || '',
        source_url: sourceUrlPart || '',
        jurisdiction: jurisdiction || '',
        verdict: verdictPart || '',
      };
    })
    .filter((f) => f.claim);

  return { verdict, summary, issues, suggestions, facts, peopleAlsoAsk: markUsedQuestions(content, peopleAlsoAsk), raw: text };
}

// Rewrites an existing blog to fix a given set of audit issues/suggestions, using the same
// house voice, research, and Facts Register as new drafts. Runs through the same
// validate+auto-repair loop as researchAndWriteBlog so a rewrite can't ship with the same
// problems it was supposed to fix.
async function rewriteBlog({ title, content, issues, suggestions, signal, onProgress }: any) {
  const systemPrompt = await buildSystemPrompt();

  const issuesList = (issues || [])
    .map((i) => `- [${i.severity}/${i.category}] ${i.description}`)
    .join('\n');
  const suggestionsList = (suggestions || []).map((s) => `- ${s}`).join('\n');

  const userPrompt = `Rewrite this existing blog post to fix every issue listed below. Keep what
already works (the parts not flagged), research and correct anything flagged as inaccurate using
web search, and follow all of your standing instructions (voice, word limit, Facts Register,
FAQ/structure). Do not just patch around the issues - produce a complete, clean, publish-ready
replacement.

ORIGINAL TITLE: ${title || '(untitled)'}

ISSUES TO FIX:
${issuesList || '(none listed - do a general quality pass)'}

SPECIFIC FIXES REQUESTED:
${suggestionsList || '(none listed)'}

ORIGINAL CONTENT:
${content.slice(0, 20000)}`;

  // Same tool brief as new drafts (minus Surfer, to keep bulk renewals from using Surfer credits),
  // keyed on the post's title since an existing post has no pipeline keyword.
  let briefText = '';
  let paaQuestions: any[] = [];
  if (title) {
    const brief = await gatherBrief(title.replace(/&[#a-z0-9]+;/gi, ' ').slice(0, 80), { includeSurfer: false });
    briefText = formatBrief(brief);
    paaQuestions = brief.peopleAlsoAsk || [];
  }

  const messages = [{ role: 'user', content: [userPrompt, briefText].filter(Boolean).join('\n\n') }];
  let attempt = 0;
  let result: any;
  let validation: any;

  while (attempt <= MAX_REPAIR_ATTEMPTS) {
    const { text: rawText, assistantMessages } = await callClaude(systemPrompt, messages, undefined, { feature: 'audit' });
    result = parseBlogResponse(rawText);
    validation = await validateDraft({ title: result.title, meta: result.meta, content: result.content, facts: result.facts, paaQuestions });

    // Independent fact check: a separate maximum-effort pass (FACT_CHECK_MODEL) re-verifies every
    // hard claim against primary sources. Any wrong or unverifiable claim sends the draft back.
    if (validation.passed) {
      onProgress?.('Independent fact check against primary sources…', 34 + attempt * 22);
      const check = await factCheckDraft(result, signal);
      result.factCheck = check;
      const bad = check.checks.filter((c) => c.verdict !== 'correct');
      if (bad.length) {
        validation.passed = false;
        validation.issues = [
          ...validation.issues,
          ...bad.map((c) => `Fact check (${c.verdict}): "${c.claim}". ${c.correction ? `Correct version: ${c.correction}. ` : ''}${c.source_url ? `Source: ${c.source_url}` : 'Remove it if it cannot be verified.'}`),
        ];
      }
    }

    if (validation.passed) break;
    if (attempt === MAX_REPAIR_ATTEMPTS) break;

    messages.push(...assistantMessages);
    messages.push({
      role: 'user',
      content: `This rewrite failed validation. Fix these specific issues and return the FULL
corrected draft again in the exact same format (===TITLE=== through ===END===):\n- ${validation.issues.join('\n- ')}`,
    });
    attempt++;
  }

  return {
    ...result,
    validation,
    peopleAlsoAsk: markUsedQuestions(result.content, paaQuestions),
    repairAttempts: attempt,
    productionState: validation.passed ? 'READY_FOR_REVIEW' : 'NEEDS_ATTENTION',
  };
}


// Researches real high-engagement blogs across the internet (any niche - hooks, structure,
// storytelling vs. educational patterns), combines that with our own GA4 engagement data, and
// produces/refreshes the self-updating content-writing skill. Runs without human approval (it
// only shapes future drafts, never publishes) but every version is kept in writing_skills for
// audit/rollback.
async function generateContentSkill({ batch = false }: any = {}) {
  const previous = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });

  let ownPerformanceNote = 'No GA4 data available this cycle.';
  try {
    const pages = await getTopLandingPages(28, 10);
    if (pages.length) {
      ownPerformanceNote = pages
        .map((p) => `${p.page}: ${p.sessions} sessions, ${p.conversions} conversions`)
        .join('\n');
    }
  } catch (e: any) {
    ownPerformanceNote = `GA4 unavailable this cycle: ${e.message}`;
  }

  const systemPrompt = `You are a content-writing skill researcher. Your only job is to study how
genuinely high-engagement blogs are written - across any niche, not just finance - and distill
concrete, reusable writing techniques from them. You are not writing a blog yourself.

Research using web search:
- Find examples of blogs/articles with real evidence of high engagement (widely shared,
  highly commented, referenced as examples of good content by marketing/writing sources, or
  from publications known for strong engagement).
- Study: what hooks do they open with (question, stat, story, contrarian claim)? What structure
  (storytelling arc vs. direct educational/listicle vs. problem-solution)? How do they use
  subheadings, pacing, white space, examples? How do they keep a reader reading to the end?
- Look at a mix of styles, not just one niche, then judge what's genuinely transferable to a
  professional B2B/finance-adjacent audience (not clickbait tactics that would look unprofessional
  for a CFO firm).

${
    previous
      ? `PREVIOUS SKILL VERSION (refine this, don't start over - keep what's working, change
what the new research or performance data suggests should change):\n${previous.skill_content}`
      : 'No previous version exists - this is the first one.'
  }

OUR OWN RECENT PERFORMANCE (GA4, last 28 days, top landing pages by sessions):
${ownPerformanceNote}

Produce an updated, concrete writing skill: specific techniques a writer can actually apply, not
vague advice like "be engaging". Every technique should be something you can point to a real
example of. This will be layered on top of house voice/accuracy rules and a permanent, fact-checked
SEO/GEO/AEO playbook that don't change (answer-first opening, primary-source links, FAQ, internal
links, no em dashes, no hype words), so never contradict those. This skill is about craft (hooks,
structure, pacing, engagement), not about facts, SEO rules or tone.

Return plain text in EXACTLY this format, with no extra commentary before or after:

===SKILL===
<the actual skill content: a concise, concrete set of techniques, organized under short
headings like "Hooks", "Structure", "Pacing", "Engagement". Written as direct instructions a
writer follows, not a report about the research.>
===RESEARCH_SUMMARY===
<3-6 bullet points: what you found this cycle and what changed vs. the previous version, if any>
===SOURCES===
<one per line, format: Title | URL>
===END===`;

  const { text } = await callClaude(
    systemPrompt,
    [{ role: 'user', content: "Research and produce this cycle's content-writing skill update." }],
    undefined,
    { maxUses: 10, batch, feature: 'training' }
  );

  const get = (start, end) => {
    const startIdx = text.indexOf(start);
    if (startIdx === -1) return '';
    const from = startIdx + start.length;
    const endIdx = end ? text.indexOf(end, from) : text.length;
    return text.slice(from, endIdx === -1 ? text.length : endIdx).trim();
  };

  const skillContent = get('===SKILL===', '===RESEARCH_SUMMARY===');
  const researchSummary = get('===RESEARCH_SUMMARY===', '===SOURCES===');
  const sourcesBlock = get('===SOURCES===', '===END===');

  if (!skillContent) {
    throw new Error("Could not parse a valid skill update from Claude's response.");
  }

  const sources = sourcesBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [title, url] = l.split('|').map((p) => p.trim());
      return { title, url };
    });

  return { skillContent, researchSummary, sources, ownPerformanceNote };
}

// Re-checks the open issues of a draft that needs attention against the CURRENT article, with the
// whole article and a topic brief as context: an issue is resolved when the article no longer makes
// the mistake (fixed or removed), and stays open, with its correction, when it still does.
export async function recheckIssues(draft, issues: string[], signal?) {
  const brief = await buildTopicBrief({ title: draft.title, meta: draft.meta_description, content: draft.content_html }, signal);
  const today = new Date().toISOString().slice(0, 10);
  const system = `You are a senior US-India tax fact checker. Today is ${today}. A draft was held because a fact check
left the numbered issues below open. The article may have been edited since. For EACH issue, read the
whole current article and decide: "resolved" if the article no longer makes that mistake (the sentence
was fixed, completed or removed), or "open" if it still does. For an open issue, check it on a primary
source (irs.gov, ecfr.gov, uscode.house.gov, incometaxindia.gov.in, incometax.gov.in, rbi.org.in, the
treaty text) and give the exact sentence still wrong and a short correction. An issue the source shows
was itself wrong (the article was right) is "resolved". You have up to 10 web searches.

${FACT_CHECK_METHOD}

TOPIC BRIEF (latest law, current sections and forms, reader)
${brief}

Return ONLY JSON between ===JSON=== and ===END===:
{"results":[{"n":1,"status":"resolved|open","sentence":"","correction":"","source_url":""}]}`;
  const user = `ISSUES\n${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nCURRENT ARTICLE\nTitle: ${draft.title}\nMeta: ${draft.meta_description}\n\n${draft.content_html}`;
  const { text } = await callClaude(system, [{ role: 'user', content: user }], signal, { maxUses: 10, effort: 'high', model: FACT_CHECK_BRIEF_MODEL(), feature: 'fact-check' });
  const m = text.match(/===JSON===([\s\S]*?)===END===/);
  const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
  const list = Array.isArray(parsed.results) ? parsed.results : [];
  // An issue without a clear verdict stays open: nothing is cleared unchecked.
  return issues.map((issue, i) => {
    const r = list.find((x) => Number(x?.n) === i + 1);
    if (r?.status === 'resolved') return { issue, open: false };
    return { issue, open: true, text: r ? `Still open: "${r.sentence || ''}". ${r.correction ? `Correct version: ${r.correction}. ` : ''}${r.source_url ? `Source: ${r.source_url}` : ''}`.trim() : issue };
  });
}

export { researchAndWriteBlog, generateDailyDigest, auditBlog, rewriteBlog, generateContentSkill, callClaude, factCheckDraft, verifyAndCorrect };
