/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- not type checked: the project's full type check (npm run typecheck) runs at the edge of
// the default heap, and this file is test scaffolding over untyped (any) tool definitions.
// The assistant's tab tools (lib/assistant/tabTools.ts): every write tool is refused, at the card and
// again when approved, to a person without the permission its tab needs; every one calls the same
// lib function as its route; and the important ones behave as the tabs do. Database tests use
// DATABASE_URL (local test database only). Nothing reaches an outside service, the website or the
// Anthropic API: fetch throws, and the engine stops in Testing mode before any API call. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const db = Boolean(process.env.DATABASE_URL);
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
process.env.SLACK_WEBHOOK_URL = '';
for (const k of ['SITE_WEBHOOK_URL', 'SITE_WEBHOOK_SECRET', 'SERPHOUSE_API_KEY', 'SERANKING_API_KEY', 'SURFER_API_KEY', 'COPYSCAPE_USERNAME', 'PEXELS_API_KEY', 'OPENAI_API_KEY', 'SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET']) delete process.env[k];
const outside: string[] = [];
globalThis.fetch = (async (url: any) => {
  const u = String(url instanceof Request ? url.url : url);
  outside.push(u);
  throw new Error(`Network call in a test: ${u}`);
}) as any;

const ROOT = path.join(__dirname, '..');
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ADMIN = { email: 'admin@test.local', name: 'Admin Test', role: 'admin' as const, blocked: false };
const MANAGER = { email: 'manager@test.local', name: 'Manager Test', role: 'manager' as const, blocked: false };
const ANALYST = { email: 'analyst@test.local', name: 'Analyst Test', role: 'analyst' as const, blocked: false };
const USER = { email: 'user@test.local', name: 'User Test', role: 'user' as const, blocked: false };
const BLOCKED = { ...USER, email: 'blocked@test.local', blocked: true };

const tools = () => import('../lib/assistant/tools');
const tab = () => import('../lib/assistant/tabTools');

// The smallest input the tool's schema accepts, so the gate (not validation) is what answers.
function minimalValue(p: any): any {
  if (p.enum) return p.enum[0];
  if (p.type === 'integer') return 999999999;
  if (p.type === 'boolean') return false;
  if (p.type === 'object') return p.properties ? minimalInput(p) : { slug: '/x' };
  if (p.type === 'array') return [minimalValue(p.items || {})];
  return 'x';
}
function minimalInput(schema: any): any {
  const out: any = {};
  for (const key of schema.required || []) out[key] = minimalValue(schema.properties?.[key] || {});
  return out;
}

