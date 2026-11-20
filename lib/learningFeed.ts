// The Learning page: what the team changed in blogs, what the writer has learned from it, and what
// the team asks the dashboard for (keywords researched, topics taken up, assistant questions,
// audits). Shared by GET /api/learning and the assistant's learning_feed.
import prisma from '@/lib/prisma';
import * as settings from '@/lib/settings';
import { recentChanges } from '@/lib/contentChanges';
import { mineOnly } from '@/lib/assistant/conversations';

const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

// me: the signed-in person. Assistant questions are their own chats only (an admin sees everyone's);
// without a person, none are listed.
export async function learningFeed(me: { email: string; name?: string; role: string } | null | undefined) {
  const since = ago(30);
  const own = mineOnly(me);
  const [changes, memories, keywords, topics, conversations, actions] = await Promise.all([
    recentChanges(60),
    prisma.agent_memories.findMany({ where: { agent: 'writer', status: 'active' }, orderBy: [{ strength: 'desc' }, { last_seen_at: 'desc' }], take: 40, select: { id: true, kind: true, body: true, source: true, strength: true, last_seen_at: true } }),
    prisma.keywords.findMany({ where: { created_at: { gte: since } }, orderBy: { id: 'desc' }, take: 40, select: { keyword: true, batch_name: true, status: true, created_at: true } }),
    prisma.topics.findMany({ where: { status: { not: 'new' } }, orderBy: { id: 'desc' }, take: 20, select: { title: true, status: true, day: true, pillar: true } }),
    !me ? Promise.resolve([]) : prisma.assistant_conversations.findMany({ where: { created_at: { gte: since }, ...(own || {}) }, orderBy: { id: 'desc' }, take: 25, select: { title: true, created_by: true, created_at: true } }).catch(() => []),
    prisma.activity_log.groupBy({ by: ['action'], where: { created_at: { gte: since }, source: { not: 'automatic' } }, _count: { _all: true }, orderBy: { _count: { action: 'desc' } }, take: 20 }).catch(() => []),
  ]);
  let weeklyLessons: string[] = [];
  try {
    weeklyLessons = String((await settings.get('writer_lessons')) || '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  } catch {}
  return {
    changes,
    lessons: { fromEdits: memories.filter((m) => m.source === 'edits'), other: memories.filter((m) => m.source !== 'edits'), weekly: weeklyLessons, lastEditLearning: (await settings.get('change_lessons_at')) || null },
    searches: {
      keywords,
      topics,
      questions: (conversations as any[]).map((c) => ({ title: c.title, by: c.created_by, at: c.created_at })),
      actions: (actions as any[]).map((a) => ({ action: a.action, count: a._count._all })),
      sinceDays: 30,
    },
  };
}
