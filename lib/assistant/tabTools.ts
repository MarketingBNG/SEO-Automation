// The assistant's tools for the work the dashboard's tabs do, tab by tab. Every tool calls the same
// lib function the tab's route calls, so the assistant runs the same checks, spends the same credits
// and writes the same activity log. Read tools run at once; write tools (anything that changes data,
// spends money or reaches the website) wait for the person's approval card. Each tool names the
// permission it needs ("needs"), checked for the person who sees the card and again for the person
// who approves it (lib/assistant/engine.ts).
//
// Testing mode and Pause work as on the tabs: the lib functions send their AI steps to the Claude Code
// queue in Testing mode and stop while AI work is paused. The previews say which applies.
import prismaClient from '@/lib/prisma';
import * as settings from '@/lib/settings';
import type { Action } from '@/lib/permissions';

// Untyped on purpose: these are small lookups for previews, and the Prisma types of ~40 more queries
// cost the type check (which runs near the default heap limit) more than they are worth here.
const prisma: any = prismaClient;

type Ctx = { me?: any; emit?: (e: any) => void; conversationId?: number };
type Result = { status: number; body: any };

// Who did it, in the activity log: the person who approved the card, through the assistant.
export const actorOf = (ctx?: Ctx) => (ctx?.me?.name || ctx?.me?.email ? `${ctx.me.name || ctx.me.email} (assistant)` : 'Assistant');

// A route-style { status, body } answer: the body on success, the route's error as the tool error.
function ok(r: Result) {
  if (r.status < 400) return r.body;
  const b = r.body || {};
  const extra = [
    b.reviewers?.length ? `Known CA/CPA reviewers: ${b.reviewers.join('; ')}.` : '',
    b.suggestions?.length ? `Suggested times (UTC): ${b.suggestions.map((s: any) => `${s.at} (${s.label})`).join('; ')}.` : '',
    b.hold_reasons?.length ? `Hold reasons: ${b.hold_reasons.join(' ')}` : '',
  ].filter(Boolean);
  throw new Error([b.error || `Refused (${r.status}).`, ...extra].join(' '));
}

const words = (html: string | null | undefined) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const short = (s: unknown, n = 120) => {
  const t = String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const parse = (s: string | null | undefined, fallback: any) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

// What a paid step costs and whether it will run now, for the approval card.
// resumes: work that waits while AI is paused and carries on by itself after Resume (blog writing,
// strategy generation); everything else fails at its first AI step and has to be started again.
export async function costNote(what: string, { resumes = false }: { resumes?: boolean } = {}): Promise<string> {
  const { aiMode } = await import('@/lib/aiQueue');
  const mode = await aiMode().catch(() => 'live');
  const paused = (await settings.get('ai_paused').catch(() => null)) === '1';
  if (mode === 'testing') return `${what} Testing mode is on: its AI steps wait in the Claude Code queue (no API credits) until Claude Code answers them ("run the SEO AI queue").`;
  if (paused) {
    return resumes
      ? `${what} AI work is paused (Settings > AI credits): it waits at its first AI step and carries on by itself after someone presses Resume.`
      : `${what} AI work is paused (Settings > AI credits), so this fails now; try again after someone presses Resume.`;
  }
  return what;
}

// A step that waits for AI answers. In Testing mode those answers come from the Claude Code queue,
// which can take any time, so the step runs in the background and the card returns at once (the
// chat would otherwise stay busy until Claude Code answers). Its outcome is saved where the tab
// shows it; a failure goes to the activity log. In Live mode it runs here and returns its result.
export async function runOrQueue(ctx: Ctx | undefined, label: string, where: string, fn: () => Promise<any>): Promise<any> {
  const { aiMode } = await import('@/lib/aiQueue');
  if ((await aiMode()) !== 'testing') return fn();
  const activity = await import('@/lib/activity');
  const actor = actorOf(ctx);
  void fn().catch((e: any) => activity.log('assistant.background_failed', { details: `${label}: ${String(e?.message || e).slice(0, 300)}`, actor }).catch(() => {}));
  return { result: { started: true, note: `Testing mode: "${label}" runs in the background and its AI steps wait in the Claude Code queue. When Claude Code has answered, see the result in ${where}.` } };
}

const AI = 'Uses AI credits.';
const int = { type: 'integer' };
const str = { type: 'string' };
const obj = (properties: any, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS: any[] = [];
function tool(t: any) {
  TOOLS.push({ risk: 'low', ...t });
}

async function scheduleRow(id: number) {
  const row = await prisma.blog_schedule.findUnique({ where: { id } });
  if (!row) throw new Error(`Calendar blog ${id} not found. Find it with list_calendar.`);
  return row;
}
async function draftRow(id: number) {
  const d = await prisma.drafts.findUnique({ where: { id } });
  if (!d) throw new Error(`Draft ${id} not found. Find it with list_drafts.`);
  return d;
}
async function latestStrategyId(): Promise<number> {
  const s =
    (await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' }, select: { id: true } })) ||
    (await prisma.seo_strategies.findFirst({ where: { plan_json: { not: null } }, orderBy: { id: 'desc' }, select: { id: true } }));
  if (!s) throw new Error('There is no strategy yet.');
  return s.id;
}

// =============================================================================================
// Home / Blog Calendar
// =============================================================================================

tool({
  name: 'list_calendar',
  kind: 'read',
  description:
    'The Blog Calendar (Home and Monthly Strategy): every blog of the approved month with its id, title, keyword, status (planned, drafting, in_review, held, rejected, paused, published), publish time (UTC), draft id, hold reasons, whether it needs a CA/CPA reviewer, and when it auto-approves. Use the id with calendar_decide or calendar_publish_now.',
  input_schema: obj({ status: str, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  summarize: (i) => `Read the blog calendar${i.status ? ` (${i.status})` : ''}`,
  run: async (i) => {
    const { calendarView } = await import('@/lib/strategy/calendarRows');
    const v: any = await calendarView();
    const rows = (v.rows || []).filter((r: any) => !i.status || r.status === i.status).slice(0, i.limit || 100);
    return {
      strategy_id: v.strategyId,
      reviewers: v.reviewers || [],
      rows: rows.map((r: any) => ({
        id: r.id, title: r.title, main_keyword: r.main_keyword, status: r.status, publish_at: r.publish_at, draft_id: r.draft_id, author: r.author,
        reviewed_by: r.reviewed_by, expert_reviewer: r.expert_reviewer, needs_expert: r.needs_expert, overdue: r.overdue, hold_reasons: r.hold_reasons,
        auto_publish_at: r.auto_publish_at, publish_plan: r.publish_plan, wp_post_url: r.wp_post_url, reject_feedback: r.reject_feedback, paused_from: r.paused_from,
      })),
    };
  },
});

tool({
  name: 'calendar_suggest_times',
  kind: 'read',
  description: 'Suggested new publish times (UTC) for one calendar blog, and the earliest time its writing and 48-hour review allow. Use before calendar_decide with action "reschedule".',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Suggest publish times for calendar blog #${i.id}`,
  run: async (i) => ok(await (await import('@/lib/strategy/scheduleActions')).scheduleSuggestions(i.id)),
});

tool({
  name: 'calendar_decide',
  kind: 'write',
  needs: 'manual.do',
  riskFor: (i) => (i.action === 'reject' ? 'medium' : 'low'),
  description:
    'Decide on a calendar blog, as the Blog Calendar buttons do: "approve" (it publishes at its slot; tax, legal and compliance blogs need reviewer as "Name, credential", e.g. "Akshay Nahar, CA"), "reject" with feedback (at least a sentence; the blog is rewritten with it, which uses AI credits, and comes back for review), "pause", "resume" (needs a new time if its slot has passed), or "reschedule" with publish_at (UTC "YYYY-MM-DD HH:MM:SS" or ISO, at least 30 minutes ahead). Publishing straight away is calendar_publish_now.',
  input_schema: obj({ id: int, action: { type: 'string', enum: ['approve', 'reject', 'pause', 'resume', 'reschedule'] }, reviewer: str, feedback: str, publish_at: str }, ['id', 'action']),
  summarize: (i) => `${{ approve: 'Approve', reject: 'Reject', pause: 'Pause', resume: 'Resume', reschedule: 'Reschedule' }[i.action] || i.action} calendar blog #${i.id}${i.action === 'reschedule' && i.publish_at ? ` to ${i.publish_at} UTC` : ''}`,
  preview: async (i) => {
    const row = await scheduleRow(i.id);
    return {
      target: `Calendar blog #${row.id}: ${row.title} (${row.status}, publishes ${row.publish_at} UTC)`,
      action: i.action,
      reviewer: i.reviewer || null,
      feedback: i.feedback || null,
      new_time: i.publish_at || null,
      warning: i.action === 'reject' ? await costNote('The rewrite with this feedback uses AI credits.') : i.action === 'approve' ? 'The blog then publishes at its slot on the website.' : null,
      problem: i.action === 'reject' && String(i.feedback || '').trim().length < 10 ? 'Give the feedback (at least a sentence).' : i.action === 'reschedule' && !i.publish_at ? 'Give publish_at.' : null,
    };
  },
  run: async (i, ctx) => {
    const { decideSchedule } = await import('@/lib/strategy/scheduleActions');
    const body = ok(await decideSchedule(i.id, { action: i.action, reviewer: i.reviewer, feedback: i.feedback, publishAt: i.publish_at }, { me: ctx?.me || null, actor: actorOf(ctx) }));
    return { result: { id: i.id, status: body.status, publish_at: body.publish_at, note: body.note || null } };
  },
});

tool({
  name: 'calendar_publish_now',
  kind: 'write',
  needs: 'blog.publish_now',
  risk: 'high',
  description:
    'Put a calendar blog live on the website straight away, skipping its slot ("publish_now", the same publish step and checks as the Publish now button), or mark it as already published outside the dashboard ("mark_done", with the live url if there is one), so nothing tries it again. Admin or manager (blog.publish_now).',
  input_schema: obj({ id: int, action: { type: 'string', enum: ['publish_now', 'mark_done'] }, url: str }, ['id', 'action']),
  summarize: (i) => (i.action === 'mark_done' ? `Mark calendar blog #${i.id} as already published` : `Publish calendar blog #${i.id} on the website now`),
  preview: async (i) => {
    const row = await scheduleRow(i.id);
    return {
      target: `Calendar blog #${row.id}: ${row.title} (${row.status}, slot ${row.publish_at} UTC)`,
      warning: i.action === 'publish_now' ? 'This goes live on the website now (the checks before publishing still run, and may hold it).' : 'The blog is marked published; the dashboard will not publish it.',
      url: i.url || null,
      problem: i.action === 'publish_now' && !row.draft_id ? 'This blog has no draft yet.' : null,
    };
  },
  run: async (i, ctx) => {
    ctx?.emit?.({ type: 'tool_progress', text: i.action === 'publish_now' ? 'Publishing (checks first, a minute or two)…' : 'Marking as done…' });
    const { decideSchedule } = await import('@/lib/strategy/scheduleActions');
    const go = async () => {
      const body = ok(await decideSchedule(i.id, { action: i.action, url: i.url }, { me: ctx?.me || null, actor: actorOf(ctx) }));
      return { result: { id: i.id, result: body.result || body.status, url: body.url || body.wp_post_url || null } };
    };
    // Publishing runs the fact check first (AI); marking done does not.
    return i.action === 'publish_now' ? runOrQueue(ctx, `Publish calendar blog #${i.id} now`, 'the Blog Calendar', go) : go();
  },
});

// =============================================================================================
// Monthly Strategy
// =============================================================================================

tool({
  name: 'get_strategy_detail',
  kind: 'read',
  description: 'One monthly strategy in full, as the Monthly Strategy page shows it: its 11 sections (plan), validation, approval blockers, edits and logged changes. Without id: the approved one, else the newest.',
  input_schema: obj({ id: int }),
  summarize: (i) => `Read strategy ${i.id ? `#${i.id}` : '(current)'}`,
  run: async (i) => {
    const id = i.id || (await latestStrategyId());
    const row = await prisma.seo_strategies.findUnique({ where: { id } });
    if (!row?.plan_json) throw new Error(`Strategy ${id} has no plan (it may still be generating; see strategy_progress).`);
    const { strategyView } = await import('@/lib/strategy/service');
    return strategyView(row);
  },
});

tool({
  name: 'strategy_progress',
  kind: 'read',
  description: 'How far a strategy has got (blogs written, in review, published; backlinks; fixes) and the estimated AI cost for its 30 days. Also lists strategies being generated.',
  input_schema: obj({ id: int }),
  summarize: (i) => `Read strategy progress${i.id ? ` #${i.id}` : ''}`,
  run: async (i) => {
    const { strategyProgress } = await import('@/lib/strategy/progress');
    const running = await prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'paused', 'stopping'] } }, select: { id: true, status: true, progress_stage: true, progress_percent: true, error: true } });
    const id = i.id || (await latestStrategyId().catch(() => 0));
    return { progress: id ? await strategyProgress(id) : null, generating: running };
  },
});

