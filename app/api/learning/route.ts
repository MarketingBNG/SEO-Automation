import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import * as activity from '@/lib/activity';
import { getActor, getMe } from '@/lib/auth';
import { addLinks, learningOverview, learningTick, learningRunning } from '@/lib/learning';
import { priorityOf } from '@/lib/learningPlan';
import { buildCategorySkill, buildMasterSkill, skillsOverview } from '@/lib/creativeSkills';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// Learn from YouTube: the videos, the day's watch budget and the skills built from them.
export async function GET() {
  return NextResponse.json({ ...(await learningOverview()), skills: await skillsOverview() });
}

// { action, ... }:
//   add { links, category? }       links pasted one per line
//   watch_now { id }               watch this video next, starting now
//   retry { id } / skip { id } / remove { id }
//   budget { hours }               hours of video a day (admin; Gemini's free tier allows 8)
//   resume                         carry on today after Gemini's limit message
//   build_skill { category }       (re)build one category's skill now
//   build_master                   (re)build the Creative Director skill now
export async function POST(req: NextRequest) {
  const b: any = (await req.json().catch(() => ({}))) || {};
  const actor = await getActor();
  const id = Number(b.id);
  try {
    if (b.action === 'add') {
      const r = await addLinks(String(b.links || ''), b.category ? String(b.category).slice(0, 80) : null, actor);
      if (r.added || r.requeued) void learningTick().catch(() => {});
      return NextResponse.json(r);
    }
    if (b.action === 'watch_now') {
      const v = await prisma.learning_videos.findUnique({ where: { id } });
      if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      if (v.status === 'watched') return NextResponse.json({ error: 'Already watched.' }, { status: 409 });
      if (learningRunning()) return NextResponse.json({ error: 'A video is being watched right now. This one goes first after it.' }, { status: 409 });
      await prisma.learning_videos.update({ where: { id }, data: { priority: -1, status: v.parts_done ? 'watching' : 'queued', error: null } });
      void learningTick({ only: id }).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'retry' || b.action === 'skip') {
      const v = await prisma.learning_videos.findUnique({ where: { id } });
      if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      const status = b.action === 'skip' ? 'skipped' : v.parts_done ? 'watching' : 'queued';
      await prisma.learning_videos.update({ where: { id }, data: { status, error: null, priority: b.action === 'retry' ? priorityOf(v) : v.priority } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'remove') {
      const v = await prisma.learning_videos.findUnique({ where: { id } });
      if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      if (v.status === 'watching' && learningRunning()) return NextResponse.json({ error: 'It is being watched right now.' }, { status: 409 });
      await prisma.learning_videos.delete({ where: { id } });
      await activity.log('learning.removed', { entityType: 'learning_video', entityId: id, details: `Removed "${v.title || v.url}" from Learn from YouTube`, actor });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'budget') {
      const me = await getMe();
      if (me?.role !== 'admin') return NextResponse.json({ error: 'Only an admin can change the daily hours.' }, { status: 403 });
      const hours = Number(b.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 200) return NextResponse.json({ error: 'Give the hours of video per day (for example 8).' }, { status: 400 });
      await settings.set('learning_daily_hours', String(hours));
      await activity.log('learning.budget', { details: `Learn from YouTube: up to ${hours} hours of video a day`, actor });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'resume') {
      await settings.set('learning_paused_until', '');
      void learningTick().catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'build_skill' || b.action === 'build_master') {
      // A build takes a few minutes (or waits for Claude Code in Testing mode): it runs on in the
      // background and shows in the header progress bar.
      const run = b.action === 'build_master' ? buildMasterSkill(actor) : buildCategorySkill(String(b.category || ''), actor);
      void run.catch((e: any) => activity.log('learning.skill_failed', { details: `${b.category || 'Creative Director'}: ${String(e.message || e).slice(0, 200)}`, actor }).catch(() => {}));
      return NextResponse.json({ ok: true, note: 'Building now. It shows in the progress bar at the top; in Testing mode it waits for Claude Code ("run the SEO AI queue").' }, { status: 202 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    if (!e.status) console.error(e);
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
