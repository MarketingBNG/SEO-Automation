// Learn from YouTube: the dashboard watches videos with Gemini (lib/gemini.ts) and keeps notes on what
// each one teaches, what it shows on screen, and how its creator thinks. The notes become creative
// skills (lib/creativeSkills.ts) that the dashboard's design work follows.
//
// Videos are added one link at a time or as a whole spreadsheet (the learning library). The scheduler
// watches them in order (lib/learningPlan.ts: short lessons first, long courses last), within a daily
// hour budget (Gemini's free tier allows 8 hours of YouTube video a day; an admin can raise it once
// billing is on). A long video is watched in parts and its notes grow part by part, so a restart or
// the daily limit never loses what was watched.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { sqlNow } from './time';
import { startTimer, endTimer } from './jobTimer';
import { watchVideo, geminiKey, GeminiError } from './gemini';
import { CATEGORIES, libraryRow, planParts, priorityOf, quotaDay, youtubeId, watchUrl, formatDuration, type LibraryRow } from './learningPlan';

const g = globalThis as unknown as { __learningRunning?: boolean };

// ---------- The watch prompt ----------

export function watchPrompt(v: { title?: string | null; channel?: string | null; category: string; level?: string | null }, part?: { index: number; total: number; start: number; end: number }) {
  const known = v.category && v.category !== 'General';
  return `You are a senior creative director and a patient teacher. You are watching this video closely so that an AI design and video team can learn from it as well as a talented apprentice who sat beside the creator. Watch the frames AND listen to the audio: capture what is SAID and what is SHOWN.

Video: "${v.title || 'unknown title'}"${v.channel ? ` by ${v.channel}` : ''}${known ? ` (category: ${v.category}${v.level ? `, level: ${v.level}` : ''})` : ''}.
${part ? `This request covers PART ${part.index + 1} of ${part.total}: from ${formatDuration(part.start)} to ${formatDuration(part.end)} of the video. Take notes on this part only; do not repeat introductions from earlier parts.\n` : ''}
Rules:
- Be concrete. Keep exact numbers, settings, keyboard shortcuts, hex colour codes, font names, sizes, ratios, durations (seconds or frames), easing curves, and before/after differences.
- When the creator demonstrates something visually, describe precisely what changed on screen and why the result is better.
- Never invent anything. If something cannot be seen or heard clearly, say so in section 10.
- Write in clear, plain English. Use the creator's own reasoning wherever they give it.

Use exactly these headings:

## 1. What this video teaches
Three to five lines: the main lesson, who it is for, and what someone can do after watching.

## 2. Core principles
For each principle: **the rule** (what to do), *why it works* (the reasoning given or shown), *when not to use it*, and *shown as* (the on-screen example).

## 3. Step-by-step methods
Numbered workflows exactly as performed, with tools, settings and values. Mark the steps that matter most with (KEY).

## 4. What the screen showed
The important visuals in detail: layouts, compositions, colour values, type choices, the timing of cuts or animations, and before-versus-after comparisons with what made the "after" better.

## 5. How the creator thinks
This is the most important section. Describe the mental model behind the work so another designer can think the same way:
- the questions they ask themselves, and in what order they make decisions;
- their rules of thumb, written as "If ..., then ..." decisions;
- what they look at first when judging work, and what "good" means to them (their taste);
- how they generate ideas, choose between options, and recover from a weak result;
- analogies or metaphors they use to explain their thinking.

## 6. Mistakes they warn about
Each mistake, why it hurts, and the fix.

## 7. Quality checklist
Yes/no checks a reviewer can apply to finished work, taken from this video.

## 8. Memorable lines
Up to five short quotes that capture the mindset (word for word where possible), with timestamps.

## 9. Use for a CFO / tax advisory brand
How to apply this to USAIndiaCFO's work: LinkedIn and Instagram posts, carousels, short reels, explainer videos, blog cover images and the brand identity. The brand should feel expert, trustworthy and clear: premium, never flashy.

## 10. Gaps and uncertainty
What could not be seen or heard clearly, and anything tied to one software version.
${known ? '' : `\nFinally, on the last line write "CATEGORY: " followed by the one category from this list that fits best: ${CATEGORIES.join('; ')}. If none fits, write a short new category name.`}
Length: as long as the teaching needs and no longer (about 1,500 to 4,000 words; a long course part may need more).`;
}

// ---------- Adding videos ----------

