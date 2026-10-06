// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import Anthropic from '@anthropic-ai/sdk';
import * as settings from './settings';
import prisma from './prisma';
import { rethrowFriendly } from './apiErrors';
import { assertCredits, recordUsage, onApiError } from './aiCredits';
import { validateDraft, markUsedQuestions } from './validation';
import { getWriterPlaybook, getAuditGates } from './playbook';
import { gatherBrief, formatBrief, aiOverviewSummary } from './researchBrief';
import { buildKeywordPlan } from './blogKeywords';
import { chooseKeywords, planForPrompt } from './keywordPlanner';
import { getTopLandingPages } from './ga4';

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  return new Anthropic({ apiKey });
}

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
  const author = await settings.get('byline_author');
  const reviewer = await settings.get('byline_reviewer');
  const ctaText = await settings.get('cta_text');
  const ctaUrl = await settings.get('cta_url');
  const playbookReference = playbook
    ? `\n\nSEO / GEO / AEO PLAYBOOK (permanent, researched and fact-checked; follow it on every article,
together with the house rules above; if anything here conflicts with accuracy or the house voice,
accuracy and the house voice win):\n${playbook}

HOW THE PLAYBOOK MAPS TO THIS DASHBOARD (these override the playbook where they differ):
- Do NOT write an <h1> in the content: WordPress prints the SEO title as the H1. Start at <h2>.
- Byline: put one short line right after the opening answer: "${author ? `By ${author}` : 'By [AUTHOR NAME, CREDENTIAL]'}. ${reviewer ? `Reviewed by ${reviewer}` : 'Reviewed by [REVIEWER NAME, CREDENTIAL]'}." Use exactly these names; never invent or change a name or credential. Do not write "Published" or "Last updated" dates: WordPress shows the dates.
- Call to action: end the article (after the disclaimer) with exactly one call to action: "${ctaText}", linked to ${ctaUrl}.
- The Facts Register goes ONLY in the ===FACTS=== section of the output format below, never in ===CONTENT===. List the FAQ sources (each FAQ question with its source and market, e.g. "paa, US") as bullets at the end of ===RESEARCH_NOTES===.
- Placeholders such as [PRACTITIONER NOTE NEEDED], [VISUAL SUGGESTION: ...] and the byline placeholders are allowed; the reviewer replaces them and publishing is blocked until they do.`
    : '';

  return `You are the USAIndiaCFO blog writer. USAIndiaCFO is a Virtual CFO firm serving the USA
and India: cross-border tax, compliance, entity setup, GST/ROC, US GAAP, FEMA/RBI, fundraising,
and family office / HNI wealth work. Blog readers include founders, SMEs, HNIs, family offices,
and finance peers (CAs, CPAs) - some of them will notice a wrong number or a misquoted statute, so
accuracy comes before cleverness, every time.

RESEARCH (do this before writing, using web search):
- Prefer primary sources: IRS, US Treasury, CBDT, RBI, SEBI, GST Council, DGFT, USCIS/DOL,
  official gazettes and circulars, the actual text of the relevant act/section.
- Reputable secondary sources are fine as backup: Big Four advisories, Economic Times, Mint,
  Bloomberg, Reuters, WSJ, ICAI/AICPA.
- For every hard claim (a number, rate, threshold, deadline, section reference, or "new" rule),
  confirm it across at least two sources, or one primary source. If sources disagree, say so and
  give the range. Confirm the rule/figure is current as of today.
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
  every sub-question they cover and the ones they miss. Research has no search budget limit.
- No AI filler or hype vocabulary ("delve", "unlock", "seamless", "robust", "game-changer",
  "navigate the landscape", "unprecedented", "in today's fast-paced world", canned hooks like
  "Here's what nobody tells you", empty closers like "The future is bright"). No em dashes.
- Where the piece gives guidance, include a brief line noting it is general information, not
  individualized tax/legal advice.
- Length: size the article to what the search intent needs; about ${maxWords} words is the house
  guideline for most topics. Never pad, and cut background, generic definitions and repeated
  caveats before adding words.${playbookReference}${skillReference}${clientInsightReference}${strategyReference}

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
===END===`;
}