// Which tool calls which shared function, and which route calls it too.
const SHARED: Record<string, [fn: string, route: string]> = {
  calendar_decide: ['decideSchedule', 'app/api/strategy/schedule/[id]/route.ts'],
  calendar_publish_now: ['decideSchedule', 'app/api/strategy/schedule/[id]/route.ts'],
  strategy_generate: ['startStrategyJob', 'app/api/strategy/route.ts'],
  strategy_control: ['controlStrategyJob', 'app/api/strategy/[id]/control/route.ts'],
  strategy_edit_section: ['editSection', 'app/api/strategy/[id]/route.ts'],
  strategy_refresh: ['refreshStrategy', 'app/api/strategy/[id]/refresh/route.ts'],
  strategy_log_change: ['logStrategyChange', 'app/api/strategy/[id]/changes/route.ts'],
  manual_task_guide: ['manualTaskAction', 'app/api/strategy/manual/route.ts'],
  manual_task_update: ['manualTaskAction', 'app/api/strategy/manual/route.ts'],
  backlink_task_status: ['setBacklinkStatus', 'app/api/strategy/backlinks/[id]/route.ts'],
  topics_research: ['researchTopics', 'app/api/topics/route.ts'],
  topic_action: ['topicAction', 'app/api/topics/[id]/route.ts'],
  generate_blog_draft: ['claimKeywordForGeneration', 'app/api/generate/route.ts'],
  stop_generation: ['stopGeneration', 'app/api/generate/stop/route.ts'],
  retry_keyword: ['retryKeyword', 'app/api/keywords/[id]/retry/route.ts'],
  draft_set_status: ['patchDraft', 'app/api/drafts/[id]/route.ts'],
  draft_set_author: ['patchDraft', 'app/api/drafts/[id]/route.ts'],
  draft_set_cover_alt: ['patchDraft', 'app/api/drafts/[id]/route.ts'],
  draft_delete: ['deleteDraft', 'app/api/drafts/[id]/route.ts'],
  draft_recheck: ['recheckDraft', 'app/api/drafts/[id]/recheck/route.ts'],
  draft_fix_issues: ['recheckDraft', 'app/api/drafts/[id]/recheck/route.ts'],
  draft_originality_check: ['checkDraftOriginality', 'app/api/drafts/[id]/originality/route.ts'],
  draft_optimise: ['startOptimise', 'app/api/drafts/[id]/optimise/route.ts'],
  draft_new_cover: ['newPhotoCover', 'app/api/drafts/[id]/cover/route.ts'],
  fact_set_status: ['setFactStatus', 'app/api/facts/[id]/route.ts'],
  draft_restore: ['restoreDraftVersion', 'app/api/drafts/[id]/restore/route.ts'],
  draft_publish: ['publishDraft', 'app/api/drafts/[id]/publish/route.ts'],
  audit_rewrite: ['startRewrite', 'app/api/audit/[id]/rewrite/route.ts'],
  audit_stop: ['stopJob', 'app/api/audit/stop/route.ts'],
  audit_publish_live: ['publishAudit', 'app/api/audit/[id]/publish/route.ts'],
  update_writing_rules: ['saveSettings', 'app/api/settings/route.ts'],
  save_writing_skill: ['saveSkillEdit', 'app/api/skill/route.ts'],
  generate_writing_skill: ['generateSkillNow', 'app/api/skill/generate/route.ts'],
  learn_lessons: ['startLessons', 'app/api/lessons/route.ts'],
  site_content_save: ['siteContentAction', 'app/api/site-content/route.ts'],
  site_content_delete: ['siteContentAction', 'app/api/site-content/route.ts'],
  performance_explain: ['explainPerformance', 'app/api/performance/explain/route.ts'],
  meetings_sync: ['syncMeetings', 'app/api/client-insights/route.ts'],
  meeting_insight_review: ['reviewInsight', 'app/api/client-insights/[id]/route.ts'],
  seranking_topup: ['startKeywordTopup', 'app/api/seranking/topup/route.ts'],
};

test('every tab write tool calls the same lib function as its route', async () => {
  const { TAB_TOOLS } = await tab();
  const writes = TAB_TOOLS.filter((t: any) => t.kind === 'write');
  assert.deepEqual(writes.map((t: any) => t.name).filter((n: string) => !SHARED[n]), [], 'every write tool is in the table');
  for (const t of writes) {
    const [fn, route] = SHARED[t.name];
    assert.ok(t.run.toString().includes(fn), `${t.name} calls ${fn}`);
    assert.ok(fs.readFileSync(path.join(ROOT, route), 'utf8').includes(fn), `${route} calls ${fn}`);
    assert.equal(typeof t.summarize, 'function', t.name);
  }
});

test('write tools name the permission of their tab; anything unnamed needs website.change', async () => {
  const { toolNeeds, getTool } = await tools();
  assert.deepEqual(toolNeeds('calendar_decide', { action: 'approve' }), ['manual.do']);
  assert.deepEqual(toolNeeds('calendar_publish_now', { action: 'publish_now' }), ['blog.publish_now']);
  assert.deepEqual(toolNeeds('manual_task_update', { action: 'assign' }), ['manual.assign']);
  assert.deepEqual(toolNeeds('manual_task_update', { action: 'done' }), ['manual.do']);
  assert.deepEqual(toolNeeds('audit_publish_live', {}), ['blog.publish_now']);
  assert.deepEqual(toolNeeds('site_content_save', {}), ['website.change']);
  assert.deepEqual(toolNeeds('site_content_delete', {}), ['website.change']);
  assert.deepEqual(toolNeeds('strategy_edit_section', {}), ['strategy.edit']);
  assert.deepEqual(toolNeeds('update_writing_rules', {}), ['settings.change']);
  assert.deepEqual(toolNeeds('seranking_topup', {}), ['settings.change']);
  assert.deepEqual(toolNeeds('draft_publish', {}), ['content.work', 'website.change']);
  assert.deepEqual(toolNeeds('draft_publish', { skip_checks: true }), ['content.work', 'website.change', 'blog.publish_now']);
  assert.deepEqual(toolNeeds('ai_credits_status', {}), ['credits.view']);
  assert.deepEqual(toolNeeds('draft_edit_text', {}), ['content.work']);
  // A write tool added later without a permission is not open to everyone.
  const t = getTool('draft_set_author');
  const saved = t.needs;
  delete t.needs;
  try {
    assert.deepEqual(toolNeeds('draft_set_author', {}), ['website.change']);
  } finally {
    t.needs = saved;
  }
});

