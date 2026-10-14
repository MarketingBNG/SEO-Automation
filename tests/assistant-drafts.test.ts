// The assistant edits dashboard blog drafts: exact find-and-replace (all or nothing), whole-field
// updates, and Undo that refuses to wipe out later edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';

const BODY = '<p>An ITIN is a nine-digit number.</p><h2>Who needs one</h2><p>Non-residents who file a US return.</p><p><img src="/api/uploads/inline/draft-7-1.png" alt="x" /></p><p>[VISUAL SUGGESTION: a flow chart]</p>';
const db: any = { draft: null, updates: [] as any[] };
(globalThis as any).prisma = {
  drafts: {
    findUnique: async ({ where }: any) => (db.draft && where.id === db.draft.id ? { ...db.draft } : null),
    update: async ({ where, data }: any) => {
      db.updates.push(data);
      db.draft = { ...db.draft, ...data };
      return db.draft;
    },
  },
};
const reset = () => {
  db.draft = { id: 7, title: 'ITIN guide', meta_description: 'meta', content_html: BODY, status: 'rejected', wp_post_url: null };
  db.updates = [];
};
const tools = () => import('../lib/assistant/tools');

test('draft_edit_text replaces a paragraph and adds one after another, in one change', async () => {
  reset();
  const { getTool } = await tools();
  const t = getTool('draft_edit_text');
  const input = {
    id: 7,
    edits: [
      { find: '<p>An ITIN is a nine-digit number.</p>', replace: '<p>An ITIN is a nine-digit tax number from the IRS.</p>' },
      { find: 'file a US return.</p>', replace: 'file a US return.</p><p>Dependents of visa holders may need one too.</p>' },
    ],
  };
  const preview = await t.preview(input);
  assert.equal(preview.problem, null);
  assert.equal(preview.warning, null);
  assert.equal(preview.changes.length, 2);
  assert.match(preview.changes[0].after, /tax number from the IRS/);
  const out = await t.run(input);
  assert.equal(db.updates.length, 1);
  assert.ok(db.draft.content_html.startsWith('<p>An ITIN is a nine-digit tax number from the IRS.</p><h2>Who needs one</h2>'));
  assert.ok(db.draft.content_html.includes('return.</p><p>Dependents of visa holders may need one too.</p><p><img'));
  assert.equal(out.change.targetType, 'draft');
  assert.equal(out.change.undo.fields.content_html, BODY);
});

test('one change that does not match: nothing is applied', async () => {
  reset();
  const { getTool } = await tools();
  const t = getTool('draft_edit_text');
  const input = { id: 7, edits: [{ find: 'nine-digit', replace: '9-digit' }, { find: 'not in the blog', replace: 'x' }, { find: '<p>', replace: '<p class="x">' }] };
  const preview = await t.preview(input);
  assert.match(preview.problem, /Change 2: the text was not found/);
  assert.match(preview.problem, /Change 3: the text appears 4 times/);
  await assert.rejects(t.run(input), /Nothing was changed/);
  assert.equal(db.updates.length, 0);
  assert.equal(db.draft.content_html, BODY);
});

test('Undo restores the draft, unless it was edited again since', async () => {
  reset();
  const { getTool, undoChange } = await tools();
  const { change } = await getTool('draft_edit_text').run({ id: 7, edits: [{ find: 'nine-digit', replace: '9-digit' }] });
  assert.equal(await undoChange(change.undo), 'Restored the previous version of the draft.');
  assert.equal(db.draft.content_html, BODY);

  const again = await getTool('draft_edit_text').run({ id: 7, edits: [{ find: 'nine-digit', replace: '9-digit' }] });
  db.draft.content_html += '<p>Typed later in Drafts &amp; Review.</p>';
  await assert.rejects(undoChange(again.change.undo), (e: any) => e.code === 'CHANGED_SINCE');
  await undoChange(again.change.undo, { force: true });
  assert.equal(db.draft.content_html, BODY);
});

test('draft_update_fields: title and meta, and a whole-article swap that warns about lost images', async () => {
  reset();
  const { getTool, riskOf } = await tools();
  const t = getTool('draft_update_fields');
  await t.run({ id: 7, title: 'ITIN number: meaning and how to apply', meta_description: 'New meta' });
  assert.equal(db.draft.title, 'ITIN number: meaning and how to apply');
  assert.equal(db.draft.meta_description, 'New meta');
  assert.equal(db.draft.content_html, BODY);
  assert.equal(riskOf(t, { id: 7, title: 'x' }), 'low');

  const article = `<h1>Title</h1><p>${'word '.repeat(150)}</p>`;
  assert.equal(riskOf(t, { id: 7, content_html: article }), 'medium');
  const preview = await t.preview({ id: 7, content_html: article });
  assert.equal(preview.problem, null);
  assert.match(preview.warnings.join(' '), /1 image\(s\) in the current article are not in the new one/);
  assert.match(preview.warnings.join(' '), /<h1>/);
  await assert.rejects(t.run({ id: 7, content_html: '<p>Too short.</p>' }), /under 100 words/);
});

test('a published draft: the change is allowed and the note says the website is not touched', async () => {
  reset();
  db.draft.wp_post_url = 'https://usaindiacfo.com/itin/';
  const { getTool } = await tools();
  const preview = await getTool('draft_edit_text').preview({ id: 7, edits: [{ find: 'nine-digit', replace: '9-digit' }] });
  assert.equal(preview.problem, null);
  assert.match(preview.warning, /already on the website/);
});
