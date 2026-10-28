// Review round 12: a held blog is notified again when its reasons change (not when only the
// publishing-pause text does), Bing gets the verified site address, and the upload tool's rule for
// images attached before files were recorded covers assistant images only. The database test uses
// DATABASE_URL (local test database only). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdChanged } from '../lib/strategy/autopilot';
import { submitToBing, testBing } from '../lib/bing';

const db = Boolean(process.env.DATABASE_URL);

// Nothing in these tests may reach an outside service; Bing calls are answered here.
process.env.SLACK_WEBHOOK_URL = '';
const bingCalls: { method: string; body: any }[] = [];
let bingSites: string[] = [];
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url instanceof Request ? url.url : url);
  const m = u.match(/^https:\/\/ssl\.bing\.com\/webmaster\/api\.svc\/json\/(\w+)\?/);
  if (!m) throw new Error(`Network call in a test: ${u}`);
  bingCalls.push({ method: m[1], body: init?.body ? JSON.parse(init.body) : null });
  const json = m[1] === 'GetUserSites' ? { d: bingSites.map((Url) => ({ Url })) } : { d: null };
  return new Response(JSON.stringify(json), { status: 200 });
}) as any;

test('a held blog is notified again when its reasons change, not when only the pause text changes', () => {
  const pause = (why: string) => `Auto-publishing paused: ${why}.`;
  const fc = 'Fact check could not confirm every claim from a primary source after 3 rounds.';
  assert.equal(holdChanged(JSON.stringify([pause('site returned 503')]), [fc]), true, 'the pause lifted and the fact check failed');
  assert.equal(holdChanged(JSON.stringify([pause('site returned 503')]), [pause('robots.txt blocks all crawlers')]), false);
  assert.equal(holdChanged(JSON.stringify([fc]), [fc]), false, 'same reasons: no repeat notice');
  assert.equal(holdChanged(JSON.stringify([pause('x'), fc]), [fc]), false, 'only the pause cleared');
  assert.equal(holdChanged(null, [fc]), true);
  assert.equal(holdChanged('not json', [fc]), true);
});

test('Bing gets the verified site address (www or not, as Bing has it), the one the Settings test finds', async () => {
  const saved = { WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL, SITE_CONNECTOR_URL: process.env.SITE_CONNECTOR_URL, SITE_CONNECTOR_SECRET: process.env.SITE_CONNECTOR_SECRET, BING_WEBMASTER_API_KEY: process.env.BING_WEBMASTER_API_KEY };
  delete process.env.WORDPRESS_SITE_URL;
  process.env.SITE_CONNECTOR_URL = 'https://www.example-site.test/_bridge/x';
  process.env.SITE_CONNECTOR_SECRET = 's';
  process.env.BING_WEBMASTER_API_KEY = 'test-key';
  try {
    bingSites = ['https://example-site.test/'];
    assert.equal((await testBing()).site, 'https://example-site.test/');
    bingCalls.length = 0;
    await submitToBing(['https://www.example-site.test/a']);
    const submit = bingCalls.find((c) => c.method === 'SubmitUrlBatch')!;
    assert.equal(submit.body.siteUrl, 'https://example-site.test/', 'the verified address, not the connector host');
    bingCalls.length = 0;
    await submitToBing(['https://www.example-site.test/b']);
    assert.deepEqual(bingCalls.map((c) => c.method), ['SubmitUrlBatch'], 'the verified address is kept');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('the upload tool does not treat a Drafts & Review image as an unrecorded assistant attachment', { skip: !db, timeout: 60000 }, async () => {
  const { default: prisma } = await import('../lib/prisma');
  const { ownImageIds } = await import('../lib/assistant/fileAccess');
  const stamp = Date.now();
  const legacy = await prisma.image_library.create({ data: { filename: 'old.png', path: `assistant/${stamp}-old.png` } });
  const inline = await prisma.image_library.create({ data: { filename: 'draft.png', path: `inline/draft-1-${stamp}.png` } });
  const member = { email: 'member-r12@example.com', name: 'Member', role: 'user' };
  try {
    assert.deepEqual(await ownImageIds(member, [legacy.id, inline.id], { legacy: true }), [legacy.id]);
    assert.deepEqual(await ownImageIds({ ...member, role: 'admin' }, [inline.id], { legacy: true }), [inline.id], 'an admin may upload any image');
  } finally {
    await prisma.image_library.deleteMany({ where: { id: { in: [legacy.id, inline.id] } } });
  }
});