test('the system prompt names only tools that exist, and says what stays in the dashboard', async () => {
  const { SYSTEM_PROMPT } = await import('../lib/assistant/prompt');
  const { TOOLS } = await tools();
  const names = new Set(TOOLS.map((t: any) => t.name));
  const mentioned = [...new Set(SYSTEM_PROMPT.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) || [])].filter((w) => !['web_search', 'wp_post_url', 'content_html', 'meta_description', 'fact_check', 'ask_reviewer', 'image_id', 'attached_document'].includes(w) && !w.endsWith('_'));
  for (const w of mentioned) if (!w.startsWith('search_console')) assert.ok(names.has(w), `prompt mentions ${w}`);
  for (const t of TOOLS.filter((x: any) => x.kind === 'write')) assert.ok(SYSTEM_PROMPT.includes(t.name), `prompt lists ${t.name}`);
  assert.match(SYSTEM_PROMPT, /approval card/);
  assert.match(SYSTEM_PROMPT, /STAYS IN THE DASHBOARD/);
  for (const w of ['Team & Roles', 'Testing / Live mode', 'OAuth', 'Associate Training test', 'approving the monthly strategy', 'Smartlead', 'make_word_file', 'set a level', 'importing a meeting insight', 'keyword suggestions for an older draft', 'Surfer terms', 'try again after someone presses Resume', 'keyword_research and serp_top_results are paid']) assert.ok(SYSTEM_PROMPT.includes(w), w);
  assert.doesNotMatch(SYSTEM_PROMPT, /You cannot change the company website/);
});

// Each write tool, for a person whose role lacks its permission: no card is shown, and approving a
// card (made earlier, or by someone else) is refused when it runs, without calling the tool.
test('every write tool is refused at the card and when approved to a role without its permission', { skip: !db, timeout: 120000 }, async () => {
  const { TOOLS, getTool, toolNeeds } = await tools();
  const { proposeTools, decide } = await import('../lib/assistant/engine');
  const { can } = await import('../lib/permissions');
  const prisma: any = (await import('../lib/prisma')).default;
  const g = globalThis as any;
  const writes = TOOLS.filter((t: any) => t.kind === 'write');
  assert.ok(writes.length >= 45, `${writes.length} write tools`);
  const conv = await prisma.assistant_conversations.create({ data: { title: `gate ${stamp()}`, status: 'idle', created_by: USER.email } });
  try {
    for (const t of writes) {
      const input = minimalInput(t.input_schema);
      const needs = toolNeeds(t.name, input);
      // A plain user lacks most permissions; for ones every user has (manual.do), a blocked person.
      const me = needs.every((a: any) => can('user', a)) ? BLOCKED : USER;
      const events: any[] = [];
      const proposed = await proposeTools({ id: conv.id }, [{ id: `tu_${t.name}`, name: t.name, input }], (e: any) => events.push(e), me);
      assert.equal(proposed.actions.length, 0, `${t.name}: no card`);
      assert.equal(proposed.readResults[0].is_error, true, t.name);
      assert.match(proposed.readResults[0].content, /not open to their role/, t.name);

      // Someone with the permission gets the card.
      const allowed = await proposeTools({ id: conv.id }, [{ id: `tu_${t.name}`, name: t.name, input }], () => {}, ADMIN);
      assert.equal(allowed.actions.length, 1, `${t.name}: admin gets a card`);

      // A card approved by a person without the permission does not run.
      let ran = 0;
      const tool = getTool(t.name);
      const run = tool.run;
      tool.run = async () => {
        ran++;
        return { result: {} };
      };
      await prisma.assistant_conversations.update({
        where: { id: conv.id },
        data: { status: 'awaiting_approval', messages: '[]', pending: JSON.stringify({ readResults: [], actions: [{ toolUseId: 'tu_1', name: t.name, input, summary: 's', risk: 'low', preview: null }] }) },
      });
      g.__AI_MODE_PIN = 'testing'; // the engine stops before calling the API
      try {
        await decide({ conversationId: conv.id, decisions: [{ toolUseId: 'tu_1', approve: true }], me }, () => {}, new AbortController().signal).catch(() => {});
      } finally {
        g.__AI_MODE_PIN = 'live';
        tool.run = run;
      }
      assert.equal(ran, 0, `${t.name}: not run`);
      const saved = JSON.parse((await prisma.assistant_conversations.findUnique({ where: { id: conv.id } }))!.messages);
      const result = saved[0].content.find((b: any) => b.tool_use_id === 'tu_1');
      assert.equal(result.is_error, true, t.name);
      assert.match(result.content, /not open to their role/, t.name);
    }
  } finally {
    await prisma.assistant_conversations.deleteMany({ where: { id: conv.id } });
  }
});

