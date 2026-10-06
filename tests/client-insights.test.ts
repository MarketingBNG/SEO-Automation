// The safety check that decides whether a cleaned meeting insight can be approved automatically.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = () => import('../lib/clientInsights');

const raw = `- Ontario tax ~26.5% combining federal and provincial rates; pricing starts at USD 1,450, adjustable to CAD for clients.
- Formation takes 30-35 working days. Contact amit.agarwal@example.com`;

test('the raw meeting notes from the screenshot are NOT safe', async () => {
  const { leftovers, identifiers } = await load();
  const ids = identifiers('Reg: Canada Business Incorporation Understanding (Amit Agarwal)', ['amit.agarwal@example.com']);
  assert.deepEqual(ids.sort(), ['agarwal', 'amit']);
  const r = leftovers(raw, ids);
  assert.ok(r.includes('a price or money amount'));
  assert.ok(r.includes('an email address'));
  assert.ok(r.includes('the name "amit"'));
});

test('properly cleaned notes are safe', async () => {
  const { leftovers } = await load();
  const cleaned = `- Choosing a Canadian province to incorporate in, and why Ontario is common for non-resident founders.
- Corporation (Inc.) vs other structures in Canada; federal vs provincial registration.
- What documents a non-resident founder needs to incorporate.`;
  assert.deepEqual(leftovers(cleaned, ['amit', 'agarwal']), []);
});

test('a cleaned text that still has a price or name is held for review', async () => {
  const { leftovers } = await load();
  assert.ok(leftovers('Fees from Rs 50,000 discussed.', []).length > 0);
  assert.ok(leftovers('Amit asked about Ontario.', ['amit']).length > 0);
  assert.deepEqual(leftovers('Founders asked about Ontario tax residency.', ['amit']), []);
});
