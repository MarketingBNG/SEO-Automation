import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Shown at the bottom of the sidebar, so anyone can tell which version is live.
  env: { NEXT_PUBLIC_BUILD_TIME: new Date().toISOString() },
  // Node-only libraries: load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ['sharp', 'html-to-docx', 'mammoth', 'googleapis', 'xlsx', 'unpdf'],
  // lib/playbook.ts reads the playbook from disk at runtime; ship it with every server function.
  outputFileTracingIncludes: {
    '/api/**/*': ['./skills/**/*', './wordpress/**/*', './assets/**/*'],
  },
};

export default nextConfig;