// ---- Behaviour (database) ----

async function calendarFixture(prisma: any, opts: { status?: string; draftStatus?: string } = {}) {
  const s = stamp();
  const strategy = await prisma.seo_strategies.create({ data: { period: `test ${s}`, status: 'draft' } });
  const kw = await prisma.keywords.create({ data: { keyword: `office plants ${s}`, status: 'drafted', batch_name: `Strategy #${strategy.id}` } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: `Office plants for a calm workspace ${s}`, meta_description: 'Plants that suit an office.', content_html: '<h2>Why plants</h2><p>Plants make an office calmer and the air feels fresher.</p>', status: opts.draftStatus || 'pending_review' } });
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await prisma.blog_schedule.create({ data: { strategy_id: strategy.id, publish_at: future, title: draft.title, main_keyword: kw.keyword, tags: '[]', status: opts.status || 'in_review', draft_id: draft.id, review_started: new Date(Date.now() - 3600000).toISOString().slice(0, 19).replace('T', ' ') } });
  const cleanup = async () => {
    await prisma.blog_schedule.deleteMany({ where: { id: row.id } });
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: strategy.id } });
    await prisma.agent_memories.deleteMany({ where: { source_ref: `schedule:${row.id}` } }).catch(() => {});
  };
  return { strategy, kw, draft, row, cleanup };
}

