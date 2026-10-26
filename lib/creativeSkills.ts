// Creative skills built from what the dashboard watched (lib/learning.ts): one skill per category
// (graphic design, typography, colour, logo, editing, motion, sound...), and the "creative-director"
// master skill that joins them: how the best practitioners think, their process, the quality bar, and
// a critique loop that keeps working until the result beats a strong designer's fifth attempt.
//
// Built with callClaude, so in Testing mode a build waits in the Claude Code queue (no API credits)
// and an automatic build waits for a person to press "Build skill".
import prisma from './prisma';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { slugOf, formatDuration } from './learningPlan';
import { CreditPausedError } from './aiCredits';
import { startTimer, endTimer } from './jobTimer';

export const MASTER = 'creative-director';
const MODEL = () => process.env.SKILL_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// About 110k tokens of notes per build; each video gets an equal share, long ones are cut.
const CATEGORY_INPUT_CHARS = 450_000;
const MASTER_INPUT_CHARS = 460_000;

const HOUSE = `Write in plain, precise English. No em dashes. No filler or hype words. Keep exact values (numbers, ratios, hex codes, font names, timings). Every rule must be specific enough to act on.`;

const CATEGORY_SYSTEM = (category: string, count: number) => `You are writing a SKILL file: the working knowledge an AI creative team uses for "${category}". Your source is a set of detailed watch-notes on ${count} YouTube video(s) by working professionals: what they said, what they showed on screen, and how they think.

Distil, do not summarise video by video. Merge what the creators agree on into firm rules, and where they disagree, say when each view applies. Prefer what was demonstrated over what was only claimed. Never add facts that are not in the notes; where the notes are thin, say so.

${HOUSE}

Return the skill between ===SKILL=== and ===END=== in exactly this structure:

---
name: ${slugOf(category)}
description: <one line: what this skill is for and when to load it>
---
# ${category}: how the best practitioners work

## The mindset
How masters of this craft think: the questions they ask, the order of their decisions, their mental models and taste. Write each as a reusable decision rule ("If ..., then ...").

## Principles
Numbered rules. Each: the rule; why it works; the exact values or ranges; when not to use it.

## Process
The method from brief to finished piece, step by step, tool-agnostic, with short tool notes (for example CapCut, Premiere Pro, DaVinci Resolve, After Effects, Illustrator, Figma, Blender) where the notes give them.

## Quality bar and critique loop
A rubric of 6 to 8 criteria with what 10/10 looks like for each. Then the loop: create at least 5 genuinely different directions; score each honestly against the rubric; drop the weakest and borrow the strengths of the others; refine the best two; run the checklist; ship only when every criterion is 9/10 or better.

## Checklist before shipping
Yes/no checks.

## Mistakes to avoid
Each mistake, why it hurts, and the fix.

## For USAIndiaCFO
How to apply this skill to a CFO and tax advisory firm serving Indian founders, NRIs and US-India businesses: LinkedIn and Instagram posts, carousels, short reels, explainer videos, blog covers and brand identity. The brand feels expert, trustworthy and clear: premium, never flashy.

## Sources
One line per video: title, channel.

Length: as long as the knowledge needs (usually 2,500 to 6,000 words).`;

const MASTER_SYSTEM = `You are writing the master SKILL for the dashboard's AI Creative Director. Your sources are the category skills below, each distilled from professional videos (design, typography, colour, logo, creativity, editing, motion, sound, voice, lighting, colour grading, VFX, animation, 3D).

Build the director's operating system:
- The thinking patterns that recur across crafts (for example: emotion and story first, hierarchy, contrast, restraint, rhythm, intention behind every element), each explained with its cross-craft evidence.
- The end-to-end creative process from brief to delivery, and which category skill to apply at each step.
- Taste: how to judge work, what separates good from excellent, and how to explain a judgement.
- The quality loop that makes every output better than a strong human designer's fifth or sixth attempt: diverge (at least 5 distinct directions), critique against a rubric, converge, refine, and verify, with the rubric written out.
- How to brief and review each specialist area (graphics, type, colour, logo, video edit, motion, sound, voice).
- Brand rules for USAIndiaCFO, a CFO and tax advisory firm for Indian founders, NRIs and US-India businesses: expert, trustworthy and clear; premium, never flashy.

Never add facts that are not in the sources.

${HOUSE}

Return the skill between ===SKILL=== and ===END===, starting with:

---
name: ${MASTER}
description: <one line>
---
# Creative Director: how to think, direct and judge

Then sections: ## The director's mindset, ## Patterns across every craft, ## The process from brief to delivery, ## Taste and judgement, ## The quality loop (with the rubric), ## Directing each specialist (one short block per category with the skill name to load), ## USAIndiaCFO brand rules, ## Sources (the category skills used).`;

