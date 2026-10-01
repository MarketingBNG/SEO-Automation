import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node-only libraries: load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ['sharp', 'html-to-docx', 'mammoth', 'googleapis', 'xlsx'],
  // lib/playbook.ts reads the playbook from disk at runtime; ship it with every server function.
  outputFileTracingIncludes: {
    '/api/**/*': ['./skills/**/*', './wordpress/**/*'],
  },
};

export default nextConfig;
