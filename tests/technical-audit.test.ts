// Screaming Frog "Internal All" parser: assets and redirects are not pages, and status 0 is broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScreamingFrogCsv } from '../lib/technicalAudit';

const csv = [
  'Address,Content Type,Status Code,Indexability,Title 1,Meta Description 1,Word Count',
  'https://s.com/,text/html; charset=UTF-8,200,Indexable,Home,Hello,800',
  'https://s.com/a,text/html; charset=UTF-8,200,Indexable,,,120',
  'https://s.com/logo.png,image/png,200,Indexable,,,0',
  'https://s.com/app.js,application/javascript,200,Indexable,,,0',
  'https://s.com/old,text/html,301,Non-Indexable,,,0',
  'https://s.com/gone,text/html,404,Non-Indexable,,,0',
  'https://s.com/slow,,0,Non-Indexable,,,0',
].join('\n');

test('only HTML pages get title, meta and thin-content checks; status 0 counts as broken', () => {
  const r = parseScreamingFrogCsv(Buffer.from(csv));
  assert.equal(r.missingTitleCount, 1);
  assert.equal(r.missingMetaCount, 1);
  assert.equal(r.thinContentCount, 1);
  assert.equal(r.brokenCount, 2);
  assert.deepEqual(r.problemUrls.map((p) => p.url).sort(), ['https://s.com/a', 'https://s.com/gone', 'https://s.com/slow']);
  assert.deepEqual(r.problemUrls.find((p) => p.url === 'https://s.com/slow').issues, ['no response']);
});