tool({
  name: 'strategy_generate',
  kind: 'write',
  needs: 'strategy.edit',
  risk: 'medium',
  description: 'Generate a new monthly strategy for the 30 days from today (Monthly Strategy > Generate). Runs in the background for a long time and spends AI credits, SE Ranking units and SerpHouse searches. Check strategy_progress first so a second one is not started.',
  input_schema: obj({}),
  summarize: () => 'Generate a new monthly strategy',
  preview: async () => {
    const running = await prisma.seo_strategies.count({ where: { status: { in: ['generating', 'paused', 'stopping'] } } });
    return { warning: await costNote('Uses AI credits, SE Ranking units and SerpHouse searches; takes a long time.', { resumes: true }), problem: running ? 'A strategy is already being generated.' : null };
  },
  run: async (_i, ctx) => {
    const { startStrategyJob } = await import('@/lib/strategy/jobs');
    return { result: await startStrategyJob({ actor: actorOf(ctx) }) };
  },
});

tool({
  name: 'strategy_control',
  kind: 'write',
  needs: 'strategy.edit',
  description: 'Pause, resume or stop a strategy that is being generated (Monthly Strategy controls). Finished steps are kept on resume.',
  input_schema: obj({ id: int, action: { type: 'string', enum: ['pause', 'resume', 'stop'] } }, ['id', 'action']),
  summarize: (i) => `${i.action[0].toUpperCase()}${i.action.slice(1)} the generation of strategy #${i.id}`,
  preview: async (i) => ({ warning: i.action === 'resume' ? await costNote('Resuming spends AI credits again.', { resumes: true }) : null }),
  run: async (i, ctx) => {
    const { controlStrategyJob } = await import('@/lib/strategy/jobs');
    return { result: await controlStrategyJob(i.id, i.action, actorOf(ctx)) };
  },
});

const SECTIONS = ['summary', 'included', 'keywords', 'blogPlan', 'aeoGeo', 'backlinks', 'technical', 'targets', 'directories'];
tool({
  name: 'strategy_edit_section',
  kind: 'write',
  needs: 'strategy.edit',
  riskFor: () => 'medium',
  description:
    'Edit one section of a strategy (Edit Strategy): summary, included, keywords, blogPlan, aeoGeo, backlinks, technical, targets or directories. value is the WHOLE new section in the same JSON shape get_strategy_detail returns for it (read it first and change only what the user asked). An approved strategy needs "why"; editing blogPlan or backlinks of an approved strategy also updates the calendar and the outreach list. Every save is versioned and re-validated.',
  input_schema: obj({ id: int, section: { type: 'string', enum: SECTIONS }, value: { description: 'The whole new section (JSON).' }, why: str }, ['id', 'section', 'value']),
  summarize: (i) => `Edit the "${i.section}" section of strategy #${i.id}`,
  preview: async (i) => {
    const row = await prisma.seo_strategies.findUnique({ where: { id: i.id }, select: { status: true, plan_json: true, period: true } });
    if (!row?.plan_json) return { problem: 'Strategy not found.' };
    const before = parse(row.plan_json, {})[i.section];
    return {
      target: `Strategy #${i.id} (${row.period}, ${row.status})`,
      changes: [{ field: i.section, before: short(JSON.stringify(before ?? null), 600), after: short(JSON.stringify(i.value ?? null), 600) }],
      problem: row.status === 'approved' && !String(i.why || '').trim() ? 'This strategy is approved: say why it changes (why).' : null,
      warning: row.status === 'approved' && ['blogPlan', 'backlinks'].includes(i.section) ? 'The approved calendar or outreach list changes with it.' : null,
    };
  },
  run: async (i, ctx) => {
    const { editSection } = await import('@/lib/strategy/service');
    const r: any = await editSection(i.id, i.section, i.value, actorOf(ctx), i.why);
    return { result: { id: i.id, section: i.section, version: r?.version ?? null, validation: r?.validation ?? null } };
  },
});

