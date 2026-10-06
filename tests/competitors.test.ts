// Competitors found automatically from who ranks next to us: government, forums and media are dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = () => import('../lib/competitors');

test('only possible business competitors are kept', async () => {
  const { candidateDomains } = await load();
  const got = candidateDomains(
    [
      { domain: 'www.irs.gov', top5Appearances: 9 },
      { domain: 'reddit.com', top5Appearances: 7 },
      { domain: 'incometaxindia.gov.in', top5Appearances: 6 },
      { domain: 'www.examplecfo.com', top5Appearances: 5 },
      { domain: 'usaindiacfo.com', top5Appearances: 5 },
      { domain: 'forbes.com', top5Appearances: 3 },
      { domain: 'crossbordertax.in', top5Appearances: 2 },
    ],
    'usaindiacfo.com'
  ).map((c) => c.domain);
  assert.deepEqual(got, ['examplecfo.com', 'crossbordertax.in']);
});
