// Review round 11: the live-site checks use the site connector's origin when WORDPRESS_SITE_URL is
// not set, a draft the website connector would refuse is refused before anything is saved or
// uploaded, a Testing-mode skill update does not hold the run, and the batch-waiting message is right
// for the AI mode. The database tests use DATABASE_URL (local test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOrigin } from '../lib/siteConnector';
import { claimSkillRun, releaseSkillRun, skillRunning } from '../lib/skillRun';
import { SkillBatchWaitingError } from '../lib/anthropic';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service; calls are recorded instead.
const calls: string[] = [];
process.env.SLACK_WEBHOOK_URL = '';
globalThis.fetch = (async (url: any) => {
  calls.push(String(url instanceof Request ? url.url : url));
  throw new Error(`Network call in a test: ${url}`);
}) as any;

const WP_ENV = ['WORDPRESS_SITE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APPLICATION_PASSWORD', 'SITE_CONNECTOR_URL', 'SITE_CONNECTOR_SECRET', 'SITE_CONNECTOR_DRAFTS'];
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(WP_ENV.map((k) => [k, process.env[k]]));
  for (const k of WP_ENV) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of WP_ENV) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

test('the live site is WORDPRESS_SITE_URL, else the site connector, else nothing', async () => {
  await withEnv({}, () => assert.equal(siteOrigin(), ''));
  await withEnv({ WORDPRESS_SITE_URL: ' https://wp.example.com/ ' }, () => assert.equal(siteOrigin(), 'https://wp.example.com'));
  await withEnv({ SITE_CONNECTOR_URL: 'https://site.example.com/_bridge/dashboard-connector.php', SITE_CONNECTOR_SECRET: 's' }, () =>
    assert.equal(siteOrigin(), 'https://site.example.com')
  );
  await withEnv({ SITE_CONNECTOR_URL: 'https://site.example.com/_bridge/x.php' }, () => assert.equal(siteOrigin(), '', 'no secret: the connector is off'));
  await withEnv({ WORDPRESS_SITE_URL: 'https://wp.example.com', SITE_CONNECTOR_URL: 'https://site.example.com/x.php', SITE_CONNECTOR_SECRET: 's' }, () =>
    assert.equal(siteOrigin(), 'https://wp.example.com')
  );
});

test('the Bing calls use the connector site when WORDPRESS_SITE_URL is not set', async () => {
  const { submitToBing } = await import('../lib/bing');
  const prev = process.env.BING_WEBMASTER_API_KEY;
  process.env.BING_WEBMASTER_API_KEY = 'test-key';
  calls.length = 0;
  try {
    // Reaches the (stubbed) Bing API instead of refusing for a missing WORDPRESS_SITE_URL.
    await withEnv({ SITE_CONNECTOR_URL: 'https://site.example.com/x.php', SITE_CONNECTOR_SECRET: 's' }, () =>
      assert.rejects(submitToBing(['https://site.example.com/a/']), /Network call in a test/)
    );
    // The verified-site lookup (round 12) and then the submission, both to the stubbed Bing API.
    assert.equal(calls.length, 2);
    for (const c of calls) assert.match(c, /bing\.com/);
    assert.match(calls[1], /SubmitUrlBatch/);
  } finally {
    if (prev === undefined) delete process.env.BING_WEBMASTER_API_KEY;
    else process.env.BING_WEBMASTER_API_KEY = prev;
  }
});

test('the website connector refuses drafts before anything is checked, saved or uploaded', { skip: !db, timeout: 60000 }, async () => {
  const { draftsRefused } = await import('../lib/wordpress');
  const on = { SITE_CONNECTOR_URL: 'https://site.example.com/x.php', SITE_CONNECTOR_SECRET: 's' };
  await withEnv(on, () => {
    assert.match(draftsRefused('draft') || '', /switched off/);
    assert.equal(draftsRefused('publish'), null);
  });
  await withEnv({ ...on, SITE_CONNECTOR_DRAFTS: 'on' }, () => assert.equal(draftsRefused('draft'), null));
  await withEnv({ WORDPRESS_SITE_URL: 'https://wp.example.com', WORDPRESS_USERNAME: 'u', WORDPRESS_APPLICATION_PASSWORD: 'p' }, () =>
    assert.equal(draftsRefused('draft'), null, 'WordPress keeps drafts hidden')
  );

  const { default: prisma } = await import('../lib/prisma');
  const { POST } = await import('../app/api/drafts/[id]/publish/route');
  const kw = await prisma.keywords.create({ data: { keyword: `no site draft ${Date.now()}`, status: 'done' } });
  const draft = await prisma.drafts.create({ data: { keyword_id: kw.id, title: 'A plain test blog', meta_description: 'Meta', content_html: '<p>Plain text.</p>', status: 'approved' } });
  calls.length = 0;
  try {
    const res: any = await withEnv(on, () =>
      POST(new Request(`http://x/api/drafts/${draft.id}/publish`, { method: 'POST', body: JSON.stringify({ wpStatus: 'draft' }) }) as any, { params: Promise.resolve({ id: String(draft.id) }) })
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /switched off/);
    assert.deepEqual(calls, [], 'no originality check and no upload');
    const after = (await prisma.drafts.findUnique({ where: { id: draft.id } }))!;
    assert.equal(after.author, null);
    assert.equal(after.featured_image_path, null);
    assert.equal(after.status, 'approved');
  } finally {
    await prisma.drafts.deleteMany({ where: { id: draft.id } });
    await prisma.keywords.deleteMany({ where: { id: kw.id } });
  }
});

test('a Testing-mode skill update is refused while the automatic refresh runs, and holds no run', { skip: !db, timeout: 60000 }, async () => {
  const { POST } = await import('../app/api/skill/generate/route');
  const g = globalThis as any;
  const prevPin = g.__AI_MODE_PIN;
  g.__AI_MODE_PIN = 'testing';
  try {
    assert.equal(claimSkillRun('auto'), null);
    const res: any = await POST();
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /automatic skill refresh/);
    assert.equal(skillRunning(), 'auto', 'the refused press leaves the auto run as it was');
  } finally {
    releaseSkillRun('auto');
    g.__AI_MODE_PIN = prevPin;
  }
  assert.equal(skillRunning(), null);
});

test('the batch-waiting refusal says the batch is collected at the next daily refresh, also in Testing mode', () => {
  assert.match(new SkillBatchWaitingError().message, /next daily refresh/);
  const testing = new SkillBatchWaitingError(true).message;
  assert.match(testing, /next daily refresh \(free, also in Testing mode\)/);
  assert.doesNotMatch(testing, /finishes only once Live mode/);
  assert.match(testing, /further part, which waits for Live mode/);
});
