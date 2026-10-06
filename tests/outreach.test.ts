// Backlink outreach through Smartlead: contact picking, names, duplicates, daily cap, and the key never leaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = () => import('../lib/strategy/outreach');

test('picks the site own editorial email and skips junk', async () => {
  const { pickEmail } = await load();
  const html = 'noreply@site.com <a href="mailto:editor@site.com">x</a> jane@gmail.com logo@2x.png';
  assert.equal(pickEmail(html, 'site.com'), 'editor@site.com');
  assert.equal(pickEmail('nothing here', 'site.com'), null);
});

test('names only come from personal-looking addresses', async () => {
  const { nameFromEmail } = await load();
  assert.deepEqual(nameFromEmail('jane.doe@site.com'), { first_name: 'Jane', last_name: 'Doe' });
  assert.deepEqual(nameFromEmail('info@site.com'), { first_name: '', last_name: '' });
  assert.deepEqual(nameFromEmail('editor.team@site.com'), { first_name: '', last_name: '' });
});

test('methods route to Smartlead, automatic internal links, or a person', async () => {
  const { outreachMethod } = await load();
  assert.equal(outreachMethod('Outreach to SE Ranking backlink gap site'), 'email');
  assert.equal(outreachMethod('Unlinked brand mention'), 'email');
  assert.equal(outreachMethod('Internal linking (automatic)'), 'internal');
  assert.equal(outreachMethod('Directory or citation listing'), 'manual');
});

test('the Smartlead key is sent only as the query parameter and never appears in errors', async () => {
  process.env.SMARTLEAD_API_KEY = 'test-key-123';
  process.env.SMARTLEAD_CAMPAIGN_ID = '4092181';
  const seen: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push(String(url));
    return new Response(`bad request for ${String(url)}`, { status: 400 });
  }) as any;
  try {
    const { addLead } = await import('../lib/smartlead');
    await assert.rejects(addLead({ email: 'a@b.com' }), (e: any) => !e.message.includes('test-key-123') && e.message.includes('[key hidden]'));
    assert.match(seen[0], /^https:\/\/server\.smartlead\.ai\/api\/v1\/campaigns\/4092181\/leads\?api_key=test-key-123$/);
  } finally {
    globalThis.fetch = orig;
    delete process.env.SMARTLEAD_API_KEY;
    delete process.env.SMARTLEAD_CAMPAIGN_ID;
  }
});

test('a description is not treated as a website; a domain is', async () => {
  const { isRealSite } = await load();
  assert.equal(isRealSite('examplecpa.com'), true);
  assert.equal(isRealSite('https://www.examplecpa.co.in/blog'), true);
  assert.equal(isRealSite('Clutch (company profile for a virtual CFO and accounting firm)'), false);
  assert.equal(isRealSite('Pages on startup and NRI resource sites that link to dead ITIN or EIN guides'), false);
  assert.equal(isRealSite('DATA MISSING: SE Ranking backlink gap list'), false);
});
