// @ts-nocheck -- database-facing helpers around the pure rules in ./core.
// Strategy actions: read, edit (with audit log), approve (one approval starts the month), log a
// mid-month change, and the Screaming Frog upload that regenerates Section 8.
import * as XLSX from 'xlsx';
import prisma from '../prisma';
import * as activity from '../activity';
import { sqlNow } from '../time';
import { saveFile } from '../storage';
import { parseScreamingFrogCsv } from '../technicalAudit';
import { validatePlan, approvalBlockers, keywordKey, EDITABLE_SECTIONS, crawlIsFresh, priorityScore } from './core';
import { technicalFixesFromCrawl, calendarSlots } from './generate';
import { fixKind } from './fixer';
import * as settings from '../settings';

export async function latestCrawl() {
  return prisma.technical_crawls.findFirst({ orderBy: { id: 'desc' } });
}

async function revalidate(plan) {
  const used = new Set(
    (await prisma.strategy_keywords.findMany({ where: { period: { not: plan.period } }, select: { keyword_key: true } })).map((k) => k.keyword_key)
  );
  // Published posts count as used topics too (K10).
  for (const d of await prisma.drafts.findMany({ where: { status: 'published' }, select: { keyword: { select: { keyword: true } } } })) if (d.keyword?.keyword) used.add(keywordKey(d.keyword.keyword));
  const focus = String((await settings.get('focus_services')) || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return validatePlan(plan, { usedKeywords: used, focusServices: focus });
}

export async function strategyView(row) {
  if (!row) return null;
  const plan = row.plan_json ? JSON.parse(row.plan_json) : null;
  const validation = row.validation ? JSON.parse(row.validation) : null;
  const crawl = await latestCrawl();
  const crawlInfo = crawl ? { id: crawl.id, uploadedAt: crawl.created_at, uploadedBy: crawl.uploaded_by, filename: crawl.filename, fresh: crawlIsFresh(crawl.created_at) } : null;
  const [edits, changes] = await Promise.all([
    prisma.strategy_edits.findMany({ where: { strategy_id: row.id }, orderBy: { id: 'desc' }, take: 200 }),
    prisma.strategy_changes.findMany({ where: { strategy_id: row.id }, orderBy: { id: 'desc' } }),
  ]);
  return {
    id: row.id,
    period: row.period,
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    approved_version: row.approved_version,
    plan,
    validation,
    crawl: crawlInfo,
    blockers: row.status === 'approved' ? [] : approvalBlockers(plan, validation, crawl),
    edits,
    changes,
  };
}

// Recomputes the scores after an edit to the keyword table, so the formula always holds.
function rescore(plan) {
  for (const k of plan.keywords || []) {
    k.score = priorityScore({
      businessValue: k.businessValue,
      volumeUs: k.volumeUs?.value,
      volumeIndia: k.volumeIndia?.value,
      difficulty: k.difficulty?.value,
      currentPosition: k.currentPosition?.value,
    });
  }
}

// Edit any editable section, before or after approval. Every save goes to the audit log and is
// re-validated. After approval the edit needs a reason, is also logged as a "Strategy change", and
// the blog calendar and backlink tasks are updated to match (published blogs are never touched).
export async function editSection(id: number, section: string, value: any, reviewer: string, why?: string) {
  if (!EDITABLE_SECTIONS.includes(section)) throw Object.assign(new Error(`Section "${section}" cannot be edited.`), { status: 400 });
  const row = await prisma.seo_strategies.findUnique({ where: { id } });
  if (!row?.plan_json) throw Object.assign(new Error('Not found'), { status: 404 });
  const approved = row.status === 'approved';
  if (approved && !String(why || '').trim()) throw Object.assign(new Error('This strategy is approved. Say why you are changing it.'), { status: 400 });
  const plan = JSON.parse(row.plan_json);
  const oldValue = plan[section];
  plan[section] = value;
  if (section === 'keywords') rescore(plan);
  if (section === 'blogPlan') fillPublishDates(plan);
  const validation = await revalidate(plan);
  const version = (row.version || 1) + 1;
  await prisma.$transaction(async (tx) => {
    await tx.seo_strategies.update({ where: { id }, data: { plan_json: JSON.stringify(plan), validation: JSON.stringify(validation), version } });
    await tx.strategy_edits.create({ data: { strategy_id: id, reviewer, section, old_value: JSON.stringify(oldValue ?? null), new_value: JSON.stringify(value ?? null), version } });
    if (approved) {
      await tx.strategy_changes.create({ data: { strategy_id: id, what: `Edited section "${section}" (version ${version})`, why: String(why).trim(), approved_by: reviewer } });
      if (section === 'blogPlan') await syncCalendar(tx, id, row.period, plan.blogPlan?.calendar || []);
      if (section === 'backlinks') await syncBacklinks(tx, id, plan.backlinks || []);
    }
  });
  await activity.log(approved ? 'strategy.changed' : 'strategy.edited', { entityType: 'seo_strategy', entityId: id, details: `Section ${section}, version ${version}${approved ? `: ${why}` : ''}`, actor: reviewer });
  return strategyView(await prisma.seo_strategies.findUnique({ where: { id } }));
}

// A blog row added in Edit Strategy gets the next free posting slot of the month.
function fillPublishDates(plan) {
  const cal = plan.blogPlan?.calendar || [];
  const taken = new Set(cal.map((b) => b.publishDate).filter(Boolean));
  const days = plan.blogPlan?.postingDays?.length ? plan.blogPlan.postingDays : ['Tue', 'Thu'];
  const time = String(plan.blogPlan?.postingTime || '10:00').slice(0, 5);
  const free = calendarSlots(plan, days, time, 31).filter((t) => !taken.has(t));
  for (const b of cal) {
    if (b.publishDate) continue;
    const slot = free.shift();
    if (!slot) break;
    b.publishDate = slot;
    b.reviewDeadline = slot;
    b.reviewOpens = new Date(Date.parse(slot.replace(' ', 'T') + 'Z') - 24 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    b.status = b.status || 'planned';
  }
  cal.sort((a, b) => String(a.publishDate).localeCompare(String(b.publishDate)));
}

// Approved strategy calendar edit: blogs not yet drafted are replaced by the edited calendar;
// blogs already drafted, in review or published stay as they are.
async function syncCalendar(tx, id, period, calendar) {
  const started = await tx.blog_schedule.findMany({ where: { strategy_id: id, NOT: { status: 'planned', draft_id: null } } });
  const keep = new Set(started.map((r) => keywordKey(r.main_keyword)));
  await tx.blog_schedule.deleteMany({ where: { strategy_id: id, status: 'planned', draft_id: null } });
  for (const b of calendar) {
    if (!b.mainKeyword || !b.publishDate || keep.has(keywordKey(b.mainKeyword))) continue;
    await tx.strategy_keywords.upsert({
      where: { keyword_key: keywordKey(b.mainKeyword) },
      create: { keyword_key: keywordKey(b.mainKeyword), keyword: b.mainKeyword, period, strategy_id: id },
      update: {},
    });
    await tx.blog_schedule.create({
      data: { strategy_id: id, publish_at: b.publishDate, title: b.title, main_keyword: b.mainKeyword, cluster: b.cluster || null, tags: JSON.stringify(b.tags || []), refresh_url: b.refreshUrl || null },
    });
  }
}

async function syncBacklinks(tx, id, backlinks) {
  await tx.backlink_tasks.deleteMany({ where: { strategy_id: id, status: 'planned' } });
  const done = new Set((await tx.backlink_tasks.findMany({ where: { strategy_id: id } })).map((t) => `${t.target_site}|${t.method}`));
  for (const l of backlinks) {
    if (done.has(`${l.targetSite}|${l.method}`)) continue;
    await tx.backlink_tasks.create({ data: { strategy_id: id, target_site: l.targetSite, method: l.method, our_page: l.ourPage || '', send_date: l.sendDate || '', tags: JSON.stringify(l.tags || []) } });
  }
}

// ONE approval approves everything: keywords are reserved, the blog calendar, backlink tasks and
// fixes are scheduled, and the cron jobs run the month from here.
export async function approveStrategy(id: number, approver: string) {
  const row = await prisma.seo_strategies.findUnique({ where: { id } });
  if (!row?.plan_json) throw Object.assign(new Error('Not found'), { status: 404 });
  if (row.status === 'approved') throw Object.assign(new Error('Already approved.'), { status: 409 });
  const plan = JSON.parse(row.plan_json);
  const validation = await revalidate(plan);
  const blockers = approvalBlockers(plan, validation, await latestCrawl());
  if (blockers.length) {
    await prisma.seo_strategies.update({ where: { id }, data: { validation: JSON.stringify(validation) } });
    throw Object.assign(new Error(blockers.join(' ')), { status: 409, blockers });
  }

  const now = sqlNow();
  await prisma.$transaction(async (tx) => {
    // Only one approved strategy per month.
    await tx.seo_strategies.updateMany({ where: { period: row.period, status: 'approved' }, data: { status: 'superseded' } });
    await tx.seo_strategies.update({
      where: { id },
      data: { status: 'approved', approved_by: approver, approved_at: now, approved_version: row.version, decided_at: now, validation: JSON.stringify(validation) },
    });
    for (const b of plan.blogPlan?.calendar || []) {
      await tx.strategy_keywords.upsert({
        where: { keyword_key: keywordKey(b.mainKeyword) },
        create: { keyword_key: keywordKey(b.mainKeyword), keyword: b.mainKeyword, period: row.period, strategy_id: id },
        update: {},
      });
      await tx.blog_schedule.create({
        data: {
          strategy_id: id,
          publish_at: b.publishDate,
          title: b.title,
          main_keyword: b.mainKeyword,
          cluster: b.cluster || null,
          tags: JSON.stringify(b.tags || []),
          refresh_url: b.refreshUrl || null,
        },
      });
    }
    for (const l of plan.backlinks || []) {
      await tx.backlink_tasks.create({
        data: { strategy_id: id, target_site: l.targetSite, method: l.method, our_page: l.ourPage || '', send_date: l.sendDate || '', tags: JSON.stringify(l.tags || []) },
      });
    }
    // Ticked technical fixes (all are ticked unless the reviewer unticked them) run automatically.
    for (const f of plan.technical?.fixes || []) {
      if (f.apply === false || !f.url || !f.issue) continue;
      await tx.technical_fix_tasks.create({ data: { strategy_id: id, url: f.url, issue: f.issue, fix: f.fix || '', kind: fixKind(f.issue) } });
    }
  });
  await activity.log('strategy.approved', {
    entityType: 'seo_strategy',
    entityId: id,
    details: `${row.period} version ${row.version}: ${plan.blogPlan?.calendar?.length || 0} blogs and ${plan.backlinks?.length || 0} backlink tasks scheduled`,
    actor: approver,
  });
  return strategyView(await prisma.seo_strategies.findUnique({ where: { id } }));
}

export async function logStrategyChange(id: number, { what, why }: any, approvedBy: string) {
  if (!what?.trim() || !why?.trim()) throw Object.assign(new Error('Say what changed and why.'), { status: 400 });
  const row = await prisma.seo_strategies.findUnique({ where: { id } });
  if (row?.status !== 'approved') throw Object.assign(new Error('Strategy changes apply to an approved strategy.'), { status: 409 });
  await prisma.strategy_changes.create({ data: { strategy_id: id, what: what.trim(), why: why.trim(), approved_by: approvedBy } });
  await activity.log('strategy.changed', { entityType: 'seo_strategy', entityId: id, details: what.trim(), actor: approvedBy });
  return strategyView(row);
}

// Broken links from a Screaming Frog links export ("All Outlinks" / "All Inlinks": Source,
// Destination, Status Code). Returns [] for exports without those columns.
export function parseLinksExport(buf: Buffer) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!rows.length) return { linksCount: 0, issues: [] };
  const keys = Object.keys(rows[0]);
  const find = (re) => keys.find((k) => re.test(k));
  const src = find(/^source$/i);
  const dst = find(/^destination$/i);
  const code = find(/^status code$/i);
  if (!src || !dst) return { linksCount: 0, issues: [] };
  const issues = [];
  for (const r of rows) {
    const status = parseInt(r[code], 10);
    if (status >= 400 || status === 0) issues.push({ source: String(r[src]), target: String(r[dst]), status: status || 'no response' });
  }
  return { linksCount: rows.length, issues: issues.slice(0, 500) };
}

