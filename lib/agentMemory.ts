// Agent memory: what each dashboard agent has learned, so every result is better than the last and an
// old mistake is never made twice. Memories come from reviewers' rejections, the fact checker's
// corrections, the weekly lessons, the team's own rules ("Teach this agent"), incidents the Ops agent
// finds, and development changes (CHANGELOG.md).
//
// The same lesson seen again raises its strength instead of adding a copy (one row per agent + key).
// Before an agent works, recall() gives it its strongest and newest memories, mistakes first.
import crypto from 'crypto';
import prisma from './prisma';
import * as settings from './settings';
import { sqlNow } from './time';

export type MemoryKind = 'mistake' | 'lesson' | 'preference' | 'incident' | 'change' | 'fact';

// Same words, same memory: lower case, letters and digits only, first 120 characters. A title with no
// Latin letters or digits (for example written in Devanagari) is keyed by a hash of its text.
export const memoryKey = (title: string) => {
  const t = String(title || '').trim();
  const k = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
  return k || (t ? `h${crypto.createHash('sha1').update(t).digest('hex').slice(0, 16)}` : '');
};

const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// bump: false records it without counting a repeat (for sources read again and again, like CHANGELOG.md).
export async function remember(m: { agent: string; kind: MemoryKind; title: string; body?: string; source: string; sourceRef?: string | null; by?: string | null; bump?: boolean }) {
  const title = clean(m.title, 200);
  const key = memoryKey(title);
  if (!key) return null;
  const body = clean(m.body || m.title, 1500);
  const now = sqlNow();
  const existing = await prisma.agent_memories.findUnique({ where: { agent_key: { agent: m.agent, key } } });
  if (existing) {
    if (m.bump === false) return existing;
    return prisma.agent_memories.update({
      where: { id: existing.id },
      data: { strength: existing.strength + 1, last_seen_at: now, status: 'active', resolved_at: m.kind === 'incident' ? null : existing.resolved_at, ...(body.length > existing.body.length ? { body } : {}), ...(m.sourceRef ? { source_ref: m.sourceRef } : {}) },
    });
  }
  return prisma.agent_memories.create({ data: { agent: m.agent, kind: m.kind, title, key, body, source: m.source, source_ref: m.sourceRef || null, created_by: m.by || null } });
}

// The prompt block for an agent: its active memories (plus related ones from `also`), mistakes and
// the team's rules first, then by strength and how recent they are.
//
// The block is a snapshot taken once a day (UTC) and kept in settings, so a blog or strategy run that
// restarts the same day sends exactly the same prompts and its saved steps are reused (lib/aiReplay.ts
// matches steps by their prompt). New memories apply from the next day, or at once after "Teach".
export async function recall(agent: string, opts: { also?: string[]; limit?: number; kinds?: MemoryKind[] } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `memory_snapshot:${agent}:${(opts.also || []).join(',')}:${opts.limit || 25}:${(opts.kinds || []).join(',')}`;
  const saved = JSON.parse((await settings.get(key).catch(() => null)) || 'null');
  if (saved?.day === day) return String(saved.text || '');
  const text = await buildRecall(agent, opts);
  await settings.set(key, JSON.stringify({ day, text })).catch(() => {});
  return text;
}

// After the team teaches an agent, its next run uses the new memory at once.
export async function refreshRecall(agent: string) {
  const rows = await prisma.settings.findMany({ where: { key: { startsWith: 'memory_snapshot:' } }, select: { key: true } }).catch(() => []);
  for (const r of rows) {
    const [, main, also = ''] = r.key.split(':');
    if (main === agent || also.split(',').includes(agent)) await settings.set(r.key, '').catch(() => {});
  }
}

async function buildRecall(agent: string, { also = [] as string[], limit = 25, kinds }: { also?: string[]; limit?: number; kinds?: MemoryKind[] } = {}) {
  const rows = await prisma.agent_memories
    .findMany({ where: { agent: { in: [agent, ...also] }, status: 'active', ...(kinds ? { kind: { in: kinds } } : {}) }, orderBy: [{ strength: 'desc' }, { last_seen_at: 'desc' }], take: 200 })
    .catch(() => []);
  const rank = (k: string) => (k === 'mistake' ? 0 : k === 'preference' ? 1 : k === 'lesson' ? 2 : 3);
  const picked = rows.sort((a, b) => rank(a.kind) - rank(b.kind) || b.strength - a.strength || b.last_seen_at.localeCompare(a.last_seen_at)).slice(0, limit);
  if (!picked.length) return '';
  await prisma.agent_memories.updateMany({ where: { id: { in: picked.map((p) => p.id) } }, data: { uses: { increment: 1 } } }).catch(() => {});
  const line = (p: (typeof picked)[number]) => `- [${p.kind}${p.strength > 1 ? `, seen ${p.strength}x` : ''}] ${p.body}`;
  return `MEMORY (what this team has learned from past work; follow it, and never repeat a past mistake):\n${picked.map(line).join('\n')}`;
}

// Incidents the Ops agent no longer sees are marked resolved (kept, so a repeat is recognised).
export async function resolveIncidents(agent: string, stillOpen: string[]) {
  const open = new Set(stillOpen.map(memoryKey));
  const rows = await prisma.agent_memories.findMany({ where: { agent, kind: 'incident', status: 'active', resolved_at: null } });
  for (const r of rows) if (!open.has(r.key)) await prisma.agent_memories.update({ where: { id: r.id }, data: { resolved_at: sqlNow() } });
}

// Weekly tidy-up: a memory seen once, never used and older than 180 days is retired (it can be
// brought back from the Agents page).
export async function tidyMemories() {
  const before = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const r = await prisma.agent_memories.updateMany({ where: { status: 'active', strength: 1, uses: 0, last_seen_at: { lt: before }, kind: { notIn: ['preference', 'change'] } }, data: { status: 'retired' } });
  return r.count;
}
