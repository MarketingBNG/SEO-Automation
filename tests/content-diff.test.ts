import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffContent, articleSimilarity, units } from '../lib/contentDiff';

const base = `<h2>Who must file an FBAR</h2>
<p>A US person must file an FBAR when foreign accounts exceed $10,000 in total at any time in the year.</p>
<p>The deadline is April 15, with an automatic extension to October 15.</p>
<h2>Frequently Asked Questions</h2>
<h3>Does an NRE account count?</h3>
<p>Yes. An NRE account is a foreign financial account for FBAR purposes.</p>
<p>Talk to our team about your filing: <a href="https://usaindiacfo.com/contact-us/">book a call</a>.</p>`;

test('the same article reports no change', () => {
  const r = diffContent({ html: base }, { html: base });
  assert.equal(r.kind, 'none');
  assert.equal(r.changedPct, 0);
  assert.equal(r.summary, 'No change to the words.');
});

test('a reworded sentence with a new figure is found, and the number flagged', () => {
  const edited = base.replace('exceed $10,000 in total', 'exceed $12,000 in total');
  const r = diffContent({ html: base }, { html: edited });
  assert.equal(r.reworded, 1);
  assert.equal(r.added, 0);
  assert.equal(r.removed, 0);
  assert.equal(r.numbersChanged, 1);
  assert.equal(r.kind, 'medium');
  assert.match(r.summary, /re-verify/);
  assert.equal(r.samples[0].type, 'reworded');
  assert.equal(r.samples[0].numbers, true);
});

test('an added FAQ answer and a new link are counted', () => {
  const edited = base.replace('<p>Talk to our team', '<h3>Is a PPF account reportable?</h3><p>Yes, a PPF account is reportable on the FBAR.</p><p>Read our <a href="https://usaindiacfo.com/fbar/">FBAR guide</a>.</p><p>Talk to our team');
  const r = diffContent({ html: base }, { html: edited });
  assert.equal(r.added, 3);
  assert.equal(r.headingsChanged, 1);
  assert.equal(r.faqChanged, true);
  assert.deepEqual(r.linksAdded, ['https://usaindiacfo.com/fbar/']);
  assert.equal(r.ctaChanged, false);
});

test('title and meta changes are reported even when the body is the same', () => {
  const r = diffContent({ title: 'FBAR guide', meta: 'Old meta', html: base }, { title: 'FBAR filing guide for NRIs', meta: 'Old meta', html: base });
  assert.equal(r.titleChanged, true);
  assert.equal(r.metaChanged, false);
  assert.notEqual(r.kind, 'none');
  assert.match(r.summary, /title changed/);
});

test('a heavy rewrite is called heavy and a re-upload of the same piece is recognised', () => {
  const rewritten = `<h2>FBAR basics</h2><p>Every US person with foreign accounts over the threshold files the FBAR.</p><p>Penalties for missing it are steep.</p>`;
  const r = diffContent({ html: base }, { html: rewritten });
  assert.equal(r.kind, 'heavy');
  assert.ok(articleSimilarity(base, base.replace('book a call', 'book a free call')) > 0.8);
  assert.ok(articleSimilarity(base, rewritten) < 0.3);
});

test('units keep headings apart from sentences and know their section', () => {
  const u = units(base);
  assert.equal(u[0].kind, 'heading');
  assert.equal(u[1].section, 'Who must file an FBAR');
  assert.ok(u.some((x) => x.kind === 'text' && /Frequently Asked Questions/.test(x.section)));
});