// Upload gate. Stores the file, parses it, and rebuilds Section 8 of every unapproved strategy.
export async function uploadCrawl(file: File, uploader: string) {
  const name = file.name || 'crawl.csv';
  if (!/\.(csv|xlsx|xls)$/i.test(name)) throw Object.assign(new Error('Upload a CSV or XLSX Screaming Frog export.'), { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const links = parseLinksExport(buf);
  // A links export has no page-level columns; the page parser is used when it has them.
  let pages: any = { totalUrls: 0, brokenCount: links.issues.length, missingTitleCount: 0, duplicateTitleCount: 0, missingMetaCount: 0, thinContentCount: 0, problemUrls: [] };
  try {
    const p = parseScreamingFrogCsv(buf);
    if (p.columnsFound?.titleKey || p.columnsFound?.statusCodeKey) pages = p;
  } catch {
    /* links-only export */
  }
  const key = `crawls/${Date.now()}-${name.replace(/[^a-z0-9._-]+/gi, '_')}`;
  await saveFile(key, buf, /\.csv$/i.test(name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const created = await prisma.technical_crawls.create({
    data: {
      filename: name,
      total_urls: pages.totalUrls,
      broken_count: Math.max(pages.brokenCount || 0, links.issues.length),
      missing_title_count: pages.missingTitleCount,
      duplicate_title_count: pages.duplicateTitleCount,
      missing_meta_count: pages.missingMetaCount,
      thin_content_count: pages.thinContentCount,
      problem_urls: JSON.stringify(pages.problemUrls || []),
      file_key: key,
      uploaded_by: uploader,
      links_count: links.linksCount,
      link_issues: JSON.stringify(links.issues),
    },
  });

  const crawl = { uploadedAt: created.created_at, uploadedBy: uploader, totalUrls: created.total_urls, problems: pages.problemUrls || [], linkIssues: links.issues };
  const open = await prisma.seo_strategies.findMany({ where: { status: 'pending_review', plan_json: { not: null } } });
  for (const s of open) {
    const plan = JSON.parse(s.plan_json);
    const aiFixes = (plan.technical?.fixes || []).filter((f) => f.fromAi);
    plan.technical = { ...plan.technical, crawl: { uploadedAt: crawl.uploadedAt, uploadedBy: uploader, totalUrls: crawl.totalUrls }, fixes: [...technicalFixesFromCrawl(crawl), ...aiFixes] };
    const validation = await revalidate(plan);
    await prisma.seo_strategies.update({ where: { id: s.id }, data: { plan_json: JSON.stringify(plan), validation: JSON.stringify(validation) } });
  }
  await activity.log('technical.imported', { entityType: 'technical_crawl', entityId: created.id, details: `${name}: ${links.linksCount} links, ${links.issues.length} broken`, actor: uploader });
  return created;
}
