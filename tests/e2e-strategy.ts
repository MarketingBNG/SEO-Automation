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

  for (const t of ['technical_fix_tasks', 'blog_schedule', 'backlink_tasks', 'strategy_edits', 'strategy_changes', 'strategy_keywords', 'client_insights', 'ai_usage', 'technical_crawls', 'seo_strategies', 'facts', 'drafts', 'keywords', 'activity_log']) {
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
  const fixes = await prisma.technical_fix_tasks.findMany();
  assert.ok(fixes.length >= 1 && fixes.every((f) => f.status === 'planned'), 'ticked technical fixes are queued on approval');
  console.log(`PASS approval queued ${fixes.length} technical fix(es) for automatic apply`);

  // "Update with latest changes": adds new backlink targets and automation steps, nothing else.
  {
    const { refreshStrategy } = await import('../lib/strategy/refresh');
    const { AUTOMATION } = await import('../lib/strategy/generate');
    await prisma.settings.upsert({ where: { key: 'competitor_domains' }, create: { key: 'competitor_domains', value: 'rival.com' }, update: { value: 'rival.com' } });
    const before = JSON.parse((await prisma.seo_strategies.findUnique({ where: { id: row.id } }))!.plan_json!);
    before.automation = before.automation.slice(0, 3);
    await prisma.seo_strategies.update({ where: { id: row.id }, data: { plan_json: JSON.stringify(before) } });
    const opts = { gap: async () => [{ domain: 'newsite.com', linksTo: ['rival.com'] }], pick: async () => [{ targetSite: 'newsite.com', ourPage: '/guide', method: 'Unlinked brand mention' }] };
    const r1 = await refreshStrategy(row.id, 'Reviewer A', opts);
    assert.ok(r1.changes.some((c: string) => c.startsWith('Section 6: 1 new backlink')), JSON.stringify(r1));
    assert.ok(r1.changes.some((c: string) => c.startsWith('Section 7')));
    assert.equal(r1.view!.plan.automation.length, AUTOMATION.length);
    assert.deepEqual(r1.view!.plan.blogPlan, before.blogPlan, 'the blog calendar is not touched');
    const task = await prisma.backlink_tasks.findFirst({ where: { target_site: 'newsite.com' } });
    assert.equal(task?.method, 'Unlinked brand mention');
    const r2 = await refreshStrategy(row.id, 'Reviewer A', opts);
    assert.equal(r2.changes.length, 0, 'a second update finds nothing new');
    assert.equal(await prisma.backlink_tasks.count({ where: { target_site: 'newsite.com' } }), 1);
    await prisma.settings.delete({ where: { key: 'competitor_domains' } });
    console.log('PASS update with latest changes adds only what is new and queues it');
  }
  assert.equal(await prisma.strategy_keywords.count(), 4);
  await assert.rejects(service.editSection(row.id, 'targets', plan.targets, 'Reviewer A'), /Say why/);
  view = await service.logStrategyChange(row.id, { what: 'Swap blog 2', why: 'New IRS notice' }, 'Reviewer B');
  assert.equal(view.changes[0].approved_by, 'Reviewer B');
  console.log('PASS one approval schedules everything; mid-month change logged');

  // Edit after approval: needs a reason, is logged as a change, and new calendar rows get a slot.
  await assert.rejects(service.editSection(row.id, 'targets', plan.targets, 'Reviewer A'), /Say why/);
  const cal2 = [...plan.blogPlan.calendar, { title: 'Extra guide', mainKeyword: 'extra keyword', tags: ['AEO'], focusService: 'US tax' }];
  view = await service.editSection(row.id, 'blogPlan', { ...plan.blogPlan, calendar: cal2 }, 'Reviewer B', 'Client asked for one more blog');
  assert.equal(view.changes[0].why, 'Client asked for one more blog');
  const extra = view.plan.blogPlan.calendar.find((b: any) => b.mainKeyword === 'extra keyword');
  assert.ok(extra.publishDate, 'new row got a publish slot');
  assert.equal(await prisma.blog_schedule.count({ where: { strategy_id: row.id } }), 5);
  console.log('PASS edit after approval: reason required, change logged, calendar synced (new slot', extra.publishDate + ')');

  // Fact-check stub (the real one calls Claude with web search): fixes the wrong deadline, or fails.
  let verifyCalls = 0;
  const fixingVerify = async (d: any) => {
    verifyCalls++;
    return { ok: true, rounds: 3, draft: { ...d, content: d.content.replace('April 30', 'April 15') }, log: [] };
  };
  const failingVerify = async (d: any) => ({ ok: false, rounds: 50, draft: d, log: [] });

  // Review window: the first blog's draft states a wrong deadline (April 30).
  const first = (await prisma.blog_schedule.findMany({ orderBy: { publish_at: 'asc' } }))[0];
  const kw = await prisma.keywords.create({ data: { keyword: first.main_keyword, status: 'drafted' } });
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const html = `<h2>When is the FBAR due?</h2><p>The FBAR filing deadline is April 30 with an automatic extension. ${words(38)}</p><p><a href="/a">a</a> <a href="/b">b</a> <a href="https://usaindiacfo.com/c">c</a> <a href="https://www.fincen.gov/fbar">FinCEN</a></p><h2>Frequently Asked Questions</h2><h3>Who files?</h3><p>${words(45)}</p>`;
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'FBAR deadline 2026 guide', meta_description: 'When the FBAR is due.', content_html: html, status: 'pending_review' } });
  await prisma.blog_schedule.update({ where: { id: first.id }, data: { draft_id: draft.id } });

  let s = await runDaily(new Date('2026-11-02T04:35:00Z'), { verify: fixingVerify });
  let r = await prisma.blog_schedule.findUnique({ where: { id: first.id } });
  assert.equal(r!.status, 'in_review');
  assert.ok((await prisma.drafts.findUnique({ where: { id: draft.id } }))!.content_html!.includes('April 15'));
  assert.equal(JSON.parse(r!.fact_check!).ok, true);
  console.log('PASS blog fact-checked and corrected before review opens (April 30 -> April 15)', s.opened);

  s = await runDaily(new Date('2026-11-03T04:30:00Z'), { verify: fixingVerify });
  r = await prisma.blog_schedule.findUnique({ where: { id: first.id } });
  assert.equal(r!.status, 'published', JSON.stringify({ s, reasons: r!.hold_reasons }));
  assert.equal(r!.approval_mode, 'auto');
  assert.equal(verifyCalls, 1); // unchanged draft is not re-checked
  const log = JSON.parse(r!.post_publish_log!);
  console.log('PASS unreviewed, fact-checked blog auto-approved and published. After-publish:', Object.fromEntries(Object.entries(log).map(([k, v]: any) => [k, v.ok ? 'ok' : v.error])));
  assert.ok(calls.some((c) => c.startsWith('POST https://usaindiacfo.com/wp-json/wp/v2/posts')));
  assert.equal(log.internalLinks.ok, true);
  assert.deepEqual(log.internalLinks.result, ['https://usaindiacfo.com/old-post/']);

  // Reviewed path: the second blog is marked reviewed inside its window, so the reviewed version publishes.
  const second = (await prisma.blog_schedule.findMany({ orderBy: { publish_at: 'asc' } }))[1];
  const kw2 = await prisma.keywords.create({ data: { keyword: second.main_keyword, status: 'drafted' } });
  const html2 = html.replace('The FBAR filing deadline is April 30 with an automatic extension.', 'Reviewed version of the answer for this question here.');
  const d2 = await prisma.drafts.create({ data: { keyword_id: kw2.id, title: 'Reviewed guide title', meta_description: 'Reviewed meta.', content_html: html2, status: 'pending_review' } });
  await prisma.blog_schedule.update({ where: { id: second.id }, data: { draft_id: d2.id, status: 'in_review', review_started: '2026-11-04 04:30:00', reviewed_by: 'Reviewer A', reviewed_at: '2026-11-04 12:00:00' } });
  await runDaily(new Date(Date.parse(second.publish_at.replace(' ', 'T') + 'Z')), { verify: fixingVerify });
  r = await prisma.blog_schedule.findUnique({ where: { id: second.id } });
  assert.equal(r!.status, 'published');
  assert.equal(r!.approval_mode, 'reviewed');
  console.log('PASS reviewed-within-24h blog published as the reviewed version');

  // A blog whose claims cannot all be verified is held, never published.
  const third = (await prisma.blog_schedule.findMany({ orderBy: { publish_at: 'asc' } }))[2];
  const kw3 = await prisma.keywords.create({ data: { keyword: third.main_keyword, status: 'drafted' } });
  const d3 = await prisma.drafts.create({ data: { keyword_id: kw3.id, title: 'Unverifiable guide', meta_description: 'Meta.', content_html: html, status: 'pending_review' } });
  await prisma.blog_schedule.update({ where: { id: third.id }, data: { draft_id: d3.id, status: 'in_review' } });
  await runDaily(new Date(Date.parse(third.publish_at.replace(' ', 'T') + 'Z')), { verify: failingVerify });
  r = await prisma.blog_schedule.findUnique({ where: { id: third.id } });
  assert.equal(r!.status, 'held');
  assert.ok(JSON.parse(r!.hold_reasons!).some((x: string) => x.startsWith('Fact check could not confirm')));
  console.log('PASS unverifiable blog held, not published');

  // Strategy progress and cost estimate.
  const { strategyProgress } = await import('../lib/strategy/progress');
  let pr: any = await strategyProgress(row.id);
  assert.equal(pr.blogs.published, 2);
  assert.equal(pr.blogs.total, 5);
  const bl = (await prisma.backlink_tasks.findFirst({ where: { strategy_id: row.id } }))!;
  await prisma.backlink_tasks.update({ where: { id: bl.id }, data: { status: 'done' } });
  pr = await strategyProgress(row.id);
  assert.equal(pr.backlinks.done, 1);
  assert.equal(pr.backlinks.total, 2, 'the original target plus the one added by the update');
  assert.equal(pr.percent, Math.round((3 / 7) * 100));
  assert.ok(pr.cost.estimate > 0 && pr.cost.lines.length === 7);
  assert.ok(pr.cost.lines.some((l: any) => l.item.startsWith('Backlink outreach') && l.units === 2));
  console.log(`PASS strategy progress ${pr.percent}% (2 of 5 blogs, 1 of 2 backlinks), estimated AI cost $${pr.cost.estimate.toFixed(2)} (${pr.cost.basis})`);

  // Meeting insights: cleaned and auto-approved, or held when something identifying is left.
  const { autoReview } = await import('../lib/clientInsights');
  const ins = await prisma.client_insights.create({ data: { title: 'Canada incorporation (Amit Agarwal)', overview: 'Pricing starts at USD 1,450. Ontario chosen.', status: 'pending_review' } });
  const good = await autoReview(ins.id, { cleaner: async () => ({ title: 'Incorporating in Canada', overview: '- Why Ontario is common for non-resident founders.' }) });
  assert.equal(good!.status, 'approved');
  assert.ok(!good!.overview!.includes('1,450') && !good!.title!.includes('Amit'));
  const ins2 = await prisma.client_insights.create({ data: { title: 'Call (Amit Agarwal)', overview: 'x', status: 'pending_review' } });
  const bad = await autoReview(ins2.id, { cleaner: async () => ({ title: 'Call', overview: 'Amit was quoted USD 900.' }) });
  assert.equal(bad!.status, 'pending_review');
  console.log('PASS meeting insights: clean ones auto-approved, unsafe ones held for review');

  // Background generation: returns at once; a failure is saved with a readable error, not lost.
  const { startStrategyJob } = await import('../lib/strategy/jobs');
  const job = await startStrategyJob({ actor: 'Test' });
  let st: any = await prisma.seo_strategies.findUnique({ where: { id: job.id } });
  assert.equal(st.status, 'generating');
  for (let i = 0; i < 120 && st.status === 'generating'; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    st = await prisma.seo_strategies.findUnique({ where: { id: job.id } });
  }
  assert.equal(st.status, 'failed');
  assert.ok(st.error && st.error.length > 0);
  console.log('PASS background generation reports progress and a readable failure:', st.progress_stage, '|', st.error.slice(0, 90));

  // Pause holds the run, Resume continues it, Stop cancels it.
  const { controlStrategyJob } = await import('../lib/strategy/jobs');
  const waitFor = async (id: number, want: (s: string) => boolean, secs = 120) => {
    let r: any;
    for (let i = 0; i < secs; i++) {
      r = await prisma.seo_strategies.findUnique({ where: { id } });
      if (want(r.status)) return r;
      await new Promise((res) => setTimeout(res, 1000));
    }
    return r;
  };
  const j2 = await startStrategyJob({ actor: 'Test' });
  await controlStrategyJob(j2.id, 'pause', 'Test');
  await new Promise((res) => setTimeout(res, 6000));
  assert.equal((await prisma.seo_strategies.findUnique({ where: { id: j2.id } }))!.status, 'paused');
  await controlStrategyJob(j2.id, 'resume', 'Test');
  const resumed = await waitFor(j2.id, (x) => x !== 'generating');
  assert.equal(resumed.status, 'failed'); // ran on after resume, then failed for lack of an API key
  const j3 = await startStrategyJob({ actor: 'Test' });
  await controlStrategyJob(j3.id, 'pause', 'Test');
  await controlStrategyJob(j3.id, 'stop', 'Test');
  const stopped = await waitFor(j3.id, (x) => x === 'stopped', 30);
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.start_date && stopped.end_date, '30-day window saved');
  console.log('PASS pause holds, resume continues, stop cancels; window', stopped.start_date, 'to', stopped.end_date);

  // A run the server lost (restart) is marked interrupted instead of hanging at its last percent.
  const { markInterrupted } = await import('../lib/strategy/jobs');
  const orphan = await prisma.seo_strategies.create({ data: { period: 'November 2026', status: 'generating', progress_stage: 'Reading SE Ranking backlinks', progress_percent: 13 } });
  await markInterrupted();
  const o = await prisma.seo_strategies.findUnique({ where: { id: orphan.id } });
  assert.equal(o!.status, 'failed');
  assert.ok(o!.error!.includes('server restarted'));
  console.log('PASS stuck run from before a restart is marked interrupted');

  // AI credits: spend is counted, and crossing the pause level pauses AI work and a running strategy.
  const credits = await import('../lib/aiCredits');
  await prisma.ai_usage.deleteMany({});
  await credits.setBalance(10, 'Test', 5);
  const gen = await prisma.seo_strategies.create({ data: { period: 'x', status: 'generating' } });
  await credits.recordUsage({ model: 'claude-opus-5-5', usage: { input_tokens: 1000000, output_tokens: 100000 }, feature: 'strategy' }); // $6
  let cs = await credits.creditStatus();
  assert.equal(Math.round(cs.remaining! * 100) / 100, 4);
  assert.equal(cs.paused, true);
  assert.equal((await prisma.seo_strategies.findUnique({ where: { id: gen.id } }))!.status, 'paused');
  await assert.rejects(credits.assertCredits(), /AI work is paused/);
  await credits.setBalance(50, 'Test');
  cs = await credits.creditStatus();
  assert.equal(cs.paused, false);
  assert.equal(cs.remaining, 50);
  await credits.assertCredits();
  console.log('PASS credits: $6 spent of $10 paused AI work and the strategy at $4 left; new balance resumes');

  await prisma.$disconnect();
  console.log('ALL E2E CHECKS PASSED');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