tool({
  name: 'strategy_refresh',
  kind: 'write',
  needs: 'strategy.edit',
  risk: 'medium',
  description: 'Bring a strategy up to date with new dashboard features and new data without rebuilding it (Monthly Strategy > Update with the latest). Spends AI credits and SE Ranking / SerpHouse lookups.',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Update strategy #${i.id} with the latest data`,
  preview: async () => ({ warning: await costNote('Uses AI credits and SE Ranking / SerpHouse lookups.') }),
  run: async (i, ctx) => {
    ctx?.emit?.({ type: 'tool_progress', text: 'Updating the strategy (a few minutes)…' });
    const { refreshStrategy } = await import('@/lib/strategy/refresh');
    const { timed } = await import('@/lib/jobTimer');
    return runOrQueue(ctx, `Update strategy #${i.id}`, 'Monthly Strategy', async () => ({ result: await timed(`refresh-${i.id}`, 'refresh', 'Updating the strategy with the latest changes', () => refreshStrategy(i.id, actorOf(ctx))) }));
  },
});

tool({
  name: 'strategy_log_change',
  kind: 'write',
  needs: 'strategy.edit',
  description: 'Record a mid-month "Strategy change" (what changed and why) on a strategy, approved by the person who approves this card.',
  input_schema: obj({ id: int, what: str, why: str }, ['id', 'what', 'why']),
  summarize: (i) => `Log a strategy change on #${i.id}: ${short(i.what, 60)}`,
  run: async (i, ctx) => {
    const { logStrategyChange } = await import('@/lib/strategy/service');
    return { result: await logStrategyChange(i.id, { what: i.what, why: i.why }, actorOf(ctx)) };
  },
});

tool({
  name: 'list_manual_tasks',
  kind: 'read',
  description: 'The strategy\'s manual tasks a person does (backlink outreach and technical fixes): kind, id, title, detail, date, done, who it is assigned to, and any guide already written. A user sees only the tasks assigned to them.',
  input_schema: obj({ strategy_id: int }),
  summarize: () => 'List manual tasks',
  run: async (i, ctx) => {
    const { listManualTasks } = await import('@/lib/strategy/manual');
    const tasks = await listManualTasks(i.strategy_id || (await latestStrategyId()));
    const me = ctx?.me;
    return (me?.role === 'user' || !me ? tasks.filter((t) => t.assignedTo === me?.email) : tasks).map((t) => ({ ...t, guide: t.guide ? '(written; ask to see it)' : null }));
  },
});

tool({
  name: 'manual_task_guide',
  kind: 'write',
  needs: 'manual.do',
  description: 'Write (or show, if already written) the step-by-step guide for a manual task. Writing a new one (or regenerate: true) uses AI credits.',
  input_schema: obj({ kind: { type: 'string', enum: ['backlink', 'fix'] }, id: int, regenerate: { type: 'boolean' } }, ['kind', 'id']),
  summarize: (i) => `${i.regenerate ? 'Rewrite' : 'Get'} the guide for ${i.kind} task #${i.id}`,
  preview: async () => ({ warning: await costNote('A new guide uses AI credits.') }),
  run: async (i, ctx) => {
    const { manualTaskAction } = await import('@/lib/strategy/manualActions');
    return runOrQueue(ctx, `Guide for ${i.kind} task #${i.id}`, 'the task on Monthly Strategy', async () => ({ result: ok(await manualTaskAction({ kind: i.kind, id: i.id, action: 'guide', regenerate: i.regenerate }, ctx?.me || null)) }));
  },
});

tool({
  name: 'manual_task_update',
  kind: 'write',
  needs: (i) => (i.action === 'assign' ? 'manual.assign' : 'manual.do'),
  description: 'Tick a manual task done ("done"), undo that ("undo"), or assign it to a team member by email ("assign", admin or manager; email empty to unassign). A user can only work on tasks assigned to them.',
  input_schema: obj({ kind: { type: 'string', enum: ['backlink', 'fix'] }, id: int, action: { type: 'string', enum: ['done', 'undo', 'assign'] }, email: str }, ['kind', 'id', 'action']),
  summarize: (i) => (i.action === 'assign' ? `Assign ${i.kind} task #${i.id} to ${i.email || 'nobody'}` : `Mark ${i.kind} task #${i.id} ${i.action === 'done' ? 'done' : 'not done'}`),
  run: async (i, ctx) => {
    const { manualTaskAction } = await import('@/lib/strategy/manualActions');
    return { result: ok(await manualTaskAction({ kind: i.kind, id: i.id, action: i.action, email: i.email }, ctx?.me || null)) };
  },
});

tool({
  name: 'backlink_task_status',
  kind: 'write',
  needs: 'manual.do',
  description: 'Set a backlink outreach task (backlink_tasks id) to "done" or back to "planned".',
  input_schema: obj({ id: int, status: { type: 'string', enum: ['done', 'planned'] } }, ['id', 'status']),
  summarize: (i) => `Set backlink task #${i.id} to ${i.status}`,
  run: async (i, ctx) => {
    const { setBacklinkStatus } = await import('@/lib/strategy/manualActions');
    const row = ok(await setBacklinkStatus(i.id, i.status, { me: ctx?.me || null, actor: actorOf(ctx) }));
    return { result: { id: row.id, status: row.status } };
  },
});

// =============================================================================================
// Topics & News
// =============================================================================================

tool({
  name: 'list_topics',
  kind: 'read',
  needs: 'content.work',
  description: "Topics & News: today's researched topics (news from the last 24 hours and evergreen) with why they matter, relevance verdict, keywords, sources, and any blog, article or audit started from them.",
  input_schema: obj({}),
  summarize: () => 'Read Topics & News',
  run: async () => {
    const { topicsView } = await import('@/lib/topicsView');
    const v: any = await topicsView();
    return { ...v, topics: v.topics.map((t: any) => ({ id: t.id, day: t.day, title: t.title, why: t.why, kind: t.kind, pillar: t.pillar, status: t.status, relevance: t.relevance, keywords: t.keywords, sources: t.sources, draft: t.draft, article: t.article, audit: t.audit ? { id: t.audit.id, verdict: t.audit.verdict, rewrite_status: t.audit.rewrite_status } : null })) };
  },
});

tool({
  name: 'topics_research',
  kind: 'write',
  needs: 'content.work',
  description: "Run today's topic research again now (Topics & News > Research now). Runs in the background; uses AI credits with web search.",
  input_schema: obj({}),
  summarize: () => 'Research topics now',
  preview: async () => ({ warning: await costNote(`${AI} Takes a few minutes; read the result with list_topics.`) }),
  run: async () => {
    const { researchTopics } = await import('@/lib/topics');
    void researchTopics(new Date(), { force: true }).catch(() => {});
    return { result: { started: true } };
  },
});

tool({
  name: 'topic_action',
  kind: 'write',
  needs: 'content.work',
  riskFor: (i) => (['blog', 'article'].includes(i.action) ? 'medium' : 'low'),
  description:
    'Act on a topic (Topics & News): "blog" writes a full blog draft from it (research and fact check), "article" writes a LinkedIn article, "relevance" explains why it matters to us, "compare" compares a hand-written piece already uploaded on the page with the research, "finalize" makes the finalized version with optional comments. All use AI credits. Uploading a hand-written .docx stays on the page.',
  input_schema: obj({ id: int, action: { type: 'string', enum: ['blog', 'article', 'relevance', 'compare', 'finalize'] }, comments: str }, ['id', 'action']),
  summarize: (i) => `Topic #${i.id}: ${{ blog: 'write a blog', article: 'write a LinkedIn article', relevance: 'explain relevance', compare: 'compare the uploaded piece', finalize: 'make the finalized version' }[i.action]}`,
  preview: async (i) => {
    const t = await prisma.topics.findUnique({ where: { id: i.id }, select: { title: true, status: true } });
    return { target: t ? `Topic #${i.id}: ${t.title} (${t.status})` : null, warning: await costNote(AI), problem: t ? null : 'Topic not found.' };
  },
  run: async (i, ctx) => {
    const { topicAction } = await import('@/lib/topicsView');
    const go = async () => ({ result: ok(await topicAction(i.id, i.action, String(i.comments || ''), actorOf(ctx))) });
    // relevance and compare wait for their AI answer; blog, article and finalize start in the background.
    return ['relevance', 'compare'].includes(i.action) ? runOrQueue(ctx, `Topic #${i.id}: ${i.action}`, 'Topics & News', go) : go();
  },
});

