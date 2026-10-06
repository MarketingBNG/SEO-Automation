// End-to-end check against a real Postgres (DATABASE_URL). External services are stubbed via fetch.
// Run: DATABASE_URL=... npx tsx tests/e2e-strategy.ts
import assert from 'node:assert/strict';

process.env.WORDPRESS_SITE_URL = 'https://usaindiacfo.com';
process.env.WORDPRESS_USERNAME = process.env.WORDPRESS_USERNAME || 'test';
process.env.WORDPRESS_APPLICATION_PASSWORD = process.env.WORDPRESS_APPLICATION_PASSWORD || 'test';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/claude-0/e2e/uploads';
delete process.env.BLOB_READ_WRITE_TOKEN;

const calls: string[] = [];
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url);
  calls.push(`${init.method || 'GET'} ${u}`);
  if (u.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /wp-admin/\n', { status: 200 });
  if (u.includes('/wp-json/wp/v2/posts/5') && init.method === 'POST') return Response.json({ id: 5, link: 'https://usaindiacfo.com/old-post/', meta: {} });
  if (u.includes('/wp-json/wp/v2/posts') && (init.method || 'GET') === 'POST') return Response.json({ id: 99, link: 'https://usaindiacfo.com/new-post/', meta: {} });
  if (u.includes('/wp-json/wp/v2/posts') && u.includes('search=')) return Response.json([{ id: 5, link: 'https://usaindiacfo.com/old-post/', content: { raw: '<p>Old post.</p>' } }]);
  if (u.includes('/wp-json/')) return Response.json([]);
  return new Response('stubbed', { status: 503 });
}) as any;

