// Run by `npm run build` before `prisma migrate deploy`: `next build` (Turbopack) needs Next's
// native SWC binding, and without it the build fails only after the database was already migrated.
// The binding is an optional dependency (@next/swc-<platform>), skipped by `npm ci --omit=optional`
// or missing after a lockfile made on another platform. When it is simply not installed, Next
// downloads it into node_modules/next/next-swc-fallback during the build; this check does the same
// (with Next's own downloader), so it fails only when next build would.
const path = require('node:path');
const { getSupportedArchTriples } = require('next/dist/build/swc');

const triples = getSupportedArchTriples()[process.platform]?.[process.arch] || [];
const fallbackDir = path.join(path.dirname(require.resolve('next/package.json')), 'next-swc-fallback');
const tried = [];

// The installed package (unless fallbackOnly), or the copy Next downloaded (next-swc-fallback).
// Returns true once one loads; notInstalled is false when a package is there but fails to load.
function load(fallbackOnly) {
  let notInstalled = true;
  for (const t of triples) {
    const pkg = `@next/swc-${t.platformArchABI}`;
    const fallback = path.join(fallbackDir, pkg, `next-swc.${t.platformArchABI}.node`);
    for (const target of fallbackOnly ? [fallback] : [pkg, fallback]) {
      try {
        require(target);
        return { ok: true };
      } catch (e) {
        if (target === pkg && e?.code !== 'MODULE_NOT_FOUND') notInstalled = false;
        tried.push(`${target}: ${String(e.message || e).split('\n')[0]}`);
      }
    }
  }
  return { ok: false, notInstalled };
}

function fail() {
  console.error(
    `Next's native SWC binding for ${process.platform}/${process.arch} could not be loaded, so next build would fail.\n` +
      `${tried.join('\n') || 'No binding is published for this platform.'}\n` +
      'Install dependencies with optional packages (npm ci, without --omit=optional), then build again. The database was not migrated.'
  );
  process.exit(1);
}

(async () => {
  const first = load(false);
  if (first.ok) process.exit(0);
  // Not installed at all: Next itself downloads the binding at build time (only in this case).
  if (!triples.length || !first.notInstalled) fail();
  try {
    const { downloadNativeNextSwc } = require('next/dist/lib/download-swc');
    await downloadNativeNextSwc(require('next/package.json').version, fallbackDir, triples.map((t) => t.platformArchABI));
  } catch (e) {
    tried.push(`download: ${String(e?.message || e).split('\n')[0]}`);
    fail();
  }
  if (load(true).ok) process.exit(0);
  fail();
})();
