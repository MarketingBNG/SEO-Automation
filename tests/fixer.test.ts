import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = () => import('../lib/strategy/fixer');

test('each crawl issue maps to the right automatic fix', async () => {
  const { fixKind, unwrapLinks } = await load();
  assert.equal(fixKind('Broken link to https://x.com/a (404)'), 'broken_link');
  assert.equal(fixKind('404 status code'), 'redirect');
  assert.equal(fixKind('500 status code'), 'manual');
  assert.equal(fixKind('Missing title'), 'title');
  assert.equal(fixKind('Duplicate title'), 'title');
  assert.equal(fixKind('Missing meta description'), 'meta');
  assert.equal(fixKind('Thin content (120 words)'), 'thin');
  assert.equal(fixKind('Slow page speed'), 'manual');
});

test('a broken link is removed and its text kept', async () => {
  const { unwrapLinks } = await load();
  const html = '<p>See <a href="https://old.com/page/">our guide</a> and <a href="https://ok.com">this</a>.</p>';
  assert.equal(unwrapLinks(html, 'https://old.com/page'), '<p>See our guide and <a href="https://ok.com">this</a>.</p>');
});
