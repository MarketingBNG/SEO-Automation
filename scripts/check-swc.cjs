// Run by `npm run build` before `prisma migrate deploy`: `next build` (Turbopack) needs Next's
// native SWC binding, and without it the build fails only after the database was already migrated.
// The binding is an optional dependency (@next/swc-<platform>), skipped by `npm ci --omit=optional`
// or missing after a lockfile made on another platform. Loads it only; never downloads anything.
const path = require('node:path');
const { getSupportedArchTriples } = require('next/dist/build/swc');

const triples = getSupportedArchTriples()[process.platform]?.[process.arch] || [];
const tried = [];
for (const t of triples) {
  const pkg = `@next/swc-${t.platformArchABI}`;
  // The installed package, or the copy Next itself downloaded on an earlier build (next-swc-fallback).
  const fallback = path.join(path.dirname(require.resolve('next/package.json')), 'next-swc-fallback', pkg, `next-swc.${t.platformArchABI}.node`);
  for (const target of [pkg, fallback]) {
    try {
      require(target);
      process.exit(0);
    } catch (e) {
      tried.push(`${target}: ${String(e.message || e).split('\n')[0]}`);
    }
  }
}
console.error(
  `Next's native SWC binding for ${process.platform}/${process.arch} could not be loaded, so next build would fail.\n` +
    `${tried.join('\n') || 'No binding is published for this platform.'}\n` +
    'Install dependencies with optional packages (npm ci, without --omit=optional), then build again. The database was not migrated.'
);
process.exit(1);
