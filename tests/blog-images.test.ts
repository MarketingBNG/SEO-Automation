// Images inside blogs and the Word preview of a blog.
process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSlots, sectionHeadings, imageTag, placeAtSlot, removeNote, placeAfterSection, inlineImageKeys, publishInlineImages } from '../lib/blogImages';

const html = `<p>Answer first.</p><h2>How the ITIN process works</h2><p>Step one.</p><p>[VISUAL SUGGESTION: a flowchart of the W-7 steps]</p><p>Step two.</p><h2>Fees and timing</h2><p>Costs. [VISUAL SUGGESTION: table of fees]</p><h2>Frequently Asked Questions</h2><h3>Who needs one?</h3><p>Anyone.</p>`;

test('image suggestions and sections are found', () => {
  assert.deepEqual(sectionHeadings(html), ['How the ITIN process works', 'Fees and timing', 'Frequently Asked Questions']);
  const slots = imageSlots(html);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].text, 'a flowchart of the W-7 steps');
  assert.equal(slots[0].section, 'How the ITIN process works');
  assert.equal(slots[1].section, 'Fees and timing');
});

test('an image replaces a suggestion, or the suggestion is removed', () => {
  const tag = imageTag('inline/draft-1-9.png', 'W-7 flowchart', 'The five W-7 steps');
  const placed = placeAtSlot(html, 0, tag);
  assert.ok(placed.includes('<img src="/api/uploads/inline/draft-1-9.png" alt="W-7 flowchart" />'));
  assert.ok(placed.includes('<p><em>The five W-7 steps</em></p>'));
  assert.equal(imageSlots(placed).length, 1, 'the other suggestion stays');
  assert.ok(!placed.includes('<p></p>'), 'the note paragraph is replaced whole');
  const removed = removeNote(placed, 0);
  assert.equal(imageSlots(removed).length, 0);
  assert.ok(removed.includes('<p>Costs. </p>'), 'an inline note is removed from its sentence');
});

test('an image can be added after a section', () => {
  const out = placeAfterSection(html, 1, '<p><img src="/api/uploads/x.png" alt="fees" /></p>');
  const i = out.indexOf('<h2>Fees and timing</h2>');
  const j = out.indexOf('<img src="/api/uploads/x.png"');
  const k = out.indexOf('<h2>Frequently Asked Questions</h2>');
  assert.ok(i < j && j < k, 'inside the Fees section, after its first paragraph');
  assert.ok(placeAfterSection(html, 9, '<p>X</p>').endsWith('<p>X</p>'), 'past the last heading it goes at the end');
});

test('at publish, dashboard images move to WordPress and the tags point there', async () => {
  const body = placeAtSlot(html, 0, imageTag('inline/draft-1-9.png', 'W-7 "flow" & steps'));
  assert.deepEqual(inlineImageKeys(body), ['inline/draft-1-9.png']);
  const calls: any[] = [];
  const r = await publishInlineImages(body, async (key, alt) => {
    calls.push({ key, alt });
    return { id: 77, url: 'https://usaindiacfo.com/wp-content/uploads/w7.png' };
  });
  assert.deepEqual(calls, [{ key: 'inline/draft-1-9.png', alt: 'W-7 "flow" & steps' }]);
  assert.ok(r.html.includes('<img class="aligncenter size-full wp-image-77" src="https://usaindiacfo.com/wp-content/uploads/w7.png"'));
  assert.ok(!r.html.includes('/api/uploads/'));
  assert.equal(r.uploaded.length, 1);
});

test('the Word preview has the cover, the byline, embedded images and visible notes', async () => {
  const { blogDocHtml } = await import('../lib/blogDoc');
  const body = placeAtSlot(html, 0, imageTag('inline/draft-1-9.png', 'W-7 flowchart')) + '<script type="application/ld+json">{}</script>';
  const out = blogDocHtml({
    title: 'ITIN guide',
    meta: 'How to get an ITIN.',
    content: body,
    author: 'Harsh Jain',
    cover: 'data:image/png;base64,AAAA',
    url: 'https://usaindiacfo.com/itin-guide/',
    status: 'pending review',
    keyword: 'itin guide',
    words: 1200,
    images: { 'inline/draft-1-9.png': 'data:image/png;base64,BBBB' },
    now: new Date('2026-10-08T00:00:00Z'),
  });
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA"'), 'cover embedded');
  assert.ok(out.includes('src="data:image/png;base64,BBBB"'), 'article image embedded');
  assert.ok(out.includes('By <strong>Harsh Jain</strong>'), 'byline as published');
  assert.ok(out.includes('<strong>[Image to add here: table of fees]</strong>'), 'remaining suggestion shown as a note');
  assert.ok(!out.includes('<script'), 'schema script stripped');
  assert.ok(out.includes('https://usaindiacfo.com/itin-guide/'));
});