export async function addVideos(rows: LibraryRow[], actor?: string | null) {
  let added = 0;
  let requeued = 0;
  let kept = 0;
  for (const r of rows) {
    const existing = await prisma.learning_videos.findUnique({ where: { video_id: r.video_id } });
    const priority = priorityOf(r);
    if (!existing) {
      await prisma.learning_videos.create({ data: { ...r, priority, added_by: actor || null } });
      added++;
    } else if (existing.status === 'failed' || existing.status === 'skipped') {
      // Added again after it failed or was skipped: try it once more (keeping what was watched).
      await prisma.learning_videos.update({ where: { id: existing.id }, data: { status: existing.parts_done ? 'watching' : 'queued', error: null } });
      requeued++;
    } else {
      // Better details from the library (title, category, length) fill what the link alone lacked.
      const fill: any = {};
      for (const k of ['title', 'channel', 'level', 'duration_sec', 'note', 'sort_order'] as const) if (!existing[k] && r[k]) fill[k] = r[k];
      if (existing.category === 'General' && r.category !== 'General') fill.category = r.category;
      if (Object.keys(fill).length) await prisma.learning_videos.update({ where: { id: existing.id }, data: { ...fill, priority: priorityOf({ ...existing, ...fill }) } });
      kept++;
    }
  }
  if (added || requeued) await activity.log('learning.added', { details: `${added} video(s) added to Learn from YouTube${requeued ? `, ${requeued} queued again` : ''}${kept ? `, ${kept} already there` : ''}`, actor: actor || undefined });
  return { added, requeued, kept };
}

