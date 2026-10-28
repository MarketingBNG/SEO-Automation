// Every activity log action written in the code belongs to an area the Activity Log filter can select.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { AREAS, areaOf } from '../lib/activityAreas';

const root = path.join(import.meta.dirname, '..');
function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'generated' || f.startsWith('.')) continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(f)) yield p;
  }
}

test('every logged action prefix maps to an area', () => {
  const prefixes = new Set<string>();
  for (const dir of ['lib', 'app', 'scripts']) {
    for (const f of files(path.join(root, dir))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:activity\.log\(\s*|action: )['`]([a-z_]+)\.[a-z_$]/g)) prefixes.add(m[1]);
    }
  }
  assert.ok(prefixes.size > 10);
  const missing = [...prefixes].filter((p) => !AREAS[p]);
  assert.deepEqual(missing, []);
  assert.equal(areaOf('ai_queue.mode'), 'AI credits');
});