const parse = (text: string) => {
  const m = /===SKILL===([\s\S]*?)===END===/.exec(text);
  return (m ? m[1] : text).trim();
};

// Shown in the header progress bar while a skill is built.
async function timed<T>(slug: string, label: string, fn: () => Promise<T>): Promise<T> {
  const key = `skill-${slug}`;
  startTimer(key, 'skill', label);
  try {
    const out = await fn();
    await endTimer(key, true);
    return out;
  } catch (e) {
    await endTimer(key, false);
    throw e;
  }
}

async function save(slug: string, category: string, content: string, sources: unknown[], actor: string) {
  const prev = await prisma.creative_skills.findFirst({ where: { slug, status: 'active' }, orderBy: { id: 'desc' } });
  await prisma.creative_skills.updateMany({ where: { slug, status: 'active' }, data: { status: 'old' } });
  const row = await prisma.creative_skills.create({ data: { slug, category, content, version: (prev?.version || 0) + 1, sources: JSON.stringify(sources), built_by: actor } });
  await activity.log('learning.skill_built', { entityType: 'creative_skill', entityId: row.id, details: `${category}: skill version ${row.version} built from ${sources.length} source(s)`, actor });
  return row;
}

// One category's skill from all its watched videos (the previous version is kept as "old").
export async function buildCategorySkill(category: string, actor = 'system') {
  const videos = await prisma.learning_videos.findMany({ where: { category, status: 'watched', notes: { not: null } }, orderBy: [{ sort_order: 'asc' }, { priority: 'asc' }, { id: 'asc' }] });
  if (!videos.length) throw Object.assign(new Error(`No watched video in "${category}" yet.`), { status: 409 });
  const share = Math.floor(CATEGORY_INPUT_CHARS / videos.length);
  const input = videos
    .map((v, i) => {
      const notes = String(v.notes || '');
      const cut = notes.length > share ? `${notes.slice(0, share)}\n[... the rest of these notes was cut to fit]` : notes;
      return `### Video ${i + 1}: "${v.title || v.url}"${v.channel ? ` by ${v.channel}` : ''} (${v.level || 'level not given'}, ${formatDuration(v.duration_sec || v.watched_seconds)})\n${cut}`;
    })
    .join('\n\n');
  const prev = await prisma.creative_skills.findFirst({ where: { slug: slugOf(category), status: 'active' }, orderBy: { id: 'desc' } });
  const user = `${prev ? `The current version of this skill is below. Improve it with everything in the notes: keep what is still right, fix what the notes contradict, and add what is new.\n\n<current_skill>\n${prev.content.slice(0, 60000)}\n</current_skill>\n\n` : ''}<watch_notes>\n${input}\n</watch_notes>`;
  const { text } = await timed(slugOf(category), `Building skill: ${category}`, () => callClaude(CATEGORY_SYSTEM(category, videos.length), [{ role: 'user', content: user }], undefined, { maxUses: 0, effort: 'high', model: MODEL(), feature: 'skills' }));
  const content = parse(text);
  if (content.length < 1500) throw new Error('The skill came back too short to use. Try again.');
  return save(slugOf(category), category, content, videos.map((v) => ({ video_id: v.video_id, title: v.title, channel: v.channel })), actor);
}