// =============================================================================================
// Write a blog
// =============================================================================================

tool({
  name: 'generate_blog_draft',
  kind: 'write',
  needs: 'content.work',
  risk: 'medium',
  description:
    'Write a blog draft (Write a blog > Generate next blog draft): the next pending keyword, or keyword_id from list_keywords. Researches (SerpHouse, SE Ranking, Surfer), writes and fact checks, which uses AI credits and paid lookups; takes several minutes and runs in the background. The draft appears in Drafts & Review; stop it with stop_generation. Calendar blogs are written by their schedule, not here.',
  input_schema: obj({ keyword_id: int }),
  summarize: (i) => (i.keyword_id ? `Write a blog draft for keyword #${i.keyword_id}` : 'Write the next blog draft in the queue'),
  preview: async (i) => {
    const { generationRefusal } = await import('@/lib/generateActions');
    const k = i.keyword_id
      ? await prisma.keywords.findUnique({ where: { id: i.keyword_id } })
      : await prisma.keywords.findFirst({ where: { status: 'pending', OR: [{ batch_name: null }, { NOT: { batch_name: { startsWith: 'Strategy #' } } }] }, orderBy: { id: 'asc' } });
    return {
      target: k ? `Keyword #${k.id}: "${k.keyword}" (${k.status})` : null,
      warning: await costNote('Uses AI credits, SerpHouse searches, SE Ranking units and Surfer; several minutes.', { resumes: true }),
      problem: !k ? 'No pending keyword found.' : generationRefusal(k),
    };
  },
  run: async (i) => {
    const { claimKeywordForGeneration } = await import('@/lib/generateActions');
    const claimed = await claimKeywordForGeneration(i.keyword_id);
    if ('error' in claimed) ok(claimed.error);
    const keyword = (claimed as any).keyword;
    // The run belongs to the server, as from the Write a blog page: only stop_generation (or Stop) ends it.
    const { runBlogJob } = await import('@/lib/blogJob');
    void runBlogJob(keyword, new AbortController()).catch((e) => console.error('Blog generation failed:', e?.message || e));
    const { aiMode } = await import('@/lib/aiQueue');
    const testing = (await aiMode()) === 'testing';
    return { result: { started: true, keyword_id: keyword.id, keyword: keyword.keyword, note: testing ? 'Testing mode: its AI steps wait in the Claude Code queue until Claude Code answers them.' : 'Writing in the background; the draft appears in Drafts & Review when done.' } };
  },
});

tool({
  name: 'stop_generation',
  kind: 'write',
  needs: 'content.work',
  description: 'Stop one blog being written (keyword id from list_keywords, status generating). Other blogs keep going.',
  input_schema: obj({ keyword_id: int }, ['keyword_id']),
  summarize: (i) => `Stop writing the blog for keyword #${i.keyword_id}`,
  run: async (i, ctx) => {
    const { stopGeneration } = await import('@/lib/generateActions');
    const body = ok(await stopGeneration(i.keyword_id, actorOf(ctx)));
    return { result: { stopped: body.stopped, note: body.stopped ? 'Stop sent; the run saves what it has and stops.' : 'No blog for this keyword is being written in this server.' } };
  },
});

tool({
  name: 'retry_keyword',
  kind: 'write',
  needs: 'content.work',
  description: 'Put a failed keyword back in the queue so it is written again by the next "Generate next blog draft" (not for calendar blogs).',
  input_schema: obj({ keyword_id: int }, ['keyword_id']),
  summarize: (i) => `Put failed keyword #${i.keyword_id} back in the queue`,
  run: async (i, ctx) => {
    const { retryKeyword } = await import('@/lib/generateActions');
    return { result: ok(await retryKeyword(i.keyword_id, actorOf(ctx))) };
  },
});

// =============================================================================================
// Drafts & Review
// =============================================================================================

tool({
  name: 'draft_set_status',
  kind: 'write',
  needs: 'content.work',
  description:
    'Approve, reject or send back to review a Drafts & Review blog (status approved, rejected or pending_review), as its buttons do. Approving a calendar blog also approves it for its slot (a tax, legal or compliance blog still needs its CA/CPA reviewer on the calendar: calendar_decide). A published blog keeps its status. Publishing is draft_publish.',
  input_schema: obj({ id: int, status: { type: 'string', enum: ['approved', 'rejected', 'pending_review'] } }, ['id', 'status']),
  summarize: (i) => `Set draft #${i.id} to ${i.status.replace('_', ' ')}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, changes: [{ field: 'status', before: d.status, after: i.status }], problem: d.status === 'published' ? 'This blog is already published; its review status cannot change.' : null };
  },
  run: async (i, ctx) => {
    const { patchDraft } = await import('@/lib/draftActions');
    const body = ok(await patchDraft(i.id, { status: i.status }, { actor: actorOf(ctx) }));
    return { result: { id: i.id, status: body.status, calendar: body.calendar || null } };
  },
});

tool({
  name: 'draft_set_author',
  kind: 'write',
  needs: 'content.work',
  description: 'Set the partner a Drafts & Review blog is published under: one of the blog authors (get_writing_rules shows blog_authors) or "random". Also set on its calendar row. Not for a blog already on the website.',
  input_schema: obj({ id: int, author: str }, ['id', 'author']),
  summarize: (i) => `Publish draft #${i.id} under ${i.author}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    const { authorNames } = await import('@/lib/authors');
    const names = await authorNames();
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, changes: [{ field: 'author', before: d.author || '(not set)', after: i.author }], problem: i.author !== 'random' && !names.includes(i.author) ? `Pick one of: ${names.join(', ')}, or "random".` : null };
  },
  run: async (i, ctx) => {
    const { patchDraft } = await import('@/lib/draftActions');
    return { result: ok(await patchDraft(i.id, { author: i.author }, { actor: actorOf(ctx) })) };
  },
});

tool({
  name: 'draft_set_cover_alt',
  kind: 'write',
  needs: 'content.work',
  description: "Set the alt text of a draft's cover image (what screen readers and Google read), up to 200 characters.",
  input_schema: obj({ id: int, cover_alt: str }, ['id', 'cover_alt']),
  summarize: (i) => `Set the cover alt text of draft #${i.id}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, changes: [{ field: 'cover alt', before: d.cover_alt || '(automatic)', after: i.cover_alt }] };
  },
  run: async (i, ctx) => {
    const { patchDraft } = await import('@/lib/draftActions');
    const body = ok(await patchDraft(i.id, { cover_alt: i.cover_alt }, { actor: actorOf(ctx) }));
    return { result: { id: i.id, cover_alt: body.cover_alt } };
  },
});

tool({
  name: 'draft_delete',
  kind: 'write',
  needs: 'content.work',
  risk: 'medium',
  description: 'Delete a Drafts & Review blog that will not be published, with its facts and image links. A plain blog\'s keyword goes back to the queue; a calendar blog is written again by its schedule; a topic\'s blog can be written again from Topics. A post already on the website is NOT touched.',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Delete draft #${i.id}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'} (${d.status}, ${words(d.content_html)} words)`, warning: d.wp_post_url ? `It is on the website (${d.wp_post_url}); the live post stays as it is.` : 'This cannot be undone from the assistant.' };
  },
  run: async (i, ctx) => {
    const { deleteDraft } = await import('@/lib/draftActions');
    return { result: ok(await deleteDraft(i.id, { actor: actorOf(ctx) })) };
  },
});