test('a publish that runs again reuses the images already uploaded', async () => {
  const body = placeAtSlot(html, 0, imageTag('inline/draft-1-9.png', 'W-7 flowchart'));
  let calls = 0;
  const r = await publishInlineImages(body, async () => {
    calls++;
    return { id: 1, url: 'https://usaindiacfo.com/x.png' };
  }, { 'inline/draft-1-9.png': { id: 55, url: 'https://usaindiacfo.com/wp-content/uploads/w7.png' } });
  assert.equal(calls, 0, 'nothing uploaded twice');
  assert.ok(r.html.includes('wp-image-55'));
  assert.deepEqual(r.uploaded.map((u) => u.reused), [true]);
});

test('odd alt text and keys cannot break the markup at publish', async () => {
  const body = `<p><img src="/api/uploads/inline/100%25.png" alt="costs $&apos; and $&amp; more" /></p>`;
  assert.deepEqual(inlineImageKeys(body), ['inline/100%.png']);
  const r = await publishInlineImages(body, async () => ({ id: 3, url: 'https://usaindiacfo.com/a.png' }));
  assert.ok(r.html.startsWith('<p><img class="aligncenter size-full wp-image-3" src="https://usaindiacfo.com/a.png" alt="costs $&apos; and $&amp; more" /></p>'), r.html);
  assert.deepEqual(inlineImageKeys('<img src="/api/uploads/bad%zz.png">'), ['bad%zz.png'], 'a malformed escape does not throw');
});

test('an unterminated suggestion note is handled quickly', () => {
  const big = `<p>[VISUAL SUGGESTION: ${'x'.repeat(50000)}</p>`.repeat(20);
  const t = Date.now();
  assert.equal(imageSlots(big).length, 0);
  assert.ok(Date.now() - t < 2000);
});

test('the Word preview never downloads pictures from the web', async () => {
  const { blogDocHtml } = await import('../lib/blogDoc');
  const out = blogDocHtml({
    title: 'T',
    meta: 'M',
    content: '<p>Intro.</p><p><img src="https://evil.example/x.png" alt="Chart" /></p><p>Costs. [VISUAL SUGGESTION: fee table]</p><table><caption>Fees</caption><tr><td>1</td></tr></table><p><img src="/api/uploads/missing.png" alt="Gone" /></p>',
    url: 'https://usaindiacfo.com/t/',
    status: 'draft',
    images: {},
  });
  assert.ok(out.includes('<em>[Image: Chart (https://evil.example/x.png)]</em>'), 'the address is shown as text, not fetched');
  assert.ok(!/<img\b[^>]*src="(?!data:image\/)/i.test(out), 'only embedded pictures remain');
  assert.ok(out.includes('<em>[Image: Gone (/api/uploads/missing.png)]</em>'), 'a missing dashboard file is named');
  assert.ok(out.includes('Costs. <strong>[Image to add here: fee table]</strong>'), 'an inline note stays in its sentence');
  assert.ok(out.includes('<p><strong>Fees</strong></p><table>'), 'table caption becomes a line above the table');
});

test('the byline goes after the first paragraph with words, not after a leading image', async () => {
  const { withByline } = await import('../lib/byline');
  const out = withByline('<p><img src="/api/uploads/a.png" alt="x" /></p><p>Answer first.</p><p>More.</p>', 'Harsh Jain', null, new Date('2026-10-08T00:00:00Z'));
  assert.ok(out.indexOf('Answer first.') < out.indexOf('uic-byline'));
  assert.ok(out.indexOf('uic-byline') < out.indexOf('More.'));
});
