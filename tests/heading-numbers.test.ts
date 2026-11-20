import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHeadingNumbers } from '../lib/site';

test('leading numbers are removed from H2 to H4 only', () => {
  const html = '<h2>1. EIN number India: the PAN</h2><h3 id="x">2) Who needs it</h3><h2><strong>10. FAQ</strong></h2><h4>Step 3: Apply</h4><p>1. Keep this paragraph.</p><h2>2026 deadlines</h2><h2>Section 80C limits</h2>';
  assert.equal(
    stripHeadingNumbers(html),
    '<h2>EIN number India: the PAN</h2><h3 id="x">Who needs it</h3><h2><strong>FAQ</strong></h2><h4>Apply</h4><p>1. Keep this paragraph.</p><h2>2026 deadlines</h2><h2>Section 80C limits</h2>'
  );
});
