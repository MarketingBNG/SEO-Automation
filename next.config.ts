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
  outputFileTracingIncludes: {
    '/api/**/*': ['./skills/**/*', './assets/**/*'],
  },
  // Security headers on every response: no framing (clickjacking on approve/publish buttons), no MIME
  // sniffing of uploaded files, HTTPS only, and a strict referrer. A full script CSP is left out on
  // purpose (Next's inline scripts and Google sign-in would need nonces); lesson and blog HTML is
  // sanitized before it is rendered.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
