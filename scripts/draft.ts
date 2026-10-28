// Edit dashboard blog drafts from Claude Code, without the dashboard's AI (no API credits).
//
//   npx tsx scripts/draft.ts list [words]   drafts, newest first (optionally matching title/keyword)
//   npx tsx scripts/draft.ts get <id>       saves .drafts/<id>/content.html and draft.json
//   npx tsx scripts/draft.ts diff <id>      the local copy against the dashboard, word by word
//   npx tsx scripts/draft.ts put <id>       saves the local title, meta and article to the dashboard
//
// Needs DRAFT_EDIT_TOKEN (the same value as on the server, see lib/draftToken.ts; or a network secret
// that adds "Authorization: Bearer <token>" for the dashboard's host) and optionally
// DASHBOARD_URL (default https://seo.usaindiacfo.us). "put" refuses when the draft was saved in the
// dashboard after "get", so nobody's edits are overwritten; run "get" again and redo the change.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const BASE = (process.env.DASHBOARD_URL || 'https://seo.usaindiacfo.us').replace(/\/+$/, '');
const TOKEN = process.env.DRAFT_EDIT_TOKEN || '';
const DIR = path.join(process.cwd(), '.drafts');

async function api(method: string, p: string, body?: unknown) {
  // Without DRAFT_EDIT_TOKEN the header may still be added on the way out (a network secret).
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error(`${method} ${p}: not signed in. Set DRAFT_EDIT_TOKEN here (same value as on the server), or add it as a network secret for ${new URL(BASE).host}.`);
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${json.error || res.statusText}`);
  return json;
}

const files = (id: string) => ({ dir: path.join(DIR, id), html: path.join(DIR, id, 'content.html'), json: path.join(DIR, id, 'draft.json') });
const words = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

function save(id: string, d: any) {
  const f = files(id);
  fs.mkdirSync(f.dir, { recursive: true });
  fs.writeFileSync(f.html, d.content_html || '');
  const info = {
    id: d.id,
    title: d.title || '',
    meta_description: d.meta_description || '',
    status: d.status,
    calendar: d.schedule ? { status: d.schedule.status, publish_at: d.schedule.publish_at, plan: d.schedule.publish_plan?.headline || null } : null,
    keyword: d.keyword,
    wp_post_url: d.wp_post_url || null,
    updated_at: d.updated_at,
    // Also catches an image placed or an image note removed in the dashboard, which keep updated_at.
    text_hash: d.text_hash || null,
    note: 'Edit title / meta_description here and the article in content.html, then: npx tsx scripts/draft.ts put ' + id,
  };
  fs.writeFileSync(f.json, JSON.stringify(info, null, 2) + '\n');
  return info;
}

function readLocal(id: string) {
  const f = files(id);
  if (!fs.existsSync(f.json)) throw new Error(`No local copy of draft ${id}. Run: npx tsx scripts/draft.ts get ${id}`);
  return { info: JSON.parse(fs.readFileSync(f.json, 'utf8')), html: fs.readFileSync(f.html, 'utf8') };
}

// One block per line, so a word diff of a one-line article is readable.
const blocks = (html: string) => String(html || '').replace(/(<\/(?:p|h[1-6]|li|tr|table|ul|ol|blockquote|figure)>)/gi, '$1\n');

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'list': {
      const q = [arg, ...rest].filter(Boolean).join(' ').toLowerCase();
      const rows: any[] = await api('GET', '/api/drafts/list');
      const hit = rows.filter((r) => !q || `${r.title} ${r.keyword}`.toLowerCase().includes(q)).slice(0, 40);
      for (const r of hit) console.log(`#${r.id}\t${r.status}\t${r.word_count ?? '?'} words\t${r.title || '(untitled)'}${r.keyword ? `  [${r.keyword}]` : ''}`);
      if (!hit.length) console.log('No drafts match.');
      return;
    }
    case 'get': {
      if (!arg) throw new Error('Usage: get <id>');
      const info = save(arg, await api('GET', `/api/drafts/${arg}`));
      console.log(`Saved .drafts/${arg}/ (${words(fs.readFileSync(files(arg).html, 'utf8'))} words)`);
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    case 'diff': {
      if (!arg) throw new Error('Usage: diff <id>');
      const local = readLocal(arg);
      const live = await api('GET', `/api/drafts/${arg}`);
      if (live.updated_at !== local.info.updated_at) console.log(`Note: the dashboard copy was saved at ${live.updated_at}, after this local copy was read (${local.info.updated_at}).\n`);
      else if (local.info.text_hash && live.text_hash !== local.info.text_hash) console.log('Note: the dashboard copy changed after this local copy was read (an image placed or an image note removed). Run get again and redo the edit.\n');
      for (const k of ['title', 'meta_description'] as const) {
        if ((live[k] || '') !== local.info[k]) console.log(`${k}:\n  - ${live[k] || ''}\n  + ${local.info[k]}\n`);
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-'));
      fs.writeFileSync(path.join(tmp, 'dashboard.html'), blocks(live.content_html));
      fs.writeFileSync(path.join(tmp, 'local.html'), blocks(local.html));
      try {
        execFileSync('git', ['--no-pager', 'diff', '--no-index', '--word-diff=plain', '--word-diff-regex=[^[:space:]<>]+|[<>]', path.join(tmp, 'dashboard.html'), path.join(tmp, 'local.html')], { stdio: 'inherit' });
        console.log('No changes in the article.');
      } catch {
        // git diff exits 1 when the files differ; the diff is already printed.
      }
      console.log(`\nWords: ${words(live.content_html)} -> ${words(local.html)}`);
      return;
    }
    case 'put': {
      if (!arg) throw new Error('Usage: put <id>');
      const { info, html } = readLocal(arg);
      if (words(html) < 100) throw new Error(`content.html has only ${words(html)} words; refusing to save.`);
      await api('PATCH', `/api/drafts/${arg}`, { title: info.title, meta_description: info.meta_description, content_html: html, if_updated_at: info.updated_at, ...(info.text_hash ? { if_text_hash: info.text_hash } : {}) });
      const fresh = save(arg, await api('GET', `/api/drafts/${arg}`));
      console.log(`Saved draft #${arg} to the dashboard (${words(html)} words, saved at ${fresh.updated_at}).`);
      if (fresh.wp_post_url) console.log(`Note: this blog is already on the website (${fresh.wp_post_url}); the live post is not changed.`);
      return;
    }
    default:
      console.log('Usage: npx tsx scripts/draft.ts list [words] | get <id> | diff <id> | put <id>');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