async function main() {
  const { default: prisma } = await import('../lib/prisma');
  const { buildPlan } = await import('../lib/strategy/generate');
  const service = await import('../lib/strategy/service');
  const { validatePlan } = await import('../lib/strategy/core');
  const { runDaily } = await import('../lib/strategy/autopilot');

  for (const t of ['blog_schedule', 'backlink_tasks', 'strategy_edits', 'strategy_changes', 'strategy_keywords', 'verified_facts', 'technical_crawls', 'seo_strategies', 'facts', 'drafts', 'keywords', 'activity_log']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
  await prisma.settings.upsert({ where: { key: 'focus_services' }, create: { key: 'focus_services', value: 'US tax;India entity setup' }, update: { value: 'US tax;India entity setup' } });

  // Build a plan from AI-shaped output and data-shaped inputs (no network: all keywords are tracked).
  const kws = ['fbar deadline', 'nri tax return', 'llc vs c corp for indians', 'us company india subsidiary', 'dtaa india us', 'form 5472', 'gst for exporters', 'ein for non resident', 'us vs india tax residency', 'virtual cfo india'];
  const intents = ['informational', 'informational', 'comparison', 'commercial', 'informational', 'informational', 'commercial', 'commercial', 'comparison', 'informational'];
  const ai = {
    summary: { focus: 'Win AI Overviews for NRI tax', strategyType: 'Growth', whyThisType: 'All three channels grew last month' },
    included: [{ item: '5 blogs', tags: ['SEO', 'AEO'] }],
    keywords: kws.map((k, i) => ({ keyword: k, intent: intents[i], tags: ['SEO', i % 2 ? 'AEO' : 'GEO'], businessValue: 4, blogTitle: `Title ${i}`, newOrRefresh: 'new', focusService: 'US tax' })),
    blogPlan: { postingDays: ['Tue', 'Thu'], calendar: kws.slice(0, 4).map((k, i) => ({ title: `Guide ${i}`, mainKeyword: k, tags: [['SEO'], ['AEO'], ['GEO'], ['SEO', 'GEO']][i], focusService: 'US tax' })) },
    aeoGeo: { items: [{ type: 'AI Overview', target: 'fbar deadline', page: '/fbar', tags: ['AEO', 'GEO'] }] },
    backlinks: [{ targetSite: 'example.org', method: 'Unlinked brand mention', ourPage: '/', tags: ['SEO', 'GEO'] }],
    technical: { fixes: [] },
    targets: { SEO: { clicks: 1200, impressions: 60000, top3: 12, top10: 40, referringDomains: 210 }, AEO: { featuredSnippets: 3, paa: 6, aiOverview: 4 }, GEO: { aiMentions: 5, aiLinks: 9 } },
  };
  const metric = (v: any) => ({ value: v, source: 'test', range: 'Oct' });
  const inputs = {
    gatheredAt: '2026-10-01',
    missing: [],
    reportRange: '2026-09-02 to 2026-09-29',
    lastMonthTrend: { SEO: 4, AEO: 2, GEO: 8 },
    rankings: kws.map((k, i) => ({ keyword: k, position: 8 + i, previousPosition: 8 + i, volume: 500, date: '2026-10-01' })),
    lastMonth: {
      SEO: { clicks: metric(1000), impressions: metric(50000), top3: metric(10), top10: metric(35), referringDomains: metric(200) },
      AEO: { featuredSnippets: metric(2), paa: metric(5), aiOverview: metric(3) },
      GEO: { aiMentions: { value: null, source: 'none', range: 'Oct', missing: 'DATA MISSING: AI chat mentions' }, aiLinks: metric(7) },
      Signal: { organicLeads: metric(14) },
    },
    crawl: null,
    snapshot: {},
  };
  const plan: any = await buildPlan(ai, inputs, 'November 2026');
  assert.equal(plan.blogPlan.calendar.length, 4);
  assert.equal(plan.blogPlan.calendar[0].publishDate, '2026-11-03 04:30:00'); // first Tue, 10:00 IST
  assert.equal(plan.keywords[0].score > 0, true);
  const validation = validatePlan(plan, { focusServices: ['US tax'] });
  assert.deepEqual(validation.errors, [], JSON.stringify(validation.errors));
  const row = await prisma.seo_strategies.create({ data: { period: 'November 2026', summary: 'x', plan_json: JSON.stringify(plan), validation: JSON.stringify(validation), status: 'pending_review' } });
  console.log('PASS buildPlan + validation (11 sections, scores, IST calendar)');

  // Approve is blocked without a crawl.
  await assert.rejects(service.approveStrategy(row.id, 'Reviewer A'), /Screaming Frog/);
  console.log('PASS approve blocked without Screaming Frog upload');

  // Edit with audit log; a non-growth target edit makes validation block approval.
  const targets = plan.targets.map((t: any) => (t.kpi === 'Clicks' ? { ...t, target: 900 } : t));
  let view: any = await service.editSection(row.id, 'targets', targets, 'Reviewer A');
  assert.equal(view.version, 2);
  assert.equal(view.edits.length, 1);
  assert.equal(view.edits[0].reviewer, 'Reviewer A');
  assert.equal(view.edits[0].section, 'targets');
  assert.ok(view.edits[0].old_value.includes('1200') && view.edits[0].new_value.includes('900'));
  assert.ok(view.validation.errors.some((e: string) => e.includes('not higher')));
  console.log('PASS edit audit log (date, reviewer, section, old, new) and re-validation');

  // Untagged item edit is rejected by validation.
  view = await service.editSection(row.id, 'included', [{ item: 'untagged thing', tags: [] }], 'Reviewer A');
  assert.ok(view.validation.errors.some((e: string) => e.includes('untagged thing')));
  view = await service.editSection(row.id, 'included', plan.included, 'Reviewer A');
  view = await service.editSection(row.id, 'targets', plan.targets, 'Reviewer A');
  assert.deepEqual(view.validation.errors, []);
  console.log('PASS untagged items blocked; fixed edits clear validation');

  // Screaming Frog upload (links export) rebuilds Section 8 and unlocks approval.
  const csv = 'Type,Source,Destination,Status Code\nHyperlink,https://usaindiacfo.com/a/,https://usaindiacfo.com/gone/,404\nHyperlink,https://usaindiacfo.com/b/,https://usaindiacfo.com/,200\n';
  const file = new File([csv], 'all_outlinks.csv', { type: 'text/csv' });
  const crawl = await service.uploadCrawl(file, 'Reviewer A');
  assert.equal(crawl.links_count, 2);
  view = await service.strategyView(await prisma.seo_strategies.findUnique({ where: { id: row.id } }));
  assert.ok(view.plan.technical.fixes.some((f: any) => f.issue.includes('gone')));
  assert.equal(view.crawl.uploadedBy, 'Reviewer A');
  assert.deepEqual(view.blockers, []);
  console.log('PASS Screaming Frog upload stored, Section 8 regenerated, banner data present');

  view = await service.approveStrategy(row.id, 'Reviewer A');
  assert.equal(view.status, 'approved');
  assert.equal(view.approved_by, 'Reviewer A');
  assert.equal(view.approved_version, 5);
  assert.equal(await prisma.blog_schedule.count(), 4);
  assert.equal(await prisma.backlink_tasks.count(), 1);
  assert.equal(await prisma.strategy_keywords.count(), 4);
  await assert.rejects(service.editSection(row.id, 'targets', plan.targets, 'Reviewer A'), /Strategy change/);
  view = await service.logStrategyChange(row.id, { what: 'Swap blog 2', why: 'New IRS notice' }, 'Reviewer B');
  assert.equal(view.changes[0].approved_by, 'Reviewer B');
  console.log('PASS one approval schedules everything; mid-month change logged');

  // Review window: give the first blog a draft containing an unverified tax figure.
  const first = (await prisma.blog_schedule.findMany({ orderBy: { publish_at: 'asc' } }))[0];
  const kw = await prisma.keywords.create({ data: { keyword: first.main_keyword, status: 'drafted' } });
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const html = `<h2>When is the FBAR due?</h2><p>The FBAR filing deadline is April 15 with an automatic extension. ${words(38)}</p><p><a href="/a">a</a> <a href="/b">b</a> <a href="https://usaindiacfo.com/c">c</a> <a href="https://www.fincen.gov/fbar">FinCEN</a></p><h2>Frequently Asked Questions</h2><h3>Who files?</h3><p>${words(45)}</p>`;
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'FBAR deadline 2026 guide', meta_description: 'When the FBAR is due.', content_html: html, status: 'pending_review' } });
  await prisma.blog_schedule.update({ where: { id: first.id }, data: { draft_id: draft.id } });

  let s = await runDaily(new Date('2026-11-02T04:35:00Z'));
  let r = await prisma.blog_schedule.findUnique({ where: { id: first.id } });
  assert.equal(r!.status, 'in_review');
  console.log('PASS blog enters review 24 hours before its slot', s.opened);

  s = await runDaily(new Date('2026-11-03T04:30:00Z'));
  r = await prisma.blog_schedule.findUnique({ where: { id: first.id } });
  assert.equal(r!.status, 'held');
  const reasons = JSON.parse(r!.hold_reasons!);
  assert.ok(reasons.some((x: string) => x.startsWith('Facts Register') && x.includes('April 15')), reasons.join(' | '));
  console.log('PASS Facts Register gate held the blog and flagged the sentence:', reasons[0]);

  await prisma.verified_facts.create({ data: { value: 'April 15', claim: 'FBAR due date', source_url: 'https://www.fincen.gov/fbar', verified_by: 'Reviewer A' } });
  s = await runDaily(new Date('2026-11-03T05:30:00Z'));
  r = await prisma.blog_schedule.findUnique({ where: { id: first.id } });
  assert.equal(r!.status, 'published', JSON.stringify({ s, reasons: r!.hold_reasons }));
  assert.equal(r!.approval_mode, 'auto');
  const log = JSON.parse(r!.post_publish_log!);
  console.log('PASS unreviewed blog auto-approved and published once the fact was added. After-publish:', Object.fromEntries(Object.entries(log).map(([k, v]: any) => [k, v.ok ? 'ok' : v.error])));
  assert.ok(calls.some((c) => c.startsWith('POST https://usaindiacfo.com/wp-json/wp/v2/posts')));
  assert.equal(log.internalLinks.ok, true);
  assert.deepEqual(log.internalLinks.result, ['https://usaindiacfo.com/old-post/']);

  // Reviewed path: the second blog is marked reviewed inside its window, so the reviewed version publishes.
  const second = (await prisma.blog_schedule.findMany({ orderBy: { publish_at: 'asc' } }))[1];
  const kw2 = await prisma.keywords.create({ data: { keyword: second.main_keyword, status: 'drafted' } });
  const html2 = html.replace('The FBAR filing deadline is April 15 with an automatic extension.', 'Reviewed version of the answer for this question here.');
  const d2 = await prisma.drafts.create({ data: { keyword_id: kw2.id, title: 'Reviewed guide title', meta_description: 'Reviewed meta.', content_html: html2, status: 'pending_review' } });
  await prisma.blog_schedule.update({ where: { id: second.id }, data: { draft_id: d2.id, status: 'in_review', review_started: '2026-11-04 04:30:00', reviewed_by: 'Reviewer A', reviewed_at: '2026-11-04 12:00:00' } });
  await runDaily(new Date(Date.parse(second.publish_at.replace(' ', 'T') + 'Z')));
  r = await prisma.blog_schedule.findUnique({ where: { id: second.id } });
  assert.equal(r!.status, 'published');
  assert.equal(r!.approval_mode, 'reviewed');
  console.log('PASS reviewed-within-24h blog published as the reviewed version');

  await prisma.$disconnect();
  console.log('ALL E2E CHECKS PASSED');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
