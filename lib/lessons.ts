// @ts-nocheck -- reads untyped JSON columns and Search Console rows.
// Self-improvement: once a week the dashboard reads what went wrong and what worked (reviewers'
// rejection feedback, blogs the checks held, repair issues, facts the checkers corrected, and how
// each published post is doing in Google) and keeps a short list of lessons. The blog writer, the
// strategy and the task guides all follow these lessons from then on.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { callClaude } from './anthropic';
import { querySearchAnalytics, comparisonRanges } from './searchConsole';
import { timed } from './jobTimer';

const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

export async function gatherEvidence(days = 60) {
  const since = ago(days);
  const rows = await prisma.blog_schedule.findMany({ where: { updated_at: { gte: since } } });
  const rejections = rows.filter((r) => r.reject_feedback).map((r) => `"${r.title}": ${r.reject_feedback}`);
  const holds = rows.flatMap((r) => JSON.parse(r.hold_reasons || '[]').map((h) => `"${r.title}": ${h}`));
  const factChecks = rows
    .map((r) => (r.fact_check ? { title: r.title, ...JSON.parse(r.fact_check) } : null))
    .filter(Boolean)
    .map((f) => `"${f.title}": ${f.ok ? 'verified' : 'NOT verified'} after ${f.rounds} round(s), ${(f.log || []).reduce((n, l) => n + (l.wrong || 0), 0)} claim(s) corrected`);
  const drafts = await prisma.drafts.findMany({ where: { created_at: { gte: since } }, select: { title: true, validation_issues: true, repair_attempts: true } });
  const repairs = drafts.filter((d) => d.repair_attempts > 0).map((d) => `"${d.title}": ${JSON.parse(d.validation_issues || '[]').slice(0, 4).join(' | ') || `${d.repair_attempts} repair round(s)`}`);
  const guides = await prisma.activity_log.findMany({ where: { created_at: { gte: since }, action: { in: ['strategy.manual_guide_regenerated'] } }, select: { details: true } }).catch(() => []);

  // Results: clicks, impressions and position of each published post over the last 28 days.
  let results = [];
  const published = rows.filter((r) => r.wp_post_url).concat(await prisma.blog_schedule.findMany({ where: { status: 'published', wp_post_url: { not: null } }, take: 60, orderBy: { id: 'desc' } }));
  try {
    const { current } = comparisonRanges(28);
    const pages = await querySearchAnalytics({ ...current, dimensions: ['page'], rowLimit: 1000 });
    const byUrl = new Map(pages.map((p) => [p.keys[0].replace(/\/+$/, ''), p]));
    const seen = new Set();
    for (const r of published) {
      const url = r.wp_post_url.replace(/\/+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      const p = byUrl.get(url);
      results.push(`"${r.title}" (${r.main_keyword}): ${p ? `${p.clicks} clicks, ${p.impressions} impressions, average position ${p.position.toFixed(1)}` : 'no Google data yet'}`);
    }
  } catch (e) {
    results = [`Search Console unavailable: ${e.message}`];
  }
  return { rejections, holds, factChecks, repairs, guides: guides.map((g) => g.details), results };
}

export async function learnLessons({ write = callClaude } = {}) {
  return timed('lessons', 'lessons', 'Learning from reviews and results', async () => {
    const e = await gatherEvidence();
    const total = e.rejections.length + e.holds.length + e.repairs.length + e.results.length + e.factChecks.length;
    if (!total) return { skipped: 'Nothing new to learn from yet' };
    const previous = String((await settings.get('writer_lessons')) || '');
    const { text } = await write(
      `You improve a content team's process. From the evidence, write the 6-12 most useful lessons for writing, fact-checking and planning USAIndiaCFO blogs (US-India cross-border tax and compliance). Each lesson is one plain-English sentence starting with a verb, specific enough to act on (name the mistake to avoid or the pattern that worked, with the topic), never generic advice. Keep earlier lessons that still hold, merge duplicates, drop ones the new evidence contradicts. Base lessons only on the evidence given; never invent results. No em dashes. Return ONLY the lessons, one per line, each starting with "- ".`,
      [
        {
          role: 'user',
          content: `Earlier lessons:\n${previous || '(none)'}\n\nReviewer rejections:\n${e.rejections.join('\n') || '(none)'}\n\nBlogs held by the checks:\n${e.holds.join('\n') || '(none)'}\n\nWriter repair issues:\n${e.repairs.join('\n') || '(none)'}\n\nFact checks:\n${e.factChecks.join('\n') || '(none)'}\n\nResults of published posts (last 28 days):\n${e.results.join('\n') || '(none)'}`.slice(0, 60000),
        },
      ],
      undefined,
      { maxUses: 1, effort: 'medium', feature: 'lessons' }
    );
    const lessons = text.split('\n').map((l) => l.trim()).filter((l) => /^- /.test(l)).slice(0, 12).join('\n');
    if (!lessons) return { skipped: 'No lessons in the reply' };
    await settings.set('writer_lessons', lessons);
    await settings.set('writer_lessons_at', new Date().toISOString().slice(0, 10));
    await activity.log('lessons.updated', { details: `${lessons.split('\n').length} lesson(s) from ${e.rejections.length} rejection(s), ${e.holds.length} hold(s), ${e.repairs.length} repair(s) and ${e.results.length} post result(s)` });
    return { lessons };
  });
}

// The lessons as a prompt section, for the strategy and the task guides.
export async function lessonsBlock() {
  const l = String((await settings.get('writer_lessons')) || '').trim();
  return l ? `\n\nLESSONS LEARNED from our own reviews, holds, corrections and results (follow them):\n${l}` : '';
}