// Links pasted one per line (any YouTube link form), with an optional category for all of them.
export async function addLinks(text: string, category: string | null, actor?: string | null) {
  const rows: LibraryRow[] = [];
  const bad: string[] = [];
  for (const line of String(text || '').split(/[\s,]+/).filter(Boolean)) {
    const id = youtubeId(line);
    if (!id) {
      bad.push(line.slice(0, 80));
      continue;
    }
    if (rows.some((r) => r.video_id === id)) continue;
    rows.push({ video_id: id, url: watchUrl(id), title: null, channel: null, category: category || 'General', sort_order: null, level: null, duration_sec: null, note: null });
  }
  // The title and channel from YouTube's public oEmbed page, when it answers (not required).
  for (const r of rows) {
    const o: any = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(r.url)}`, { signal: AbortSignal.timeout(8000) })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (o?.title) r.title = String(o.title).slice(0, 300);
    if (o?.author_name) r.channel = String(o.author_name).slice(0, 120);
  }
  return { ...(await addVideos(rows, actor)), invalid: bad };
}

// The learning library spreadsheet (every sheet with a YouTube link column).
export async function importSpreadsheet(buffer: Buffer, actor?: string | null) {
  const XLSX = await import('xlsx');
  const book = XLSX.read(buffer);
  const rows: LibraryRow[] = [];
  for (const name of book.SheetNames) {
    for (const raw of XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: '' })) {
      const r = libraryRow(raw);
      if (r && !rows.some((x) => x.video_id === r.video_id)) rows.push(r);
    }
  }
  if (!rows.length) throw Object.assign(new Error('No YouTube links found. The sheet needs a "YouTube Link" (or "Video ID") column.'), { status: 400 });
  return { found: rows.length, ...(await addVideos(rows, actor)) };
}

// ---------- The daily budget ----------

export async function dailyHours() {
  const v = Number(await settings.get('learning_daily_hours'));
  return Number.isFinite(v) && v > 0 ? v : 8;
}

async function usedToday(): Promise<number> {
  const b = JSON.parse((await settings.get('learning_budget')) || '{}');
  return b.day === quotaDay() ? Number(b.seconds) || 0 : 0;
}

async function spend(seconds: number) {
  const day = quotaDay();
  const b = JSON.parse((await settings.get('learning_budget')) || '{}');
  const used = b.day === day ? Number(b.seconds) || 0 : 0;
  await settings.set('learning_budget', JSON.stringify({ day, seconds: used + seconds }));
}

export async function budgetStatus() {
  const hours = await dailyHours();
  const used = await usedToday();
  const pausedUntil = (await settings.get('learning_paused_until')) || null;
  return { dailyHours: hours, usedSeconds: used, leftSeconds: Math.max(0, hours * 3600 - used), day: quotaDay(), pausedUntil: pausedUntil && pausedUntil === quotaDay() ? pausedUntil : null };
}

// ---------- Watching ----------

const PART_HEADING = (i: number, total: number, start: number, end: number) => `\n\n---\n# Part ${i + 1} of ${total} (${formatDuration(start)} to ${formatDuration(end)})\n\n`;

// Watches what is left of one video, part by part, within the budget. Returns false when the budget
// ran out before the video was finished (it stays "watching" and continues next time).
async function watchOne(id: number, budgetLeft: () => Promise<number>): Promise<boolean> {
  let v = await prisma.learning_videos.findUnique({ where: { id } });
  if (!v) return true;
  const parts = planParts(v.duration_sec);
  const total = parts ? parts.length : 1;
  await prisma.learning_videos.update({ where: { id }, data: { status: 'watching', parts_total: total, error: null } });
  for (let i = v.parts_done; i < total; i++) {
    const part = parts ? parts[i] : null;
    const seconds = part ? part.end - part.start : v.duration_sec || 1800;
    if ((await budgetLeft()) < seconds) return false;
    const prompt = watchPrompt(v, part ? { index: i, total, start: part.start, end: part.end } : undefined);
    // Shown in the header progress bar while Gemini watches.
    const key = `learn-${id}`;
    startTimer(key, 'learning', `Watching: ${v.title || v.url}${total > 1 ? ` (part ${i + 1} of ${total})` : ''}`);
    let r;
    try {
      r = await watchVideo({ url: v.url, prompt, ...(part ? { startSec: part.start, endSec: part.end } : {}) });
      await endTimer(key, true);
    } catch (e) {
      await endTimer(key, false);
      throw e;
    }
    let text = r.text;
    const data: any = {};
    // A video added by link alone: Gemini names its category on the last line.
    const cat = /\n\s*CATEGORY:\s*(.+)\s*$/i.exec(text);
    if (cat) {
      text = text.slice(0, cat.index).trim();
      if (v.category === 'General') data.category = cat[1].trim().replace(/[.*"]+$/g, '').slice(0, 80);
    }
    const notes = (v.notes || '') + (total > 1 ? PART_HEADING(i, total, part!.start, part!.end) : '') + text;
    v = await prisma.learning_videos.update({
      where: { id },
      data: { ...data, notes, parts_done: i + 1, model: r.model, tokens_in: v.tokens_in + r.tokensIn, tokens_out: v.tokens_out + r.tokensOut, watched_seconds: v.watched_seconds + seconds },
    });
    await spend(seconds);
  }
  await prisma.learning_videos.update({ where: { id }, data: { status: 'watched', watched_at: sqlNow(), priority: priorityOf(v) } });
  await activity.log('learning.watched', { entityType: 'learning_video', entityId: id, details: `Watched "${v.title || v.url}" (${v.category}, ${formatDuration(v.duration_sec || v.watched_seconds)}): notes ready` });
  return true;
}

// The next video: one already part-watched first, then the queue in watch order.
async function nextVideo(only?: number) {
  if (only) return prisma.learning_videos.findFirst({ where: { id: only, status: { in: ['queued', 'watching'] } } });
  return (
    (await prisma.learning_videos.findFirst({ where: { status: 'watching' }, orderBy: { id: 'asc' } })) ||
    (await prisma.learning_videos.findFirst({ where: { status: 'queued' }, orderBy: [{ priority: 'asc' }, { id: 'asc' }] }))
  );
}

// Watches videos until the day's budget or this run's time is used up. Called by the scheduler every
// 15 minutes, and at once when someone presses "Watch now".
export async function learningTick({ only, maxMinutes = 12 }: { only?: number; maxMinutes?: number } = {}) {
  if (!geminiKey() || g.__learningRunning) return { skipped: true };
  if ((await settings.get('learning_paused_until')) === quotaDay() && !only) return { skipped: true, reason: 'Gemini limit reached today' };
  g.__learningRunning = true;
  const started = Date.now();
  const out = { watched: 0, failed: 0, stopped: '' };
  try {
    const left = async () => (await dailyHours()) * 3600 - (await usedToday());
    while (Date.now() - started < maxMinutes * 60000) {
      const v = await nextVideo(only);
      if (!v) break;
      try {
        const done = await watchOne(v.id, left);
        if (!done) {
          out.stopped = 'daily budget used';
          break;
        }
        out.watched++;
      } catch (e: any) {
        if (e instanceof GeminiError && e.quota) {
          // Gemini's own limit for today: everything waits until tomorrow (Pacific time).
          await settings.set('learning_paused_until', quotaDay());
          await prisma.learning_videos.update({ where: { id: v.id }, data: { status: v.parts_done ? 'watching' : 'queued', error: `Waiting: ${e.message}` } });
          out.stopped = 'Gemini limit reached';
          break;
        }
        await prisma.learning_videos.update({ where: { id: v.id }, data: { status: 'failed', error: String(e.message || e).slice(0, 500) } });
        await activity.log('learning.failed', { entityType: 'learning_video', entityId: v.id, details: `"${v.title || v.url}": ${String(e.message || e).slice(0, 200)}` });
        out.failed++;
        if (out.failed >= 3 || only) break;
      }
      if (only) break;
    }
  } finally {
    g.__learningRunning = false;
  }
  // A category whose videos are all watched gets its skill (re)built (lib/creativeSkills.ts). In
  // Testing mode the automatic build waits for a person to press "Build skill".
  if (out.watched) await import('./creativeSkills').then((m) => m.autoBuild()).catch((e) => console.error('Learning: skill build failed:', e.message));
  return out;
}

export const learningRunning = () => Boolean(g.__learningRunning);

// ---------- Reading ----------

export async function learningOverview() {
  const videos = await prisma.learning_videos.findMany({
    orderBy: [{ category: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
    select: { id: true, video_id: true, url: true, title: true, channel: true, category: true, sort_order: true, level: true, duration_sec: true, note: true, priority: true, status: true, parts_total: true, parts_done: true, error: true, model: true, tokens_in: true, tokens_out: true, watched_seconds: true, created_at: true, watched_at: true },
  });
  const upNext = await prisma.learning_videos.findMany({ where: { status: { in: ['watching', 'queued'] } }, orderBy: [{ status: 'desc' }, { priority: 'asc' }, { id: 'asc' }], take: 5, select: { id: true, title: true, category: true, duration_sec: true, status: true } });
  return { videos, upNext, budget: await budgetStatus(), running: learningRunning(), gemini: Boolean(geminiKey()) };
}