// The Creative Director skill from every category skill.
export async function buildMasterSkill(actor = 'system') {
  const skills = await prisma.creative_skills.findMany({ where: { status: 'active', slug: { not: MASTER } }, orderBy: { category: 'asc' } });
  if (skills.length < 2) throw Object.assign(new Error('Build at least two category skills first.'), { status: 409 });
  const share = Math.floor(MASTER_INPUT_CHARS / skills.length);
  const input = skills.map((s) => `<skill category="${s.category}" version="${s.version}">\n${s.content.slice(0, share)}\n</skill>`).join('\n\n');
  const { text } = await timed(MASTER, 'Building skill: Creative Director', () => callClaude(MASTER_SYSTEM, [{ role: 'user', content: input }], undefined, { maxUses: 0, effort: 'high', model: MODEL(), feature: 'skills' }));
  const content = parse(text);
  if (content.length < 1500) throw new Error('The skill came back too short to use. Try again.');
  return save(MASTER, 'Creative Director', content, skills.map((s) => ({ slug: s.slug, version: s.version })), actor);
}

// Per category: how many videos are watched or waiting, and whether the skill misses newer videos.
export async function skillsOverview() {
  const [videos, skills] = await Promise.all([
    prisma.learning_videos.findMany({ select: { video_id: true, category: true, status: true } }),
    prisma.creative_skills.findMany({ where: { status: 'active' }, select: { id: true, slug: true, category: true, version: true, sources: true, created_at: true, built_by: true } }),
  ]);
  const cats = [...new Set(videos.map((v) => v.category))].sort();
  const rows = cats.map((category) => {
    const vs = videos.filter((v) => v.category === category);
    const skill = skills.find((s) => s.slug === slugOf(category));
    const used = new Set<string>(skill ? JSON.parse(skill.sources || '[]').map((s: any) => s.video_id) : []);
    const watched = vs.filter((v) => v.status === 'watched');
    return {
      category,
      slug: slugOf(category),
      total: vs.length,
      watched: watched.length,
      waiting: vs.filter((v) => v.status === 'queued' || v.status === 'watching').length,
      newSinceBuild: watched.filter((v) => !used.has(v.video_id)).length,
      skill: skill ? { id: skill.id, version: skill.version, created_at: skill.created_at, built_by: skill.built_by, sources: used.size } : null,
    };
  });
  const master = skills.find((s) => s.slug === MASTER) || null;
  const newestCategory = skills.filter((s) => s.slug !== MASTER).reduce((m, s) => (s.created_at > m ? s.created_at : m), '');
  return { categories: rows, master: master ? { id: master.id, version: master.version, created_at: master.created_at, outdated: newestCategory > master.created_at } : null, categorySkills: skills.filter((s) => s.slug !== MASTER).length };
}

export async function skillContent(slug: string) {
  return prisma.creative_skills.findFirst({ where: { slug, status: 'active' }, orderBy: { id: 'desc' } });
}

// The text of the given skills (active versions), for a prompt that should follow them. Missing ones
// are left out.
export async function skillsForPrompt(slugs: string[], maxCharsEach = 40000) {
  const rows = await prisma.creative_skills.findMany({ where: { slug: { in: slugs }, status: 'active' } });
  return slugs
    .map((s) => rows.find((r) => r.slug === s))
    .filter(Boolean)
    .map((r) => `<skill name="${r!.slug}" version="${r!.version}">\n${r!.content.slice(0, maxCharsEach)}\n</skill>`)
    .join('\n\n');
}

// After videos are watched: a category with nothing left to watch and new notes gets its skill
// rebuilt, and the master skill follows once at least three category skills exist. In Testing mode
// (automatic work does not use AI) this waits for a person to press "Build skill".
export async function autoBuild() {
  const o = await skillsOverview();
  let built = 0;
  for (const c of o.categories) {
    if (c.waiting || !c.newSinceBuild) continue;
    try {
      await buildCategorySkill(c.category, 'Automatic (all videos in the category watched)');
      built++;
    } catch (e: any) {
      if (e instanceof CreditPausedError) return { built, waiting: true };
      console.error(`Skill build failed for ${c.category}:`, e.message);
    }
  }
  if (built && (await skillsOverview()).categorySkills >= 3) {
    await buildMasterSkill('Automatic (category skills changed)').catch((e) => {
      if (!(e instanceof CreditPausedError)) console.error('Master skill build failed:', e.message);
    });
  }
  return { built };
}