// One model turn with live web search. Streams (long research turns would otherwise risk HTTP
// timeouts), resumes when a long search pauses the turn, and returns the text plus the exact
// assistant messages, so a repair round can send the turn back unchanged (the current models
// reject edited history).
// batch: true sends the turn through the Message Batches API instead (50% cheaper, but it can take
// minutes to hours to come back, and refusal fallbacks are not allowed there). Only for unattended
// jobs nobody is waiting on.
async function callClaude(systemPrompt, userMessages, signal, { maxUses = 8, effort = 'high', batch = false, model = MODEL, feature = 'other' }: any = {}) {
  const client = getClient();
  const conversation = [...userMessages];
  const assistantMessages: any[] = [];

  for (let part = 0; part < 6; part++) {
    // Refuses to start when AI work is paused for low credits (see lib/aiCredits.ts).
    await assertCredits();
    if (batch) {
      const response = await runBatchTurn(client, {
        model,
        max_tokens: 32000,
        output_config: { effort },
        system: systemPrompt,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
        messages: conversation,
      }, signal).catch(async (err: any) => {
        await onApiError(err);
        throw err;
      });
      await recordUsage({ model, usage: response.usage, feature, batch: true });
      if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');
      const message = { role: 'assistant', content: response.content };
      assistantMessages.push(message);
      conversation.push(message);
      if (response.stop_reason !== 'pause_turn') break;
      continue;
    }

    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort },
        system: systemPrompt,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
        messages: conversation,
      },
      { signal }
    );
    const response = await stream.finalMessage().catch(async (err: any) => {
      await onApiError(err);
      return rethrowFriendly(err, signal);
    });
    await recordUsage({ model: response.model || model, usage: response.usage, feature });
    if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.');

    const message = { role: 'assistant', content: response.content };
    assistantMessages.push(message);
    conversation.push(message);
    if (response.stop_reason !== 'pause_turn') break;
  }

  const text = assistantMessages
    .flatMap((m) => m.content)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { text, assistantMessages };
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
    if (item.result.type === 'errored') throw new Error(`Batch request failed: ${item.result.error?.error?.message || item.result.error?.type || 'unknown error'}`);
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
  const researchNotes = get('===RESEARCH_NOTES===', '===END===');

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

  return { title, meta, content, researchNotes, facts, raw: text };
}

const WRITER_SEARCHES = () => Number(process.env.WRITER_MAX_SEARCHES) || 40;
// The fact checker can run on a different (stronger) model than the writer. Default: the same top model.
const FACT_CHECK_MODEL = () => process.env.FACT_CHECK_MODEL || MODEL;