for (const fix of [false, true]) {
  tool({
    name: fix ? 'draft_fix_issues' : 'draft_recheck',
    kind: 'write',
    needs: 'content.work',
    risk: fix ? 'medium' : 'low',
    description: fix
      ? 'Check and fix (Drafts & Review): the open issues of a draft that needs attention are fixed in the whole blog, the fixed blog is saved (the earlier words can be restored with draft_restore), and the issues are checked again. Uses AI credits.'
      : 'Check issues again (Drafts & Review): the open issues of a draft that needs attention are checked against the article as it is now; resolved ones are cleared and the draft becomes ready for review when none is left. Uses AI credits.',
    input_schema: obj({ id: int }, ['id']),
    summarize: (i) => `${fix ? 'Check and fix' : 'Check again'} the open issues of draft #${i.id}`,
    preview: async (i) => {
      const d = await draftRow(i.id);
      const issues = parse(d.validation_issues, []);
      return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, issues: issues.slice(0, 15), warning: await costNote(AI), problem: issues.length ? null : 'This draft has no open issues to check.' };
    },
    run: async (i, ctx) => {
      ctx?.emit?.({ type: 'tool_progress', text: fix ? 'Fixing and checking the issues (a few minutes)…' : 'Checking the issues (a minute or two)…' });
      const { recheckDraft } = await import('@/lib/draftRecheck');
      return runOrQueue(ctx, `${fix ? 'Check and fix' : 'Check again'}: draft #${i.id}`, 'Drafts & Review', async () => ({ result: ok(await recheckDraft(i.id, fix, actorOf(ctx))) }));
    },
  });
}

tool({
  name: 'draft_originality_check',
  kind: 'write',
  needs: 'content.work',
  description: "Run the plagiarism check for a draft now (Google's top results via SerpHouse and Copyscape, plus our own blogs). Paid lookups.",
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Run the plagiarism check on draft #${i.id}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, warning: 'Uses paid SerpHouse searches and Copyscape credits.' };
  },
  run: async (i, ctx) => {
    ctx?.emit?.({ type: 'tool_progress', text: 'Checking originality (a minute or two)…' });
    const { checkDraftOriginality } = await import('@/lib/originality');
    let r;
    try {
      r = await checkDraftOriginality(i.id);
    } catch (err: any) {
      console.error('Plagiarism check failed', err);
      throw new Error('The plagiarism check could not run. Try again in a minute.');
    }
    if (!r) throw new Error('Draft not found');
    return { result: r };
  },
});

tool({
  name: 'draft_keyword_plan',
  kind: 'read',
  needs: 'content.work',
  description: 'Which keywords a draft uses, by type (primary, secondary, questions, related searches), checked against the article as it is now (Drafts & Review > Keywords).',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Read the keyword plan of draft #${i.id}`,
  run: async (i) => {
    const { loadDraftWithKeyword, draftKeywordAnalysis } = await import('@/lib/draftKeywords');
    const d = await loadDraftWithKeyword(i.id);
    if (!d) throw new Error('Draft not found');
    return draftKeywordAnalysis(d);
  },
});

tool({
  name: 'draft_optimise',
  kind: 'write',
  needs: 'content.work',
  risk: 'medium',
  description: "Optimise a draft for SEO, AEO and GEO keeping the author's text and facts (Drafts & Review > Optimise). Runs in the background (audit, then the optimise rewrite); the draft's words are replaced when done, and the previous version can be restored. Uses AI credits.",
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Optimise draft #${i.id} for SEO, AEO and GEO`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'} (${words(d.content_html)} words)`, warning: await costNote(`${AI} The draft's words are replaced when it finishes (restorable).`) };
  },
  run: async (i, ctx) => {
    const { startOptimise } = await import('@/lib/optimise');
    return { result: await startOptimise(i.id, actorOf(ctx)) };
  },
});

tool({
  name: 'draft_new_cover',
  kind: 'write',
  needs: 'content.work',
  description: 'Make a new photo cover for a draft and use it ("New photo cover"). Uses the photo service (Pexels, or paid OpenAI images). Choosing a designed banner stays on the page.',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Make a new photo cover for draft #${i.id}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    return { target: `Draft #${d.id}: ${d.title || '(untitled)'}`, warning: 'Replaces the current cover; may use a paid image service.' };
  },
  run: async (i) => {
    const { newPhotoCover } = await import('@/lib/draftActions');
    const body = ok(await newPhotoCover(i.id));
    return { result: { ok: true, cover_url: `/api/drafts/${i.id}/cover`, key: body.key } };
  },
});

tool({
  name: 'fact_set_status',
  kind: 'write',
  needs: 'content.work',
  description: "Mark a claim in a draft's Facts Register (fact row id from get_draft's facts) as verified or back to needs_verify. The reviewer is the person who approves.",
  input_schema: obj({ id: int, status: { type: 'string', enum: ['verified', 'needs_verify'] } }, ['id', 'status']),
  summarize: (i) => `Mark fact #${i.id} ${i.status === 'verified' ? 'verified' : 'needs verifying'}`,
  preview: async (i) => {
    const f = await prisma.facts.findUnique({ where: { id: i.id } });
    return f ? { target: `Claim: "${short(f.claim, 200)}" (draft #${f.draft_id})`, source: f.source_url || f.source_name || null, changes: [{ field: 'status', before: f.status, after: i.status }] } : { problem: 'Fact not found.' };
  },
  run: async (i, ctx) => {
    const { setFactStatus } = await import('@/lib/draftActions');
    const body = ok(await setFactStatus(i.id, { status: i.status }, ctx?.me?.name || actorOf(ctx)));
    return { result: { id: body.id, status: body.status, reviewer: body.reviewer } };
  },
});

tool({
  name: 'draft_history',
  kind: 'read',
  needs: 'content.work',
  description: "What changed in a draft's words (edits, uploads, optimisations, rewrites, restores), newest first, with the change ids draft_restore takes.",
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Read the change history of draft #${i.id}`,
  run: async (i) => {
    const { changesFor } = await import('@/lib/contentChanges');
    return changesFor('draft', i.id, 15);
  },
});

tool({
  name: 'draft_restore',
  kind: 'write',
  needs: 'content.work',
  risk: 'medium',
  description: 'Put back the words a draft had before one of its changes (change id from draft_history). Not for a published blog.',
  input_schema: obj({ id: int, change_id: int }, ['id', 'change_id']),
  summarize: (i) => `Restore draft #${i.id} to before change #${i.change_id}`,
  preview: async (i) => {
    const d = await draftRow(i.id);
    const { restorePoint } = await import('@/lib/contentChanges');
    const p = await restorePoint(i.change_id);
    const valid = p && p.change.entity_type === 'draft' && p.change.entity_id === i.id;
    return {
      target: `Draft #${d.id}: ${d.title || '(untitled)'}`,
      changes: valid ? [{ field: 'article', before: `${words(d.content_html)} words`, after: `${words(p!.html)} words (before the ${p!.change.kind} of ${p!.change.created_at} UTC)` }] : [],
      problem: !valid ? 'That earlier version is not available for this draft.' : d.status === 'published' ? 'This blog is already published.' : null,
    };
  },
  run: async (i, ctx) => {
    const { restoreDraftVersion } = await import('@/lib/draftActions');
    return { result: ok(await restoreDraftVersion(i.id, i.change_id, actorOf(ctx))) };
  },
});

