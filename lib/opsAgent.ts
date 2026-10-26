// The Ops agent: a daily health check of the dashboard, worked out in code (no AI, so it costs nothing
// and is exact). It checks the scheduler, what failed in the last 24 hours, work that is stuck, AI
// credits, the Claude Code queue, the website connector, Gemini and the shared brain, says what to do
// about each problem, and remembers every incident (lib/agentMemory.ts) until it is fixed. It also
// reads CHANGELOG.md so every agent knows what was changed in development.
import fs from 'fs';
import path from 'path';
import prisma from './prisma';
import * as settings from './settings';
import { notify } from './notify';
import { remember, resolveIncidents } from './agentMemory';

export type Check = { key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const sqlMs = (s: string) => Date.parse(String(s).replace(' ', 'T') + 'Z');

// What to do when a kind of work keeps failing.
const FIXES: [RegExp, string][] = [
  [/^schedule\./, 'Open Home > Needs attention: fix the cause, then Resume or Publish now; press Already done if it is published.'],
  [/^draft\.generation/, 'Open Write a blog and press Try again on the keyword; if it keeps failing, read the error in the Activity Log.'],
  [/^audit\./, 'Open Check a blog and run it again; long files work better as .docx without images.'],
  [/^strategy\./, 'Open Monthly Strategy and start it again; it reuses the finished steps.'],
  [/^learning\./, 'Open Learn from YouTube: press Retry on the video, or Test Gemini key.'],
  [/^brand\./, 'Open Brand Palette and make it again.'],
];
const fixFor = (action: string) => FIXES.find(([re]) => re.test(action))?.[1] || 'Read the error in the Activity Log.';

export async function healthChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. The scheduler runs every 15 minutes and leaves a heartbeat.
  const beat = await settings.get('scheduler_heartbeat');
  const age = beat ? Math.round((Date.now() - Date.parse(beat)) / 60000) : null;
  checks.push(
    age === null || age > 40
      ? { key: 'scheduler', label: 'Scheduler', status: 'fail', detail: age === null ? 'It has never reported.' : `Last run ${age} minutes ago (it should run every 15 minutes).`, fix: 'Check the app in Coolify (Logs). A redeploy starts it again.' }
      : { key: 'scheduler', label: 'Scheduler', status: 'ok', detail: `Last run ${age} minute(s) ago.` },
  );

  // 2. What failed in the last 24 hours, grouped by kind of work.
  const failed = await prisma.activity_log.findMany({ where: { created_at: { gte: hoursAgo(24) }, OR: [{ action: { endsWith: '.failed' } }, { action: { endsWith: '_failed' } }, { action: { endsWith: '.error' } }] }, orderBy: { id: 'desc' }, take: 300, select: { action: true, details: true, created_at: true } });
  const groups = new Map<string, { n: number; last: string; at: string }>();
  for (const f of failed) {
    const g = groups.get(f.action) || { n: 0, last: String(f.details || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 220), at: f.created_at };
    g.n++;
    groups.set(f.action, g);
  }
  if (!groups.size) checks.push({ key: 'failures', label: 'Failed work (24 h)', status: 'ok', detail: 'Nothing failed.' });
  for (const [action, g] of groups) checks.push({ key: `failed:${action}`, label: `Failed: ${action}`, status: g.n >= 3 ? 'fail' : 'warn', detail: `${g.n} time(s) in 24 h, last at ${g.at} UTC: ${g.last}`, fix: fixFor(action) });

  // 3. Work that is stuck.
  const { blogRuns } = await import('./blogRuns');
  const stuckBlogs = (await prisma.keywords.findMany({ where: { status: 'generating', created_at: { lt: hoursAgo(3) } }, select: { id: true, keyword: true } })).filter((k) => !blogRuns.has(k.id));
  if (stuckBlogs.length) checks.push({ key: 'stuck:blogs', label: 'Blogs stuck in "writing"', status: 'warn', detail: stuckBlogs.slice(0, 5).map((k) => k.keyword).join(', '), fix: 'Open Write a blog: Stop and Try again. A server restart also requeues them.' });
  const stuckStrategies = await prisma.seo_strategies.findMany({ where: { status: 'generating', created_at: { lt: hoursAgo(6) } }, select: { period: true } });
  if (stuckStrategies.length) checks.push({ key: 'stuck:strategy', label: 'Strategy generating for over 6 hours', status: 'warn', detail: stuckStrategies.map((s) => s.period).join(', '), fix: 'Open Monthly Strategy; pause and resume it.' });
  const stopped = await prisma.blog_schedule.findMany({ where: { status: 'paused', paused_by: { startsWith: 'Automatic' } }, select: { title: true } });
  if (stopped.length) checks.push({ key: 'stopped:blogs', label: 'Blogs stopped after a failure', status: 'warn', detail: stopped.slice(0, 5).map((s) => s.title).join(' · '), fix: 'Home > Needs attention: Resume after fixing the cause, or Already done.' });

  // 4. AI credits and the Claude Code queue (Testing mode).
  const { creditStatus } = await import('./aiCredits');
  const c: any = await creditStatus().catch(() => null);
  if (c?.paused) checks.push({ key: 'credits', label: 'AI credits', status: 'fail', detail: `AI work is paused: ${c.pauseReason || 'credits are low'}.`, fix: 'Top up at console.anthropic.com and enter the new balance in Settings > AI credits, or switch to Testing mode.' });
  else if (c && c.remaining !== null && c.remaining < (c.threshold || 0) * 2) checks.push({ key: 'credits', label: 'AI credits', status: 'warn', detail: `About $${Number(c.remaining).toFixed(2)} left.`, fix: 'Top up soon, or switch to Testing mode (Claude Code subscription).' });
  else checks.push({ key: 'credits', label: 'AI credits', status: 'ok', detail: c?.remaining != null ? `About $${Number(c.remaining).toFixed(2)} left.` : 'Balance not entered.' });
  const oldest = await prisma.ai_jobs.findFirst({ where: { status: 'waiting' }, orderBy: { id: 'asc' }, select: { created_at: true } });
  const waiting = await prisma.ai_jobs.count({ where: { status: 'waiting' } });
  if (waiting && oldest && Date.now() - sqlMs(oldest.created_at) > 12 * 3600000) checks.push({ key: 'queue', label: 'Claude Code queue', status: 'warn', detail: `${waiting} AI job(s) waiting since ${oldest.created_at} UTC.`, fix: 'Open Claude Code and say "run the SEO AI queue".' });

  // 5. The website connector.
  const { connectorOn, connectorCall } = await import('./siteConnector');
  if (connectorOn()) {
    const ok = await connectorCall('ping').then(() => true).catch((e: any) => e.message as string);
    checks.push(ok === true ? { key: 'connector', label: 'Website connector', status: 'ok', detail: 'The website answers.' } : { key: 'connector', label: 'Website connector', status: 'fail', detail: String(ok).slice(0, 200), fix: 'Ask the website developer to check the connector; if our server IP changed, send them the new one (Coolify terminal: curl -s https://api.ipify.org).' });
  } else checks.push({ key: 'connector', label: 'Website connector', status: 'warn', detail: 'Not set up, so blogs cannot be published to the website.', fix: 'Add SITE_CONNECTOR_URL and SITE_CONNECTOR_SECRET in Coolify.' });

  // 6. Gemini, when videos wait to be watched.
  const queued = await prisma.learning_videos.count({ where: { status: { in: ['queued', 'watching'] } } });
  if (queued) {
    const { geminiKey, testGemini } = await import('./gemini');
    if (!geminiKey()) checks.push({ key: 'gemini', label: 'Learn from YouTube', status: 'warn', detail: `${queued} video(s) wait, but GEMINI_API_KEY is not set.`, fix: 'Create a key at aistudio.google.com and add GEMINI_API_KEY in Coolify.' });
    else {
      const t = await testGemini();
      checks.push(t.ok && t.modelAvailable ? { key: 'gemini', label: 'Learn from YouTube', status: 'ok', detail: `${queued} video(s) to watch; Gemini works.` } : { key: 'gemini', label: 'Learn from YouTube', status: 'fail', detail: t.error || `${t.model} is not available to this key.`, fix: 'Learn from YouTube > Test Gemini key; set GEMINI_MODEL to a model from the list.' });
    }
  }

  // 7. The shared brain for the Social Media dashboard.
  if ((process.env.PARTNER_SHARED_SECRET || '').length < 32) checks.push({ key: 'partner', label: 'Shared brain (Social dashboard)', status: 'warn', detail: 'PARTNER_SHARED_SECRET is not set, so the Social dashboard cannot use the skills, YouTube learning or palettes.', fix: 'Make one with "openssl rand -hex 32"; add it as PARTNER_SHARED_SECRET here and SEO_PARTNER_SECRET on the Social dashboard.' });

  return checks;
}