test('calendar_decide: pause, resume, reschedule, reject needs feedback, approve; calendar_publish_now needs blog.publish_now', { skip: !db, timeout: 60000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const { proposeTools } = await import('../lib/assistant/engine');
  const f = await calendarFixture(prisma);
  try {
    const decideTool = getTool('calendar_decide');
    const ctx = { me: USER }; // every team member may decide on calendar blogs (manual.do)
    const p = await decideTool.preview({ id: f.row.id, action: 'pause' }, ctx);
    assert.match(p.target, /in_review/);
    await decideTool.run({ id: f.row.id, action: 'pause' }, ctx);
    let row = await prisma.blog_schedule.findUnique({ where: { id: f.row.id } });
    assert.equal(row!.status, 'paused');
    assert.equal(row!.paused_from, 'in_review');
    assert.equal(row!.paused_by, 'User Test (assistant)');

    await decideTool.run({ id: f.row.id, action: 'resume' }, ctx);
    row = await prisma.blog_schedule.findUnique({ where: { id: f.row.id } });
    assert.equal(row!.status, 'in_review');

    const later = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 16) + ':00Z';
    const r: any = await decideTool.run({ id: f.row.id, action: 'reschedule', publish_at: later }, ctx);
    assert.equal(r.result.publish_at, later.slice(0, 19).replace('T', ' ').replace('Z', ''));
    await assert.rejects(decideTool.run({ id: f.row.id, action: 'reschedule', publish_at: new Date(Date.now() + 60000).toISOString() }, ctx), /at least 30 minutes/);

    const short = await decideTool.preview({ id: f.row.id, action: 'reject', feedback: 'no' }, ctx);
    assert.match(short.problem, /feedback/);
    await assert.rejects(decideTool.run({ id: f.row.id, action: 'reject', feedback: 'no' }, ctx), /at least a sentence/);

    await decideTool.run({ id: f.row.id, action: 'approve' }, ctx);
    row = await prisma.blog_schedule.findUnique({ where: { id: f.row.id } });
    assert.ok(row!.reviewed_at, 'approved for its slot');
    assert.equal((await prisma.drafts.findUnique({ where: { id: f.draft.id } }))!.status, 'approved');

    // Publishing at once: not for an analyst (no card), and the same refusal in the shared function.
    const refused = await proposeTools({ id: 0 }, [{ id: 'a', name: 'calendar_publish_now', input: { id: f.row.id, action: 'publish_now' } }], () => {}, ANALYST);
    assert.equal(refused.actions.length, 0);
    assert.match(refused.readResults[0].content, /Only an admin or a manager can publish a blog straight away/);
    await assert.rejects(getTool('calendar_publish_now').run({ id: f.row.id, action: 'mark_done' }, { me: ANALYST }), /Only an admin or a manager/);

    // A manager marks it as already published outside the dashboard.
    const done: any = await getTool('calendar_publish_now').run({ id: f.row.id, action: 'mark_done', url: 'https://www.example.com/blog/plants/' }, { me: MANAGER });
    assert.equal(done.result.result, 'published');
    row = await prisma.blog_schedule.findUnique({ where: { id: f.row.id } });
    assert.equal(row!.status, 'published');
    assert.equal(row!.wp_post_url, 'https://www.example.com/blog/plants/');
    await assert.rejects(decideTool.run({ id: f.row.id, action: 'pause' }, ctx), /Already published/);
  } finally {
    await f.cleanup();
  }
});

test('the calendar route answers exactly as before through the shared function', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { PATCH } = await import('../app/api/strategy/schedule/[id]/route');
  const f = await calendarFixture(prisma);
  try {
    const call = (body: any) => PATCH(new Request(`http://x/api/strategy/schedule/${f.row.id}`, { method: 'PATCH', body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: String(f.row.id) }) });
    let res = await call({ action: 'nope' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /action must be/);
    res = await call({ action: 'publish_now' });
    assert.equal(res.status, 403, 'not signed in: refused');
    res = await call({ action: 'pause' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'paused');
    const missing = await PATCH(new Request('http://x', { method: 'PATCH', body: '{"action":"pause"}' }) as any, { params: Promise.resolve({ id: '999999999' }) });
    assert.equal(missing.status, 404);
  } finally {
    await f.cleanup();
  }
});

test('draft_set_status: approving a calendar draft approves its slot; a published blog keeps its status', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const f = await calendarFixture(prisma);
  try {
    const t = getTool('draft_set_status');
    const ctx = { me: ANALYST };
    const p = await t.preview({ id: f.draft.id, status: 'approved' }, ctx);
    assert.deepEqual(p.changes[0], { field: 'status', before: 'pending_review', after: 'approved' });
    const r: any = await t.run({ id: f.draft.id, status: 'approved' }, ctx);
    assert.equal(r.result.status, 'approved');
    assert.match(r.result.calendar || '', /Approved for the monthly calendar too/);
    const row = await prisma.blog_schedule.findUnique({ where: { id: f.row.id } });
    assert.ok(row!.reviewed_at);
    assert.equal(row!.reviewed_by, 'Analyst Test (assistant)');
    const log = await prisma.activity_log.findFirst({ where: { action: 'draft.approved', entity_id: f.draft.id }, orderBy: { id: 'desc' } });
    assert.equal(log?.actor, 'Analyst Test (assistant)');

    await t.run({ id: f.draft.id, status: 'rejected' }, ctx);
    assert.equal((await prisma.drafts.findUnique({ where: { id: f.draft.id } }))!.status, 'rejected');

    await prisma.drafts.update({ where: { id: f.draft.id }, data: { status: 'published' } });
    const pub = await t.preview({ id: f.draft.id, status: 'pending_review' }, ctx);
    assert.match(pub.problem, /already published/);
    await assert.rejects(t.run({ id: f.draft.id, status: 'pending_review' }, ctx), /already published/);
  } finally {
    await f.cleanup();
  }
});

