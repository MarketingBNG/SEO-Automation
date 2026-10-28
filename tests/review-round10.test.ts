// Review round 10: one skill run at a time, no outbound call to the live site without
// WORDPRESS_SITE_URL, a publish that cannot reach WordPress changes nothing, and the report
// explanation makes no AI call when there is no data. The database tests use DATABASE_URL (local
// test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSkillRun, releaseSkillRun } from '../lib/skillRun';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service; calls are recorded instead.
const calls: string[] = [];
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  calls.push(String(url instanceof Request ? url.url : url));
  throw new Error(`Network call in a test: ${url}`);
}) as any;

// The WordPress and site connector settings, cleared for a test and put back after it.
const WP_ENV = ['WORDPRESS_SITE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APPLICATION_PASSWORD', 'SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET'];
async function withoutWordPress<T>(fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(WP_ENV.map((k) => [k, process.env[k]]));
  for (const k of WP_ENV) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const k of WP_ENV) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
}

test('the manual skill update and the automatic refresh share one run', () => {
  assert.equal(claimSkillRun('auto'), null);
  assert.equal(claimSkillRun('manual'), 'auto', 'a manual press while the batch refresh waits is refused');
  assert.equal(claimSkillRun('auto'), 'auto');
  releaseSkillRun('manual');
  assert.equal(claimSkillRun('manual'), 'auto', 'a refused manual press does not free the auto run');
  releaseSkillRun('auto');
  assert.equal(claimSkillRun('manual'), null);
  assert.equal(claimSkillRun('auto'), 'manual');
  releaseSkillRun('manual');
});

test('the daily site check does not fetch the live site when WORDPRESS_SITE_URL is not set', { skip: !db, timeout: 60000 }, async () => {
  const { runSiteChecks } = await import('../lib/siteChecks');
  calls.length = 0;
  const out: any = await withoutWordPress(() => runSiteChecks());
  assert.equal(out.robots, 'not checked: WORDPRESS_SITE_URL not set');
  assert.deepEqual(calls.filter((u) => /robots\.txt/.test(u)), []);
});

test('the Bing calls need WORDPRESS_SITE_URL, not the production domain', async () => {
  const { submitToBing } = await import('../lib/bing');
  const prev = process.env.BING_WEBMASTER_API_KEY;
  process.env.BING_WEBMASTER_API_KEY = 'test-key';
  calls.length = 0;
  try {
    await withoutWordPress(() => assert.rejects(submitToBing(['https://example.com/a/']), /WORDPRESS_SITE_URL is not set/));
    assert.deepEqual(calls, []);
  } finally {
    if (prev === undefined) delete process.env.BING_WEBMASTER_API_KEY;
    else process.env.BING_WEBMASTER_API_KEY = prev;
  }
});

test('a publish without a WordPress connection saves no author or cover', { skip: !db, timeout: 60000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const kw = await prisma.keywords.create({ data: { keyword: `no wp ${Date.now()}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'A plain test blog', meta_description: 'Meta', content_html: '<p>Plain text.</p>', status: 'approved' } });
  try {
    const res: any = await withoutWordPress(() =>
      POST(new Request(`http://x/api/drafts/${draft.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'draft' }) }) as any, { params: Promise.resolve({ id: String(draft.id) }) })
    );
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not configured/);
    const after = (await prisma.drafts.findUnique({ where: { id: draft.id } }))!;
    assert.equal(after.author, null);
    assert.equal(after.featured_image_path, null);
    assert.equal(after.status, 'approved');
  } finally {
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

// Skipped where a report source is configured (it would be read, and Google's client does not use fetch).
const sourceKeys = ['GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH', 'SERANKING_API_KEY'].some((k) => process.env[k]);
test('the report explanation makes no AI call when no source could be read', { skip: !db || sourceKeys, timeout: 120000 }, async () => {
  const { noReportData, explainPerformance } = await import('../lib/performanceExplain');
  const all = ['searchConsole', 'searchConsoleQueries', 'pages', 'pagesBefore', 'ga4Organic', 'ga4Ai', 'wordpress', 'seRanking'];
  assert.equal(noReportData({ errors: Object.fromEntries(all.map((k) => [k, 'x'])) }), true);
  assert.equal(noReportData({ errors: Object.fromEntries(all.slice(1).map((k) => [k, 'x'])) }), false, 'one source read: there is something to explain');
  assert.equal(noReportData({ errors: {} }), false);
  // No keys here, so every source fails; an AI call would hit the stubbed fetch and throw.
  const saved = { key: process.env.ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  calls.length = 0;
  try {
    const out: any = await withoutWordPress(() => explainPerformance('seo', 28, { fresh: true }));
    assert.equal(out.noData, true);
    assert.match(out.text, /no data/i);
    assert.deepEqual(calls.filter((u) => /anthropic/.test(u)), [], 'no AI call');
  } finally {
    process.env.ANTHROPIC_API_KEY = saved.key || '';
  }
});
