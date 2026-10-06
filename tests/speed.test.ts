// Speed fixer: every copy of an image in the page is switched to the WebP file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const load = () => import('../lib/strategy/speed');

test('an image and its resized copies are swapped, srcset removed, other images untouched', async () => {
  const { swapImage } = await load();
  const old = 'https://usaindiacfo.com/wp-content/uploads/2026/05/tax-chart-scaled.jpg';
  const html =
    '<p><img src="https://usaindiacfo.com/wp-content/uploads/2026/05/tax-chart-1024x683.jpg" srcset="https://usaindiacfo.com/wp-content/uploads/2026/05/tax-chart-300x200.jpg 300w, https://usaindiacfo.com/wp-content/uploads/2026/05/tax-chart-1024x683.jpg 1024w" sizes="(max-width: 1024px) 100vw" alt="Tax chart"></p>' +
    '<p><img src="https://usaindiacfo.com/wp-content/uploads/2026/05/other.jpg" srcset="a 1w"></p>' +
    '<a href="https://usaindiacfo.com/wp-content/uploads/2026/05/tax-chart-scaled.jpg">full size</a>';
  const out = swapImage(html, old, 'https://usaindiacfo.com/wp-content/uploads/2026/10/tax-chart.webp');
  assert.ok(out.includes('<img src="https://usaindiacfo.com/wp-content/uploads/2026/10/tax-chart.webp" alt="Tax chart">'), out);
  assert.ok(out.includes('other.jpg" srcset="a 1w"'), 'other images keep their srcset');
  assert.ok(out.includes('href="https://usaindiacfo.com/wp-content/uploads/2026/10/tax-chart.webp"'));
  assert.ok(!out.includes('tax-chart-300x200.jpg'));
});

test('WebP conversion makes a big photo much smaller', async () => {
  const noise = Buffer.alloc(1200 * 800 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + (i >> 7)) % 256;
  const jpg = await sharp(noise, { raw: { width: 1200, height: 800, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const webp = await sharp(jpg).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  assert.ok(webp.length < jpg.length, `${webp.length} < ${jpg.length}`);
});
