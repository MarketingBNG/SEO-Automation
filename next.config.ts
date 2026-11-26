import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The build's type check leaves out tests/ (tsconfig.build.json): they never ship, `npm run
  // typecheck` still checks them, and with them the check ran out of the default memory.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  // Shown at the bottom of the sidebar, so anyone can tell which version is live.
  env: { NEXT_PUBLIC_BUILD_TIME: new Date().toISOString() },
  // Node-only libraries: load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ['sharp', 'html-to-docx', 'mammoth', 'googleapis', 'xlsx', 'unpdf'],
  // lib/playbook.ts reads the playbook from disk at runtime; ship it with every server function.
  // The logo, favicons and assistant pictures in public/ (the login page shows them to anyone):
  // a day in browsers and at Cloudflare instead of max-age=0, which sent every view to the server.
  // Only top-level files and public/assistant: /api/uploads/... stays private (it has more segments).
  async headers() {
    const cache = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    return [
      { source: '/:file([^/]+\\.(?:png|ico|webp|svg))', headers: cache },
      { source: '/assistant/:file([^/]+\\.webp)', headers: cache },
    ];
  },
  outputFileTracingIncludes: {
    '/api/**/*': ['./skills/**/*', './assets/**/*'],
  },
};

export default nextConfig;
