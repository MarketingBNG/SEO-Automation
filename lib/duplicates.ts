// K10: blocks a keyword that repeats a topic we already have (a keyword in the pipeline, a blog in a
// strategy, or a published post), before it enters the pipeline. Returns the reason, or null.
import prisma from './prisma';
import { duplicateOf } from './strategy/core';

export async function existingTopics() {
  const [kws, sched, drafts] = await Promise.all([
    prisma.keywords.findMany({ where: { status: { notIn: ['failed', 'rejected'] } }, select: { keyword: true, status: true } }),
    prisma.blog_schedule.findMany({ where: { status: { not: 'failed' } }, select: { main_keyword: true, title: true, status: true } }),
    prisma.drafts.findMany({ where: { status: 'published' }, select: { title: true, wp_post_url: true } }),
  ]);
  return [
    ...kws.map((k) => ({ keyword: k.keyword, where: `already in the Keywords list (${k.status})` })),
    ...sched.map((s) => ({ keyword: s.main_keyword, where: `already planned as "${s.title}" (${s.status})` })),
    ...sched.map((s) => ({ keyword: s.title, where: `already planned as "${s.title}" (${s.status})` })),
    ...drafts.map((d) => ({ keyword: d.title || '', where: `already published: ${d.wp_post_url}` })),
  ].filter((e) => e.keyword);
}

export async function duplicateReason(keyword: string, existing?: { keyword: string; where: string }[]) {
  const hit = duplicateOf(keyword, existing || (await existingTopics()));
  return hit ? `"${keyword}" repeats "${hit.keyword}", ${hit.where}. Pick a different angle or refresh that page instead.` : null;
}