tool({
  name: 'draft_publish',
  kind: 'write',
  needs: (i) => (i.skip_checks ? ['content.work', 'website.change', 'blog.publish_now'] : ['content.work', 'website.change']),
  risk: 'high',
  description:
    'Publish an approved Drafts & Review blog on the website (Publish), or update the live post of a blog already published ("Update the live post"). wp_status "draft" sends it as a hidden website draft where the website allows that. A tax, legal or compliance blog needs reviewer ("Name, credential"). A calendar blog not yet published goes live here only for an admin or a manager. skip_checks (admin or manager) skips the CA/CPA reviewer and the paid originality check; the free checks that protect the live page always run. For the user\'s own new blog use post_my_blog.',
  input_schema: obj({ id: int, wp_status: { type: 'string', enum: ['publish', 'draft'] }, reviewer: str, skip_checks: { type: 'boolean' } }, ['id']),
  summarize: (i) => `${i.wp_status === 'draft' ? 'Send to the website as a hidden draft' : 'Publish on the website'}: draft #${i.id}${i.skip_checks ? ' (skipping the reviewer and originality checks)' : ''}`,
  preview: async (i, ctx) => {
    const d = await draftRow(i.id);
    const { liveTextProblem, canPublishNow } = await import('@/lib/publishDraft');
    const problems = [
      d.status !== 'approved' && !(d.status === 'published' && d.wp_post_id) ? 'The draft must be approved first (draft_set_status).' : '',
      liveTextProblem(d) || '',
      i.skip_checks && !(await canPublishNow(ctx?.me || null)) ? 'Only an admin or a manager can skip the checks.' : '',
    ].filter(Boolean);
    return {
      target: `Draft #${d.id}: ${d.title || '(untitled)'} (${d.status})`,
      warning: d.wp_post_url ? `This updates the live post at ${d.wp_post_url}.` : 'This puts the blog live on the website.',
      reviewer: i.reviewer || null,
      problem: problems.length ? problems.join(' ') : null,
    };
  },
  run: async (i, ctx) => {
    ctx?.emit?.({ type: 'tool_progress', text: 'Publishing (checks first)…' });
    const { publishDraft, canPublishNow } = await import('@/lib/publishDraft');
    const me = ctx?.me || null;
    if (i.skip_checks && !(await canPublishNow(me))) throw new Error('Only an admin or a manager can publish without the CA/CPA reviewer and originality checks.');
    const body = ok(await publishDraft(i.id, { wpStatus: i.wp_status, reviewer: i.reviewer, skipExpert: !!i.skip_checks, skipOriginality: !!i.skip_checks, me, actor: actorOf(ctx) }));
    return { result: body };
  },
});

tool({
  name: 'blog_analytics',
  kind: 'read',
  needs: 'reports.view',
  description: 'Blog analytics (Search Console and GA4): with url, one blog (clicks, impressions, position, queries, sessions; keyword = its target keyword); without url, the table of all blogs. days 7 to 90 (default 28).',
  input_schema: obj({ url: str, keyword: str, days: { type: 'integer', minimum: 7, maximum: 90 } }),
  summarize: (i) => (i.url ? `Read analytics for ${i.url}` : 'Read the blog analytics table'),
  run: async (i) => {
    const { getBlogAnalytics, getBlogTable } = await import('@/lib/blogAnalytics');
    const days = Math.min(90, Math.max(7, i.days || 28));
    return i.url ? getBlogAnalytics(i.url, { days, keyword: i.keyword || '' }) : getBlogTable({ days });
  },
});

// =============================================================================================
// Check a blog / Refresh a live blog
// =============================================================================================

tool({
  name: 'audit_get',
  kind: 'read',
  needs: 'content.work',
  description: 'One blog audit in full (Check a blog / Refresh a live blog): verdict, issues, suggestions, facts, rewrite status and the rewrite (title, meta, HTML) when ready, and its Word download link.',
  input_schema: obj({ id: int }, ['id']),
  summarize: (i) => `Read audit #${i.id}`,
  run: async (i) => {
    const row = await prisma.blog_audits.findUnique({ where: { id: i.id } });
    if (!row) throw new Error('Audit not found');
    const { parseAuditRow } = await import('@/lib/audits');
    const a: any = parseAuditRow(row);
    return { ...a, content_html: undefined, original_words: words(row.content_html), word_download: a.rewrite_content_html ? `/api/audit/${i.id}/download` : null };
  },
});

tool({
  name: 'audit_rewrite',
  kind: 'write',
  needs: 'content.work',
  description: 'Rewrite an audited blog to fix its issues ("Rewrite to fix these issues" / "Rewrite again"); mode "optimise" keeps the author\'s words and facts and adds only SEO, AEO and GEO. Runs in the background (1-2 minutes); read it with audit_get. Uses AI credits. Nothing reaches the website.',
  input_schema: obj({ id: int, mode: { type: 'string', enum: ['default', 'optimise'] } }, ['id']),
  summarize: (i) => `Rewrite audit #${i.id}${i.mode === 'optimise' ? ' (keep the author\'s words)' : ''}`,
  preview: async () => ({ warning: await costNote(AI) }),
  run: async (i, ctx) => {
    const { startRewrite } = await import('@/lib/auditJobs');
    const row: any = await startRewrite(i.id, actorOf(ctx), { mode: i.mode === 'optimise' ? 'optimise' : undefined });
    return { result: { id: row.id, rewrite_status: row.rewrite_status } };
  },
});

tool({
  name: 'audit_stop',
  kind: 'write',
  needs: 'content.work',
  description: 'Stop a running audit or rewrite (Check a blog > Stop). The AI call in flight is cut off.',
  input_schema: obj({ id: int, job: { type: 'string', enum: ['audit', 'rewrite'] } }, ['id', 'job']),
  summarize: (i) => `Stop the ${i.job} of audit #${i.id}`,
  run: async (i, ctx) => {
    const { stopJob } = await import('@/lib/auditJobs');
    if (!(await stopJob(`${i.job}-${i.id}`, actorOf(ctx)))) throw new Error('This job is not running any more.');
    return { result: { ok: true } };
  },
});

tool({
  name: 'audit_publish_live',
  kind: 'write',
  needs: 'blog.publish_now',
  risk: 'high',
  description:
    "Send an audit's rewrite to the website (Approve - publish / replace the live post). If the audit came from a live post, it REPLACES that post in place; otherwise it is published as a new post. wp_status \"draft\" saves a separate hidden website draft instead (live post unchanged) where the website allows drafts. Admin or manager (blog.publish_now).",
  input_schema: obj({ id: int, wp_status: { type: 'string', enum: ['publish', 'draft'] } }, ['id']),
  summarize: (i) => `${i.wp_status === 'draft' ? 'Save a website draft of' : 'Publish'} the rewrite of audit #${i.id}`,
  preview: async (i) => {
    const a = await prisma.blog_audits.findUnique({ where: { id: i.id } });
    if (!a) return { problem: 'Audit not found.' };
    return {
      target: `Audit #${a.id}: ${a.rewrite_title || a.title || '(untitled)'}`,
      warning: a.wp_post_id && i.wp_status !== 'draft' ? `This REPLACES the live post${a.wp_post_url ? ` at ${a.wp_post_url}` : ''}; visitors and Google see the new version at once.` : i.wp_status === 'draft' ? 'A hidden website draft is made; nothing live changes.' : 'This publishes a new post on the website.',
      words: `${words(a.content_html)} → ${words(a.rewrite_content_html)}`,
      problem: !a.rewrite_content_html ? 'There is no rewrite yet (audit_rewrite first).' : null,
    };
  },
  run: async (i, ctx) => {
    const { publishAudit } = await import('@/lib/auditPublish');
    return { result: ok(await publishAudit(i.id, { wpStatus: i.wp_status || 'publish' }, actorOf(ctx))) };
  },
});

// =============================================================================================
// Writing rules
// =============================================================================================

tool({
  name: 'get_writing_rules',
  kind: 'read',
  needs: 'content.work',
  description: 'The Writing rules page: the editable writing settings (max_words, voice_guidelines, byline, CTAs, service CTAs, blog authors, posting days and time, focus services, competitor domains, SE Ranking tracking targets), the active content-writing skill, and the lessons learned from reviews.',
  input_schema: obj({}),
  summarize: () => 'Read the writing rules',
  run: async () => {
    const { editableSettings } = await import('@/lib/writingRules');
    const skill = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' }, select: { id: true, created_at: true, skill_content: true, research_summary: true } });
    return { settings: await editableSettings(), activeSkill: skill, lessons: (await settings.get('writer_lessons')) || '' };
  },
});

