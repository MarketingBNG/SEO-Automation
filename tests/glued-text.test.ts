// Text whose spaces were lost (seen in a reviewed draft) is sent back to the writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

test('run-together words and amounts are found; normal text is not', async () => {
  const { gluedText } = await import('../lib/validation');
  assert.deepEqual(gluedText('US$60 orUS$0.0002'), ['orUS$0.0002']);
  assert.ok(gluedText('withholding US$11,850,sotheIndiancompanyreceivesUS$67,150').length > 0);
  assert.ok(gluedText('US$100foraWyomingLLCandUS$110').length > 0);
  assert.deepEqual(gluedText('Fees of US$300 or ₹2 crore (₹20 million), about US$1.5bn; INR 50,000 and USD 400 for counterintelligence work.'), []);
  assert.deepEqual(gluedText('US$60 or US$0.0002 per dollar of Wyoming assets; franchise tax minimum US$175 or US$400.'), []);
});