test('generate_blog_draft in Testing mode: the keyword is claimed and its AI step waits in the Claude Code queue', { skip: !db, timeout: 90000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const g = globalThis as any;
  const kw = await prisma.keywords.create({ data: { keyword: `zz assistant queue test ${stamp()}`, status: 'pending', batch_name: 'Assistant test' } });
  const before = await prisma.ai_jobs.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  g.__AI_MODE_PIN = 'testing';
  try {
    const t = getTool('generate_blog_draft');
    const p = await t.preview({ keyword_id: kw.id }, { me: ANALYST });
    assert.match(p.target, /zz assistant queue test/);
    assert.match(p.warning, /Testing mode is on/);
    const r: any = await t.run({ keyword_id: kw.id }, { me: ANALYST });
    assert.equal(r.result.started, true);
    assert.match(r.result.note, /Claude Code queue/);
    assert.equal((await prisma.keywords.findUnique({ where: { id: kw.id } }))!.status, 'generating');
    // A second start of the same keyword is refused, as on the page.
    await assert.rejects(t.run({ keyword_id: kw.id }, { me: ANALYST }), /already being generated/);

    let job: any = null;
    for (let i = 0; i < 120 && !job; i++) {
      job = await prisma.ai_jobs.findFirst({ where: { id: { gt: before?.id || 0 }, status: 'waiting', messages: { contains: kw.keyword } } });
      if (!job) await new Promise((res) => setTimeout(res, 500));
    }
    assert.ok(job, 'the AI request waits in the Claude Code queue');

    const stop: any = await getTool('stop_generation').run({ keyword_id: kw.id }, { me: ANALYST });
    assert.equal(stop.result.stopped, 1);
    for (let i = 0; i < 40; i++) {
      if ((await prisma.ai_jobs.findUnique({ where: { id: job.id } }))!.status === 'cancelled') break;
      await new Promise((res) => setTimeout(res, 500));
    }
    assert.equal((await prisma.ai_jobs.findUnique({ where: { id: job.id } }))!.status, 'cancelled', 'Stop cancels the waiting job');
    assert.deepEqual(outside.filter((u) => /anthropic/.test(u)), [], 'the Anthropic API was not called');
  } finally {
    g.__AI_MODE_PIN = 'live';
    await new Promise((res) => setTimeout(res, 1500));
    await prisma.ai_jobs.deleteMany({ where: { id: { gt: before?.id || 0 }, messages: { contains: kw.keyword } } });
    await prisma.drafts.deleteMany({ where: { keyword_id: kw.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

test('site content: saving and deleting need website.change; an allowed save stores it and tells the website', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const { proposeTools } = await import('../lib/assistant/engine');
  const slug = `/blog/assistant-test-${stamp()}`;
  const item = { slug, title: 'Assistant test post', status: 'draft', html: '<p>Hello</p>' };
  try {
    // A person with content work only (a user given content.work alone would be the same): refused.
    for (const name of ['site_content_save', 'site_content_delete']) {
      const input = name === 'site_content_save' ? { type: 'post', item, create: true } : { slug };
      const r = await proposeTools({ id: 0 }, [{ id: 'a', name, input }], () => {}, USER);
      assert.equal(r.actions.length, 0, name);
      assert.match(r.readResults[0].content, /cannot approve changes to the website/, name);
    }
    const save = getTool('site_content_save');
    const p = await save.preview({ type: 'post', item, create: true }, { me: ADMIN });
    assert.equal(p.problem, null);
    assert.match(p.warning, /live website/);
    const r: any = await save.run({ type: 'post', item, create: true }, { me: ADMIN });
    assert.equal(r.result.ok, true);
    assert.equal(r.result.webhook.sent, false, 'no webhook set up in the test');
    const row = await prisma.site_content.findUnique({ where: { slug } });
    assert.equal(row?.title, 'Assistant test post');
    assert.equal(row?.updated_by, ADMIN.email);
    // create never overwrites
    await assert.rejects(save.run({ type: 'post', item, create: true }, { me: ADMIN }), /already exists/);
    await getTool('site_content_delete').run({ slug }, { me: ADMIN });
    assert.equal(await prisma.site_content.findUnique({ where: { slug } }), null);
  } finally {
    await prisma.site_content.deleteMany({ where: { slug } });
  }
});

test('manual_task_update: assigning needs manual.assign; a user works only on tasks assigned to them', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const { proposeTools } = await import('../lib/assistant/engine');
  const r = await proposeTools({ id: 0 }, [{ id: 'a', name: 'manual_task_update', input: { kind: 'backlink', id: 1, action: 'assign', email: USER.email } }], () => {}, USER);
  assert.equal(r.actions.length, 0);
  assert.match(r.readResults[0].content, /Only an admin or a manager can assign tasks/);
  const s = await prisma.seo_strategies.create({ data: { period: `test ${stamp()}`, status: 'draft' } });
  const task = await prisma.backlink_tasks.create({ data: { strategy_id: s.id, method: 'Guest post', target_site: 'example.org', our_page: '/', send_date: '2026-11-20', tags: '[]', status: 'planned', assigned_to: 'someone@test.local' } });
  try {
    await assert.rejects(getTool('backlink_task_status').run({ id: task.id, status: 'done' }, { me: USER }), /not assigned to you/);
    const done: any = await getTool('backlink_task_status').run({ id: task.id, status: 'done' }, { me: ANALYST });
    assert.equal(done.result.status, 'done');
  } finally {
    await prisma.backlink_tasks.deleteMany({ where: { id: task.id } });
    await prisma.seo_strategies.deleteMany({ where: { id: s.id } });
  }
});

test('generate_blog_draft with a chosen keyword takes only a pending or failed one, never a written or calendar blog', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const { claimKeywordForGeneration } = await import('../lib/generateActions');
  const s = stamp();
  const drafted = await prisma.keywords.create({ data: { keyword: `zz drafted ${s}`, status: 'drafted', batch_name: 'Assistant test' } });
  const calendar = await prisma.keywords.create({ data: { keyword: `zz calendar ${s}`, status: 'pending', batch_name: 'Strategy #999999' } });
  const failed = await prisma.keywords.create({ data: { keyword: `zz failed ${s}`, status: 'failed', batch_name: 'Assistant test' } });
  try {
    const t = getTool('generate_blog_draft');
    assert.match((await t.preview({ keyword_id: drafted.id }, { me: ANALYST })).problem, /already written/);
    assert.match((await t.preview({ keyword_id: calendar.id }, { me: ANALYST })).problem, /Monthly Strategy calendar/);
    assert.equal((await t.preview({ keyword_id: failed.id }, { me: ANALYST })).problem, null);
    for (const k of [drafted, calendar]) {
      const r: any = await claimKeywordForGeneration(k.id);
      assert.equal(r.error.status, 409);
      assert.equal((await prisma.keywords.findUnique({ where: { id: k.id } })).status, k.status, 'not claimed');
    }
    await assert.rejects(t.run({ keyword_id: drafted.id }, { me: ANALYST }), /already written/);
    const ok: any = await claimKeywordForGeneration(failed.id);
    assert.equal(ok.keyword.id, failed.id);
    assert.equal((await prisma.keywords.findUnique({ where: { id: failed.id } })).status, 'generating');
  } finally {
    await prisma.keywords.deleteMany({ where: { id: { in: [drafted.id, calendar.id, failed.id] } } });
  }
});

test('in Testing mode a tool that waits for AI runs in the background and the card returns at once', async () => {
  const { runOrQueue } = await tab();
  const g = globalThis as any;
  let finished = false;
  let release: () => void = () => {};
  const work = () => new Promise<any>((res) => (release = () => res({ result: { done: true } }))).then((r) => ((finished = true), r));
  g.__AI_MODE_PIN = 'testing';
  try {
    const r: any = await runOrQueue({ me: ANALYST }, 'Check again: draft #1', 'Drafts & Review', work);
    assert.equal(r.result.started, true);
    assert.match(r.result.note, /Claude Code queue.*Drafts & Review/);
    assert.equal(finished, false, 'returned before the work finished');
    release();
  } finally {
    g.__AI_MODE_PIN = 'live';
  }
  const live: any = await runOrQueue({ me: ANALYST }, 'x', 'y', async () => ({ result: { done: true } }));
  assert.deepEqual(live, { result: { done: true } }, 'Live mode: runs here and returns its result');
  // The tools that wait for AI answers go through it.
  const { getTool } = await tools();
  for (const n of ['draft_recheck', 'draft_fix_issues', 'generate_writing_skill', 'strategy_refresh', 'manual_task_guide', 'topic_action', 'performance_explain', 'calendar_publish_now', 'post_my_blog']) {
    assert.match(getTool(n).run.toString(), /runOrQueue/, n);
  }
});

test('a conversation stuck in "running" (restart, a step that never came back) is put back to idle after 15 minutes', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { loadConversation } = await import('../lib/assistant/engine');
  const old = new Date(Date.now() - 20 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const recent = new Date(Date.now() - 2 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const messages = JSON.stringify([{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'list_calendar', input: {} }] }]);
  const stuck = await prisma.assistant_conversations.create({ data: { title: `stuck ${stamp()}`, status: 'running', messages, updated_at: old } });
  const busy = await prisma.assistant_conversations.create({ data: { title: `busy ${stamp()}`, status: 'running', messages, updated_at: recent } });
  try {
    const c = await loadConversation(stuck.id);
    assert.equal(c.status, 'idle');
    const last = c.messages[c.messages.length - 1];
    assert.equal(last.content[0].tool_use_id, 'tu_x', 'the unanswered tool call is answered');
    assert.equal((await prisma.assistant_conversations.findUnique({ where: { id: stuck.id } })).status, 'idle');
    assert.equal((await loadConversation(busy.id)).status, 'running', 'a recent run is left alone');
  } finally {
    await prisma.assistant_conversations.deleteMany({ where: { id: { in: [stuck.id, busy.id] } } });
  }
});

test('keyword_research and serp_top_results are paid, so they wait for the card', async () => {
  const { getTool, toolNeeds } = await tools();
  for (const n of ['keyword_research', 'serp_top_results']) {
    assert.equal(getTool(n).kind, 'write', n);
    assert.match((await getTool(n).preview({ keyword: 'itin' })).warning, /SE Ranking|SerpHouse/, n);
    assert.deepEqual(toolNeeds(n, {}), ['reports.view'], n);
  }
});

test('training_status never shows the assistant an open test', { skip: !db, timeout: 30000 }, async () => {
  const prisma: any = (await import('../lib/prisma')).default;
  const { getTool } = await tools();
  const email = `assoc-${stamp()}@test.local`;
  await prisma.training_profiles.create({ data: { email, name: 'Assoc Test' } });
  const qs = JSON.stringify([{ id: 'q1', q: 'What is an ITIN?', options: ['A tax number', 'A visa'], answer: 0, explain: 'IRS number' }]);
  await prisma.training_tests.create({ data: { email, day: '2026-11-14', level: 1, questions: qs, total: 1, status: 'open' } });
  try {
    const mine: any = await getTool('training_status').run({}, { me: { email, name: 'Assoc Test', role: 'user', blocked: false } });
    assert.equal(mine.me.test.open, true);
    assert.equal(mine.me.test.questions, undefined);
    assert.doesNotMatch(JSON.stringify(mine), /What is an ITIN|A tax number/);
    const viewer: any = await getTool('training_status').run({ person: email }, { me: ADMIN });
    assert.doesNotMatch(JSON.stringify(viewer), /What is an ITIN|A tax number/);
  } finally {
    await prisma.training_tests.deleteMany({ where: { email } });
    await prisma.training_profiles.deleteMany({ where: { email } });
  }
});