tool({
  name: 'update_writing_rules',
  kind: 'write',
  needs: 'settings.change',
  description: 'Change writing settings (Writing rules / Settings). values maps setting keys to their new values (strings, as get_writing_rules shows them). Only these keys: max_words, voice_guidelines, byline_author, byline_reviewer, cta_text, cta_url, service_ctas, tracked_keyword_target, seranking_keyword_limit, seranking_keyword_buffer, seranking_reserve_units, focus_services, posting_days, posting_time_ist, blog_authors, competitor_domains. Admin only.',
  input_schema: obj({ values: { type: 'object', description: 'Setting key to new value.' } }, ['values']),
  summarize: (i) => `Change writing settings: ${Object.keys(i.values || {}).join(', ') || 'nothing'}`,
  preview: async (i) => {
    const { isEditableSetting } = await import('@/lib/permissions');
    const keys = Object.keys(i.values || {});
    const refused = keys.filter((k) => !isEditableSetting(k));
    const now = await settings.getMany(keys.filter(isEditableSetting));
    return {
      changes: keys.filter(isEditableSetting).map((k) => ({ field: k, before: short(now[k] ?? '', 300), after: short(typeof i.values[k] === 'string' ? i.values[k] : JSON.stringify(i.values[k]), 300) })),
      problem: !keys.length ? 'Nothing to change.' : refused.length ? `These settings cannot be changed here: ${refused.join(', ')}.` : null,
    };
  },
  run: async (i, ctx) => {
    const { saveSettings } = await import('@/lib/writingRules');
    // Values are stored as text, as the Settings page sends them.
    const values = Object.fromEntries(Object.entries(i.values || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    ok(await saveSettings(values, actorOf(ctx)));
    return { result: { updated: Object.keys(values) } };
  },
});

tool({
  name: 'save_writing_skill',
  kind: 'write',
  needs: 'content.work',
  riskFor: () => 'medium',
  description: 'Save an edited content-writing skill (Writing rules > Edit) as the new active version; the old one stays in the history. Read the active skill with get_writing_rules first and send the WHOLE skill text.',
  input_schema: obj({ skill_content: str, research_summary: str }, ['skill_content']),
  summarize: () => 'Save a new version of the content-writing skill',
  preview: async (i) => {
    const prev = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' }, select: { id: true, skill_content: true } });
    return { changes: [{ field: 'skill', before: `${words(prev?.skill_content)} words (version #${prev?.id ?? 'none'})`, after: `${words(i.skill_content)} words` }], problem: String(i.skill_content || '').trim() ? null : 'The skill cannot be empty.' };
  },
  run: async (i, ctx) => {
    const { saveSkillEdit } = await import('@/lib/writingRules');
    const body = ok(await saveSkillEdit({ skill_content: i.skill_content, research_summary: i.research_summary }, actorOf(ctx)));
    return { result: { id: body.id, status: body.status } };
  },
});

tool({
  name: 'generate_writing_skill',
  kind: 'write',
  needs: 'content.work',
  risk: 'medium',
  description: 'Have the AI research and write a new version of the content-writing skill now (Writing rules > Update now). Takes several minutes and uses AI credits with web search.',
  input_schema: obj({}),
  summarize: () => 'Update the content-writing skill now (AI research)',
  preview: async () => ({ warning: await costNote(`${AI} Several minutes.`) }),
  run: async (_i, ctx) => {
    ctx?.emit?.({ type: 'tool_progress', text: 'Researching and writing the new skill (several minutes)…' });
    const { generateSkillNow } = await import('@/lib/writingRules');
    return runOrQueue(ctx, 'Update the content-writing skill', 'Writing rules', async () => {
      const body = ok(await generateSkillNow());
      return { result: { id: body.id, sources: (body.sources || []).length } };
    });
  },
});

tool({
  name: 'learn_lessons',
  kind: 'write',
  needs: 'content.work',
  description: 'Learn lessons for the writer from the latest reviews, holds and results now (it also runs every Monday). Runs in the background; uses AI credits.',
  input_schema: obj({}),
  summarize: () => 'Learn writer lessons from the latest reviews',
  preview: async () => ({ warning: await costNote(AI) }),
  run: async () => {
    const { startLessons } = await import('@/lib/writingRules');
    return { result: await startLessons() };
  },
});

// =============================================================================================
// Website Content
// =============================================================================================

tool({
  name: 'site_content_list',
  kind: 'read',
  needs: 'content.work',
  description: "Website Content: the custom website's pages and posts held in the dashboard (type, slug, title, status, last update), and whether the website connection is set up.",
  input_schema: obj({}),
  summarize: () => 'List website pages and posts',
  run: async () => (await import('@/lib/siteContentActions')).siteContentList(),
});

tool({
  name: 'site_content_get',
  kind: 'read',
  needs: 'content.work',
  description: 'One website page or post in full by its URL path (slug, e.g. "/services/itin" or "/blog/itin-guide"): pages have keyed sections; posts have html, cover, categories, tags, schema.',
  input_schema: obj({ slug: str }, ['slug']),
  summarize: (i) => `Read website content ${i.slug}`,
  run: async (i) => ok(await (await import('@/lib/siteContentActions')).siteContentItem(i.slug)),
});

tool({
  name: 'site_content_save',
  kind: 'write',
  needs: 'website.change',
  risk: 'high',
  description:
    'Save a website page or post (Website Content editor); the website is told at once, so the change is live. type "page" or "post"; item is the whole item in the shape site_content_get returns (slug, title, status, metaDescription, canonical, sections for a page, html / cover / categories / tags for a post, schema). Read it first and change only what the user asked. create: true for a new item (never overwrites an existing one).',
  input_schema: obj({ type: { type: 'string', enum: ['page', 'post'] }, item: { type: 'object' }, create: { type: 'boolean' } }, ['type', 'item']),
  summarize: (i) => `${i.create ? 'Create' : 'Save'} website ${i.type} ${i.item?.slug || ''}`,
  preview: async (i) => {
    const { siteContentItem } = await import('@/lib/siteContentActions');
    const cur = i.item?.slug ? await siteContentItem(String(i.item.slug)) : { status: 404, body: null };
    const before: any = cur.status === 200 ? cur.body.item : null;
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(i.item || {})])].filter((k) => !['updatedAt', 'updatedBy', 'type'].includes(k) && JSON.stringify(before?.[k] ?? null) !== JSON.stringify(i.item?.[k] ?? null) && i.item?.[k] !== undefined);
    return {
      target: `${i.type} ${i.item?.slug || '(no slug)'}${before ? '' : ' (new)'}`,
      changes: keys.map((k) => ({ field: k, before: short(typeof before?.[k] === 'string' ? before[k] : JSON.stringify(before?.[k] ?? ''), 300), after: short(typeof i.item[k] === 'string' ? i.item[k] : JSON.stringify(i.item[k]), 300) })),
      warning: 'This changes the live website as soon as it is approved.',
      problem: i.create && before ? `${i.item.slug} already exists; save without create to edit it.` : !i.create && !before ? 'Not found; use create: true for a new item.' : null,
    };
  },
  run: async (i, ctx) => {
    const { siteContentAction } = await import('@/lib/siteContentActions');
    return { result: ok(await siteContentAction({ action: 'save', type: i.type, item: i.item, create: !!i.create }, ctx?.me?.email || null)) };
  },
});

tool({
  name: 'site_content_delete',
  kind: 'write',
  needs: 'website.change',
  risk: 'high',
  description: 'Delete a website page or post by its URL path; the website is told at once, so it disappears from the live site.',
  input_schema: obj({ slug: str }, ['slug']),
  summarize: (i) => `Delete website content ${i.slug}`,
  preview: async (i) => {
    const { siteContentItem } = await import('@/lib/siteContentActions');
    const cur = await siteContentItem(i.slug);
    return { target: cur.status === 200 ? `${cur.body.item.type} ${i.slug}: ${cur.body.item.title || ''}` : i.slug, warning: 'It disappears from the live website.', problem: cur.status === 200 ? null : 'Not found.' };
  },
  run: async (i, ctx) => {
    const { siteContentAction } = await import('@/lib/siteContentActions');
    return { result: ok(await siteContentAction({ action: 'delete', slug: i.slug }, ctx?.me?.email || null)) };
  },
});

// =============================================================================================
// Reports (Overall, SEO, AEO, GEO), Learning, Meeting insights
// =============================================================================================

tool({
  name: 'performance_report',
  kind: 'read',
  needs: 'reports.view',
  description: 'The SEO, AEO and GEO performance report (Overall / SEO / AEO / GEO pages) for the last N days (7 to 90, default 28) against the previous period: Search Console, GA4, rankings, AI visibility, leads.',
  input_schema: obj({ days: { type: 'integer', minimum: 7, maximum: 90 } }),
  summarize: (i) => `Read the performance report (${i.days || 28} days)`,
  run: async (i) => {
    const { cachedPerformance } = await import('@/lib/performanceReport');
    return cachedPerformance(Math.min(90, Math.max(7, i.days || 28)));
  },
});