// Re-verifies every hard claim in a draft (numbers, rates, thresholds, deadlines, sections, forms,
// "new" rules) against primary sources with web search, independently of the writer.
async function factCheckDraft(result, signal, { mustCheck = [] }: any = {}) {
  const system = `You are a senior US-India tax fact checker. You did not write this article. Find every hard
claim in it (a number, rate, threshold, deadline, statute or section, form number, or "new" rule) and
verify each one against a primary source (irs.gov, treasury.gov, fincen.gov, incometax.gov.in,
incometaxindia.gov.in, cbic-gst.gov.in, rbi.org.in, sebi.gov.in, mca.gov.in, the treaty text) as of
today, ${new Date().toISOString().slice(0, 10)}. Use web search for every claim; there is no search budget.
verdict is "correct" only when a primary source confirms it as currently applicable. Otherwise
"incorrect" (give the correction) or "unverifiable". Return ONLY JSON between ===JSON=== and ===END===:
{"checks":[{"claim":"exact sentence or phrase","verdict":"correct|incorrect|unverifiable","correction":"","source_url":""}]}`;
  const user = `Title: ${result.title}\nMeta: ${result.meta}\n\nArticle HTML:\n${result.content}\n\nWriter's Facts Register:\n${(result.facts || [])
    .map((f) => `${f.fact_id} | ${f.claim} | ${f.source_url}`)
    .join('\n')}${mustCheck.length ? `\n\nThese sentences state figures, rates or deadlines. Each one MUST appear in "checks" (quote it as "claim"):\n${mustCheck.map((x) => `- ${x}`).join('\n')}` : ''}`;
  const { text } = await callClaude(system, [{ role: 'user', content: user }], signal, { maxUses: 60, effort: 'max', model: FACT_CHECK_MODEL(), feature: 'fact-check' });
  const m = text.match(/===JSON===([\s\S]*?)===END===/);
  try {
    const parsed = JSON.parse((m ? m[1] : text).trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
    return { checks: Array.isArray(parsed.checks) ? parsed.checks : [], model: FACT_CHECK_MODEL() };
  } catch {
    // An unreadable check never lets a draft through as checked.
    return { checks: [{ claim: 'Fact check output could not be read', verdict: 'unverifiable', correction: '', source_url: '' }], model: FACT_CHECK_MODEL() };
  }
}

const FACT_CHECK_ROUNDS = () => Math.max(2, Number(process.env.FACT_CHECK_ROUNDS) || 50);

// Fixes the claims a fact check flagged: corrects each one from its primary source, or removes it
// (or rewrites the sentence without the figure) when no primary source confirms it.
async function correctClaims(draft, bad, signal) {
  const system = `You correct a US-India tax article. Change ONLY the flagged claims below. For each one: if a
correction and primary source are given, use the corrected fact and link the source; if it is
unverifiable, remove the claim or rewrite the sentence without the unverified figure. Keep everything
else exactly as it is (structure, headings, links, FAQ, tone). Never add a new number, rate or deadline.
No em dashes. Return ONLY: ===TITLE===<title>===META===<meta description>===CONTENT===<full HTML>===END===`;
  const user = `Flagged claims:\n${bad
    .map((c) => `- "${c.claim}" (${c.verdict})${c.correction ? ` Correct: ${c.correction}` : ''}${c.source_url ? ` Source: ${c.source_url}` : ''}`)
    .join('\n')}\n\nTitle: ${draft.title}\nMeta: ${draft.meta}\n\nHTML:\n${draft.content}`;
  const { text } = await callClaude(system, [{ role: 'user', content: user }], signal, { maxUses: 20, effort: 'max', model: FACT_CHECK_MODEL(), feature: 'fact-check' });
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

// Fact-checks a draft against primary sources over and over, correcting it between rounds, until two
// independent checks in a row find nothing wrong (and every figure sentence was checked). Gives up
// after FACT_CHECK_ROUNDS (default 50) rounds; the caller then holds the blog instead of publishing.
// `check` and `correct` are injectable for tests.
async function verifyAndCorrect(draft, { signal, mustCheckOf = (_html) => [], check = factCheckDraft, correct = correctClaims, maxRounds = FACT_CHECK_ROUNDS() }: any = {}) {
  let current = { title: draft.title, meta: draft.meta, content: draft.content };
  let clean = 0;
  const log = [];
  for (let round = 1; round <= maxRounds; round++) {
    const mustCheck = mustCheckOf(current.content);
    const result = await check({ ...current, facts: draft.facts || [] }, signal, { mustCheck });
    const bad = result.checks.filter((c) => c.verdict !== 'correct');
    // A figure sentence the checker skipped counts as unverified.
    const checked = result.checks.map((c) => String(c.claim || '').toLowerCase());
    const skipped = mustCheck.filter((sent) => !checked.some((c) => c && (sent.toLowerCase().includes(c) || c.includes(sent.toLowerCase().slice(0, 60)))));
    log.push({ round, claims: result.checks.length, wrong: bad.length, skipped: skipped.length });
    if (!bad.length && !skipped.length) {
      clean++;
      if (clean >= 2) return { ok: true, rounds: round, draft: current, log };
      continue;
    }
    clean = 0;
    if (!bad.length) continue; // only skipped sentences: check again, they must be covered
    current = await correct(current, bad, signal);
  }
  return { ok: false, rounds: maxRounds, draft: current, log };
}

// Runs the full "select+research -> draft+optimize -> validate+package" pipeline for one
// keyword, auto-repairing up to MAX_REPAIR_ATTEMPTS times, per the Frozen Playbook.
async function researchAndWriteBlog(keyword, notes, { signal, onProgress }: any = {}) {
  const systemPrompt = await buildSystemPrompt();

  onProgress?.('Gathering data from SE Ranking, Google, Search Console, WordPress and Surfer…', 6);
  const brief = await gatherBrief(keyword, { includeSurfer: true });
  if (signal?.aborted) throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });

  // Keyword research comes first: decide the plan (which keywords, which questions, and where each
  // goes) from the research, then write to it. The plan is saved with the draft and checked after.
  const keywordPlan = buildKeywordPlan(brief, keyword);
  const chosen = chooseKeywords(keywordPlan, keyword);
  onProgress?.(`Keyword plan ready: ${chosen.secondary.length} secondary keywords, ${chosen.questions.length} questions. Writing to the plan…`, 15);

  const userPrompt = [
    `Target keyword: "${keyword}"`,
    notes ? `Additional context from the content team: ${notes}` : '',
    planForPrompt(chosen),
    formatBrief(brief),
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [{ role: 'user', content: userPrompt }];
  let attempt = 0;
  let result: any;
  let validation: any;

  while (attempt <= MAX_REPAIR_ATTEMPTS) {
    onProgress?.(
      attempt === 0 ? 'Researching sources & writing the draft…' : `Repairing draft, attempt ${attempt}…`,
      18 + attempt * 22
    );
    const { text: rawText, assistantMessages } = await callClaude(systemPrompt, messages, signal, { maxUses: WRITER_SEARCHES(), effort: 'max', feature: 'blog' });

    onProgress?.('Validating draft & fact-checking claims…', 30 + attempt * 22);
    result = parseBlogResponse(rawText);
    validation = await validateDraft({
      title: result.title,
      meta: result.meta,
      content: result.content,
      facts: result.facts,
      keyword,
      paaQuestions: brief.peopleAlsoAsk,
      keywordPlan,
    });

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
      content: `This draft failed validation. Fix these specific issues and return the FULL
corrected draft again in the exact same format (===TITLE=== through ===END===):\n- ${validation.issues.join('\n- ')}`,
    });
    attempt++;
  }

  onProgress?.('Saving draft…', 96);

  return {
    ...result,
    validation,
    peopleAlsoAsk: markUsedQuestions(result.content, brief.peopleAlsoAsk),
    keywordPlan,
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
async function rewriteBlog({ title, content, issues, suggestions }) {
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

export { researchAndWriteBlog, generateDailyDigest, auditBlog, rewriteBlog, generateContentSkill, callClaude, factCheckDraft, verifyAndCorrect };
