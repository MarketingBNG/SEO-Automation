// The record of every change to a blog's words: who, when, how much and what (lib/contentDiff.ts),
// for the team to see and for the writer to learn from (lib/learnFromChanges.ts). A re-upload in
// Check a blog is matched to the earlier upload of the same piece, so the audit re-verifies what
// changed first.
import prisma from './prisma';
import { articleSimilarity, diffContent, normalize, type ChangeReport } from './contentDiff';

export type ChangeKind = 'edit' | 'upload' | 'reupload' | 'optimise' | 'rewrite' | 'restore';
export type EntityType = 'draft' | 'audit';
export type Version = { title?: string | null; meta?: string | null; html: string };
export type Change = {
  id: number;
  entity_type: string;
  entity_id: number;
  kind: string;
  actor: string | null;
  title: string | null;
  changed_pct: number;
  summary: string;
  previous_id: number | null;
  created_at: string;
  report: ChangeReport;
  restorable: boolean;
};

// Saves the change when the words really changed; returns null when nothing did.
export async function recordChange(o: { entityType: EntityType; entityId: number; kind: ChangeKind; actor?: string | null; title?: string | null; before: Version; after: Version; previousId?: number | null; keepBefore?: boolean }) {
  const report = diffContent(o.before, o.after);
  if (report.kind === 'none') return null;
  const title = String(o.title || o.after.title || o.before.title || '').slice(0, 300) || null;
  const row = await prisma.content_changes.create({
    data: {
      entity_type: o.entityType,
      entity_id: o.entityId,
      kind: o.kind,
      actor: o.actor || null,
      title,
      changed_pct: report.changedPct,
      summary: report.summary,
      report: JSON.stringify(report),
      before_html: o.keepBefore ? JSON.stringify({ title: o.before.title || null, meta: o.before.meta || null, html: o.before.html }) : null,
      previous_id: o.previousId || null,
    },
  });
  return { row, report };
}

const shape = (r: any): Change => {
  let report: ChangeReport;
  try {
    report = JSON.parse(r.report);
  } catch {
    report = { summary: r.summary } as ChangeReport;
  }
  return { id: r.id, entity_type: r.entity_type, entity_id: r.entity_id, kind: r.kind, actor: r.actor, title: r.title, changed_pct: r.changed_pct, summary: r.summary, previous_id: r.previous_id, created_at: r.created_at, report, restorable: Boolean(r.before_html) };
};

const WITHOUT_BODY = { id: true, entity_type: true, entity_id: true, kind: true, actor: true, title: true, changed_pct: true, summary: true, report: true, previous_id: true, created_at: true, before_html: false } as const;

export async function changesFor(entityType: EntityType, entityId: number, take = 10): Promise<Change[]> {
  const rows = await prisma.content_changes.findMany({ where: { entity_type: entityType, entity_id: entityId }, orderBy: { id: 'desc' }, take, select: { ...WITHOUT_BODY, before_html: false } });
  const restorable = new Set((await prisma.content_changes.findMany({ where: { entity_type: entityType, entity_id: entityId, before_html: { not: null } }, select: { id: true } })).map((r) => r.id));
  return rows.map((r) => shape({ ...r, before_html: restorable.has(r.id) ? '1' : null }));
}

export async function recentChanges(take = 60): Promise<Change[]> {
  const rows = await prisma.content_changes.findMany({ orderBy: { id: 'desc' }, take, select: { ...WITHOUT_BODY, before_html: false } });
  return rows.map((r) => shape(r));
}

// The words a draft had before an optimisation or rewrite, for Restore.
export async function restorePoint(changeId: number): Promise<(Version & { change: Change }) | null> {
  const r = await prisma.content_changes.findUnique({ where: { id: changeId } });
  if (!r?.before_html) return null;
  try {
    const v = JSON.parse(r.before_html);
    return { title: v.title ?? null, meta: v.meta ?? null, html: String(v.html || ''), change: shape(r) };
  } catch {
    return null;
  }
}

// The earlier upload of the same piece, if there is one: the same title (ignoring case and
// punctuation), or mostly the same sentences, among the last 40 finished audits.
export async function findPreviousAudit(title: string | null | undefined, contentHtml: string, excludeId?: number) {
  const key = normalize(title || '');
  const rows = await prisma.blog_audits.findMany({
    where: { content_html: { not: null }, NOT: { audit_status: 'running' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { id: 'desc' },
    take: 40,
    select: { id: true, title: true, content_html: true, created_at: true },
  });
  for (const r of rows) {
    if ((key && normalize(r.title || '') === key) || articleSimilarity(r.content_html || '', contentHtml) >= 0.6) return r;
  }
  return null;
}
