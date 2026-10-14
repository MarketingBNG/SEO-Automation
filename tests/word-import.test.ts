// A blog downloaded as Word, edited and uploaded again must come back as the same blog body:
// without the info block, cover, title line and byline the download adds around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import { htmlToDocx } from '../lib/docx';
import { blogFromWordHtml, dataImages } from '../lib/wordImport';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BODY = `<p>An ITIN is a <a href="https://www.irs.gov/itin">nine-digit number</a> for tax.</p><h2>Meaning</h2><p>Text <strong>bold</strong>.</p><p>[VISUAL SUGGESTION: a chart of ITIN ranges]</p><p><img src="/api/uploads/inline/draft-1-1.png" alt="ITIN ranges" /></p><p>Check [PRACTITIONER NOTE NEEDED: an example] here.</p><table><caption>ID types</caption><thead><tr><th>Who</th><th>Number</th></tr></thead><tbody><tr><td>People</td><td>SSN or ITIN</td></tr></tbody></table><h2>Frequently Asked Questions</h2><h3>Who needs an ITIN?</h3><p>Anyone who must file a US return but cannot get a Social Security number.</p>`;

async function roundTrip(body = BODY) {
  const { blogDocHtml } = await import('../lib/blogDoc');
  const html = blogDocHtml({ title: 'ITIN guide for NRIs', meta: 'What an ITIN is and how to apply.', content: body, author: 'Jane Doe', reviewer: 'CA Ravi, CA', cover: `data:image/png;base64,${PNG}`, url: 'https://usaindiacfo.com/itin/', status: 'in review', images: { 'inline/draft-1-1.png': `data:image/png;base64,${PNG}` } });
  const docx = await htmlToDocx(html, { title: 't' });
  return blogFromWordHtml((await mammoth.convertToHtml({ buffer: docx })).value);
}

test('the downloaded Word file comes back as the blog body', async () => {
  const blog = await roundTrip();
  assert.equal(blog.title, 'ITIN guide for NRIs');
  assert.equal(blog.meta, 'What an ITIN is and how to apply.');
  const c = blog.content;
  assert.ok(c.startsWith('<p>An ITIN is a <a href="https://www.irs.gov/itin">nine-digit number</a>'), c.slice(0, 120));
  assert.ok(!/grey block|Meta description|Jane Doe|Reviewed by|<h1/i.test(c), 'info block, title and byline are taken off');
  assert.ok(c.includes('<p>[VISUAL SUGGESTION: a chart of ITIN ranges]</p>'));
  assert.ok(c.includes('[PRACTITIONER NOTE NEEDED: an example]'));
  assert.ok(c.includes('<table><caption>ID types</caption><thead><tr><th>Who</th><th>Number</th></tr></thead><tbody><tr><td>People</td><td>SSN or ITIN</td></tr></tbody></table>'), c);
  assert.ok(c.includes('<h2>Frequently Asked Questions</h2><h3>Who needs an ITIN?</h3>'));
});

test('a picture comes back with the same bytes, so the route can keep its stored file', async () => {
  const imgs = dataImages((await roundTrip()).content);
  assert.equal(imgs.length, 1, 'the cover is taken off with the title, the body picture stays');
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  assert.equal(sha(Buffer.from(imgs[0].base64, 'base64')), sha(Buffer.from(PNG, 'base64')));
});

test('a Word file written from scratch is taken as it is', () => {
  const blog = blogFromWordHtml('<p>Intro paragraph.</p><h2>Part</h2><p>By the way, <a href="javascript:alert(1)">this</a> is text.</p><p></p>');
  assert.equal(blog.title, null);
  assert.equal(blog.meta, null);
  assert.equal(blog.content, '<p>Intro paragraph.</p><h2>Part</h2><p>By the way, <a>this</a> is text.</p>');
});
test('the picture above the title is returned as the cover', () => {
  const html = '<p><img src="data:image/png;base64,QUJD" alt="x" /></p><h1>Title</h1><h2>One</h2><p>Body text.</p>';
  const blog = blogFromWordHtml(html);
  assert.equal(blog.cover, 'data:image/png;base64,QUJD');
  assert.ok(!blog.content.includes('QUJD'));
  assert.equal(blogFromWordHtml('<h1>Title</h1><p>Body.</p>').cover, null);
});