// CHANGELOG.md (kept by Claude Code with every deploy): each "- (agent) text" line under a "## date"
// heading becomes a "change" memory for that agent (ops when none is named).
export async function readChangelog() {
  let text = '';
  try {
    text = fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  } catch {
    return 0;
  }
  let day = '';
  let n = 0;
  for (const line of text.split('\n')) {
    const h = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line);
    if (h) {
      day = h[1];
      continue;
    }
    const m = /^-\s+(?:\((\w[\w-]*)\)\s+)?(.+)$/.exec(line.trim());
    if (!m || !day) continue;
    await remember({ agent: m[1] || 'ops', kind: 'change', title: `${day}: ${m[2]}`, body: `${day}: ${m[2]}`, source: 'changelog', sourceRef: `changelog:${day}`, bump: false });
    n++;
  }
  return n;
}

// The daily run (and the "Run the health check" button): checks, incidents remembered or resolved,
// the report saved, and a Slack message for problems that are new since the last report.
export async function runOps() {
  const checks = await healthChecks();
  const problems = checks.filter((c) => c.status !== 'ok');
  for (const p of problems) await remember({ agent: 'ops', kind: 'incident', title: `${p.label}`, body: `${p.label}: ${p.detail}${p.fix ? ` Fix: ${p.fix}` : ''}`, source: 'ops', sourceRef: p.key });
  await resolveIncidents('ops', problems.map((p) => p.label));
  const changes = await readChangelog().catch(() => 0);
  const prev = JSON.parse((await settings.get('ops_report')) || '{}');
  const before = new Set((prev.checks || []).filter((c: Check) => c.status === 'fail').map((c: Check) => c.key));
  const fresh = checks.filter((c) => c.status === 'fail' && !before.has(c.key));
  const report = { at: new Date().toISOString(), checks, changes };
  await settings.set('ops_report', JSON.stringify(report));
  if (fresh.length) await notify(`Dashboard health: ${fresh.length} new problem(s)`, fresh.map((c) => `- ${c.label}: ${c.detail}${c.fix ? `\n  Fix: ${c.fix}` : ''}`).join('\n')).catch(() => {});
  return report;
}
