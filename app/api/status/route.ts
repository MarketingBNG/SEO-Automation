import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { publishPlan } from '@/lib/strategy/core';
import { blogRuns } from '@/lib/blogRuns';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

const DRAFT_LEAD_HOURS = 72;
const fmt = (ms: number) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';
const toMs = (s: string) => Date.parse(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));

// The status light in the header: is the automation alive, did its last run go cleanly, and what
// does it do next. Green = running; amber = running with problems or waiting for a person;
// red = stopped (no check for over 20 minutes, AI paused, or no approved strategy).
export async function GET() {
  const now = Date.now();
  const st = await settings.getMany(['scheduler_heartbeat', 'scheduler_last_run', 'ai_paused', 'ai_paused_reason']);
  const beat = st.scheduler_heartbeat ? Date.parse(st.scheduler_heartbeat) : null;
  let last: any = null;
  try {
    last = JSON.parse(st.scheduler_last_run || 'null');
  } catch {}
  const strategy = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' }, select: { id: true, period: true } });
  const rows = strategy ? await prisma.blog_schedule.findMany({ where: { strategy_id: strategy.id }, orderBy: { publish_at: 'asc' } }) : [];
  const writing = await prisma.keywords.count({ where: { status: 'generating' } });

  const problems: string[] = [];
  const notes: string[] = [];
  let level: 'green' | 'amber' | 'red' = 'green';
  if (!beat || now - beat > 20 * 60000) {
    level = 'red';
    problems.push(beat ? `The automation has not checked in since ${fmt(beat)}. The server may have restarted or stopped; it checks every 15 minutes when running.` : 'The automation has not checked in yet. It starts a minute after the server starts and checks every 15 minutes.');
  }
  if (st.ai_paused === '1') {
    level = 'red';
    problems.push(`AI work is paused: ${st.ai_paused_reason || 'credits are low'}. Enter the new balance in Settings > AI credits.`);
  }
  if (!strategy) {
    level = 'red';
    problems.push('No approved strategy, so no blogs are scheduled. Approve one in Monthly Strategy.');
  }
  if (last?.errors?.length) {
    if (level === 'green') level = 'amber';
    problems.push(...last.errors.map((e: string) => `Last run: ${e}`));
  }
  const held = rows.filter((r) => r.status === 'held');
  if (held.length) {
    if (level === 'green') level = 'amber';
    problems.push(`${held.length} blog${held.length === 1 ? ' is' : 's are'} held and need a person (see Home > Needs attention).`);
  }

  // What happens next, in plain words.
  if (writing || blogRuns.size) notes.push(`Writing ${writing || blogRuns.size} blog${(writing || blogRuns.size) === 1 ? '' : 's'} now.`);
  const inReview = rows.filter((r) => r.status === 'in_review');
  if (inReview.length) notes.push(`${inReview.length} blog${inReview.length === 1 ? '' : 's'} waiting for approval.`);
  const nextPlanned = rows.find((r) => r.status === 'planned' && !r.draft_id);
  if (nextPlanned) {
    const writeAt = toMs(nextPlanned.publish_at) - DRAFT_LEAD_HOURS * 3600000;
    notes.push(writeAt > now ? `Next blog, "${nextPlanned.title}", starts being written on ${fmt(writeAt)} (72 hours before its ${fmt(toMs(nextPlanned.publish_at))} slot). Until then "planned" is normal.` : `Next blog, "${nextPlanned.title}", is due to be written now; it starts at the next check.`);
  }
  const nextPub = rows.find((r) => ['in_review', 'planned', 'drafting'].includes(r.status));
  if (nextPub) notes.push(`Next to publish: "${nextPub.title}". ${publishPlan(nextPub, new Date(now)).headline}.`);
  if (last?.at) notes.push(`Last full run finished ${fmt(Date.parse(last.at))}${last.published || last.drafted || last.opened ? `: ${last.drafted} written, ${last.opened} sent for review, ${last.published} published` : ''}.`);

  return NextResponse.json({ level, label: level === 'green' ? 'Automation running' : level === 'amber' ? 'Running, needs attention' : 'Automation stopped', heartbeat: beat ? new Date(beat).toISOString() : null, problems, notes, strategy: strategy?.period || null });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