tool({
  name: 'performance_explain',
  kind: 'write',
  needs: 'reports.view',
  description: 'The "why it changed" paragraph at the end of a report (view overall, seo, aeo or geo; days 7 to 90). Written once per period and saved; a new one (or fresh: true) uses AI credits.',
  input_schema: obj({ view: { type: 'string', enum: ['overall', 'seo', 'aeo', 'geo'] }, days: { type: 'integer', minimum: 7, maximum: 90 }, fresh: { type: 'boolean' } }, ['view']),
  summarize: (i) => `Explain the ${i.view} report (${i.days || 28} days)`,
  preview: async () => ({ warning: await costNote('Uses AI credits when it is not written yet for this period.') }),
  run: async (i, ctx) => {
    const { explainPerformance } = await import('@/lib/performanceExplain');
    return runOrQueue(ctx, `Explain the ${i.view} report`, `the ${i.view === 'overall' ? 'Overall' : i.view.toUpperCase()} report page`, async () => ({ result: await explainPerformance(i.view, Math.min(90, Math.max(7, i.days || 28)), { fresh: !!i.fresh }) }));
  },
});

tool({
  name: 'business_results',
  kind: 'read',
  needs: 'reports.view',
  description: 'Business results from Zoho CRM: leads, consults and signed clients by blog topic and service for the last N days (7 to 365, default 90).',
  input_schema: obj({ days: { type: 'integer', minimum: 7, maximum: 365 } }),
  summarize: (i) => `Read business results (${i.days || 90} days)`,
  run: async (i) => {
    const { businessResults } = await import('@/lib/leadAttribution');
    return businessResults({ days: Math.min(365, Math.max(7, i.days || 90)) });
  },
});

tool({
  name: 'learning_feed',
  kind: 'read',
  needs: 'content.work',
  description: 'The Learning page: what the team changed in blogs, what the writer learned from it (lessons), and what the team asked the dashboard for in the last 30 days.',
  input_schema: obj({}),
  summarize: () => 'Read the Learning page',
  run: async () => (await import('@/lib/learningFeed')).learningFeed(),
});

tool({
  name: 'list_meeting_insights',
  kind: 'read',
  needs: 'reports.view',
  description: 'Meeting insights: client meetings from Fireflies, cleaned of identifying details, with overview, action items, keywords and review status (pending_review, approved, rejected).',
  input_schema: obj({ status: { type: 'string', enum: ['pending_review', 'approved', 'rejected'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  summarize: (i) => `Read meeting insights${i.status ? ` (${i.status})` : ''}`,
  run: async (i) =>
    prisma.client_insights.findMany({ where: i.status ? { status: i.status } : { status: { not: 'deleted' } }, orderBy: { id: 'desc' }, take: i.limit || 30 }),
});

tool({
  name: 'meetings_sync',
  kind: 'write',
  needs: 'content.work',
  description: 'Pull recent Fireflies meetings now and clean and review them automatically (the same as the daily job). Uses AI credits to clean each new meeting.',
  input_schema: obj({}),
  summarize: () => 'Sync meetings from Fireflies now',
  preview: async () => ({ warning: await costNote(AI) }),
  run: async () => {
    const { syncMeetings } = await import('@/lib/clientInsights');
    return { result: await syncMeetings() };
  },
});

tool({
  name: 'meeting_insight_review',
  kind: 'write',
  needs: 'content.work',
  description: 'Approve, reject or send back to review a meeting insight, and/or replace its overview text (e.g. to remove a client detail). Only approved insights feed blogs and reports.',
  input_schema: obj({ id: int, status: { type: 'string', enum: ['approved', 'rejected', 'pending_review'] }, overview: str }, ['id']),
  summarize: (i) => `${i.status ? `Set meeting insight #${i.id} to ${i.status.replace('_', ' ')}` : `Edit meeting insight #${i.id}`}${i.status && i.overview ? ' and edit its overview' : ''}`,
  preview: async (i) => {
    const r = await prisma.client_insights.findUnique({ where: { id: i.id } });
    if (!r || r.status === 'deleted') return { problem: 'Not found.' };
    return {
      target: `Meeting #${r.id}: ${r.title || '(untitled meeting)'}`,
      changes: [i.status ? { field: 'status', before: r.status, after: i.status } : null, i.overview != null ? { field: 'overview', before: short(r.overview, 300), after: short(i.overview, 300) } : null].filter(Boolean),
      problem: !i.status && i.overview == null ? 'Nothing to change.' : null,
    };
  },
  run: async (i, ctx) => {
    const { reviewInsight } = await import('@/lib/clientInsightActions');
    const body = ok(await reviewInsight(i.id, { status: i.status, overview: i.overview }, actorOf(ctx)));
    return { result: { id: body.id, status: body.status } };
  },
});

// =============================================================================================
// Associate Training
// =============================================================================================

tool({
  name: 'training_status',
  kind: 'read',
  description: "Associate Training as the page shows it to the person asking: an associate gets their own lesson, whether a test is open (never its questions) and results; an admin or manager gets today's lessons and everyone's progress (person: one associate's page by email). Taking a test stays on the page.",
  input_schema: obj({ person: str }),
  summarize: (i) => `Read associate training${i.person ? ` for ${i.person}` : ''}`,
  run: async (i, ctx) => {
    if (!ctx?.me) throw new Error('Sign in first');
    const { trainingView } = await import('@/lib/associateTrainingView');
    const v = ok(await trainingView(ctx.me, { person: String(i.person || '').toLowerCase() }));
    // An open test is the associate's to answer alone: the assistant sees that it is open, never its questions.
    const hideTest = (p: any) => (p?.test ? { ...p, test: { id: p.test.id, day: p.test.day, total: p.test.total, open: true, note: 'Open test: taken on the Associate Training page.' } } : p);
    return { ...v, me: hideTest(v.me), person: hideTest(v.person) };
  },
});

// =============================================================================================
// Settings (AI credits read only; SE Ranking tracking)
// =============================================================================================

tool({
  name: 'ai_credits_status',
  kind: 'read',
  needs: 'credits.view',
  description: 'AI credits (Settings > AI credits, read only): estimated balance and credit left, spend in the last 24 hours, 7 and 30 days by kind of work, whether AI work is paused, Testing or Live mode and what waits in the Claude Code queue, and what is running now. days adds the spend of the last N days by kind of work and model.',
  input_schema: obj({ days: { type: 'integer', minimum: 1, maximum: 90 } }),
  summarize: () => 'Read AI credits',
  run: async (i) => {
    const { creditStatus, spendWindow } = await import('@/lib/aiCredits');
    const { aiMode } = await import('@/lib/aiQueue');
    const { runningTimers } = await import('@/lib/jobTimer');
    const s: any = await creditStatus();
    const [blogs, strategies, waiting] = await Promise.all([
      prisma.keywords.findMany({ where: { status: 'generating' }, select: { keyword: true } }),
      prisma.seo_strategies.findMany({ where: { status: { in: ['generating', 'paused', 'stopping'] } }, select: { id: true, status: true } }),
      prisma.ai_jobs.count({ where: { status: 'waiting' } }),
    ]);
    return {
      balance: s.balance, remaining: s.remaining, usedPercent: s.usedPercent, threshold: s.threshold, paused: s.paused, pauseReason: s.pauseReason, spent: s.spent, byFeature: s.byFeature, models: s.models,
      aiMode: await aiMode(), queueWaiting: waiting,
      running: { blogs: blogs.map((b) => b.keyword), strategies: strategies.map((x) => `#${x.id} ${x.status}`), other: runningTimers().filter((t) => !t.key.startsWith('blog-')).map((t) => t.label) },
      ...(i.days ? { window: await spendWindow(i.days) } : {}),
    };
  },
});

tool({
  name: 'seranking_topup',
  kind: 'write',
  needs: 'settings.change',
  description: 'Add the missing strategy and blog keywords to SE Ranking rank tracking now (Settings > Add keywords to tracking; it also runs every Monday). Runs in the background and uses SE Ranking units. Admin only.',
  input_schema: obj({}),
  summarize: () => 'Add missing keywords to SE Ranking tracking',
  preview: async () => {
    const raw = await settings.get('last_keyword_topup_result');
    return { warning: 'Uses SE Ranking keyword units.', last_run: raw ? parse(raw, null) : null };
  },
  run: async () => {
    const { startKeywordTopup } = await import('@/lib/keywordTracking');
    return { result: await startKeywordTopup() };
  },
});

export const TAB_TOOLS = TOOLS;
export type { Action };
