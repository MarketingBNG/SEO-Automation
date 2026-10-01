/**
 * One-off: copy everything from the old SQLite database (data/app.db) into Neon Postgres,
 * upload the old uploads/ folder to Vercel Blob, and move the Zoho / GBP OAuth token files into
 * the oauth_tokens table.
 *
 *   OLD_APP_DIR=../seo-blog-automation npm run migrate:sqlite
 *
 * Needs DATABASE_URL and BLOB_READ_WRITE_TOKEN in .env, and `npx prisma migrate deploy` run first.
 * Ids are preserved (so drafts->keywords, facts->drafts etc. stay linked) and the id sequences are
 * advanced afterwards. Refuses to run if the target tables already contain data.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import prisma from '../lib/prisma';
import { saveFile, toKey } from '../lib/storage';

const OLD_APP_DIR = path.resolve(process.env.OLD_APP_DIR || '../seo-blog-automation');
const DB_PATH = path.join(OLD_APP_DIR, 'data', 'app.db');

// Parent tables first so foreign keys are satisfied.
const TABLES = [
  'keywords', 'drafts', 'facts', 'settings', 'training_examples', 'activity_log', 'research_digests',
  'client_insights', 'blog_audits', 'image_library', 'draft_images', 'seo_strategies', 'writing_skills',
  'technical_crawls', 'assistant_conversations', 'site_changes', 'paa_questions',
] as const;

// Columns that held absolute local file paths and now hold storage keys.
const PATH_COLUMNS: Record<string, string[]> = {
  drafts: ['featured_image_path'],
  image_library: ['path', 'model_path'],
};

function plain(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row));
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`SQLite database not found at ${DB_PATH}`);
  const sqlite = new DatabaseSync(DB_PATH, { readOnly: true });

  for (const table of TABLES) {
    const count = await (prisma as any)[table].count();
    if (count > 0) throw new Error(`Target table "${table}" already has ${count} rows - aborting so nothing is duplicated.`);
  }

  // 1. Files: uploads/** -> Blob under the same relative key.
  const uploadsDir = path.join(OLD_APP_DIR, 'uploads');
  let files = 0;
  if (fs.existsSync(uploadsDir)) {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
      );
    for (const file of walk(uploadsDir)) {
      const key = path.relative(uploadsDir, file).split(path.sep).join('/');
      await saveFile(key, fs.readFileSync(file));
      files++;
    }
  }
  console.log(`Uploaded ${files} file(s) to Blob`);

  // 2. Rows.
  for (const table of TABLES) {
    const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!exists) {
      console.log(`${table}: not in old database, skipped`);
      continue;
    }
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all().map((r) => plain(r as Record<string, unknown>));
    for (const col of PATH_COLUMNS[table] || []) {
      for (const r of rows) if (r[col] != null) r[col] = toKey(String(r[col])) ?? r[col];
    }
    for (let i = 0; i < rows.length; i += 500) {
      await (prisma as any)[table].createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`${table}: ${rows.length} row(s)`);
  }

  // 3. Advance id sequences past the copied ids.
  for (const table of TABLES) {
    if (table === 'settings') continue;
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
    );
  }

  // 4. OAuth tokens that used to live in secrets/*.json.
  for (const provider of ['zoho', 'gbp']) {
    const file = path.join(OLD_APP_DIR, 'secrets', `${provider}-tokens.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2);
    await prisma.oauth_tokens.upsert({ where: { provider }, create: { provider, data }, update: { data } });
    console.log(`oauth_tokens: imported ${provider}`);
  }

  // 5. Verify row counts match.
  let ok = true;
  for (const table of TABLES) {
    const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!exists) continue;
    const src = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    const dst = await (prisma as any)[table].count();
    if (src !== dst) {
      ok = false;
      console.error(`MISMATCH ${table}: sqlite=${src} neon=${dst}`);
    }
  }
  console.log(ok ? 'Done - all row counts match.' : 'Done WITH MISMATCHES (see above).');
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
