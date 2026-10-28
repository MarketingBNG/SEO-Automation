// Deleting a draft puts its keyword back in the manual queue only for a plain blog that never went live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requeueAfterDelete } from '../lib/draftDelete';

test('a plain blog keyword goes back to the queue', () => {
  assert.equal(requeueAfterDelete({ kind: 'blog', wp_post_url: null }, 'Batch 3'), true);
  assert.equal(requeueAfterDelete({ kind: null }, null), true);
});

test('calendar, topic and LinkedIn keywords are not queued again', () => {
  assert.equal(requeueAfterDelete({ kind: 'blog' }, 'Strategy #4'), false);
  assert.equal(requeueAfterDelete({ kind: 'blog' }, 'Topics'), false);
  assert.equal(requeueAfterDelete({ kind: 'article' }, 'LinkedIn articles'), false);
  assert.equal(requeueAfterDelete({ kind: 'blog' }, 'LinkedIn articles'), false);
});

test('a blog already on the website is not written again', () => {
  assert.equal(requeueAfterDelete({ kind: 'blog', wp_post_url: 'https://example.com/x/' }, 'Batch 3'), false);
});
