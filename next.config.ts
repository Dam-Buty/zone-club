import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  // better-sqlite3 et bcrypt : modules natifs, impossibles à bundler.
  // fluent-ffmpeg : sa fonctionnalité `preset()` fait un `require(modulePath)`
  // calculé, que webpack ne sait pas analyser — d'où un « Critical dependency:
  // the request of a dependency is an expression » à chaque build. On n'utilise
  // aucun preset (le dépôt appelle ffmpeg en direct), et le paquet ne sert que
  // côté serveur dans lib/media/ : l'externaliser retire le warning et évite de
  // bundler un wrapper qui ne fait que piloter des binaires.
  serverExternalPackages: ['better-sqlite3', 'bcrypt', 'fluent-ffmpeg'],
  outputFileTracingIncludes: {
    '/**': ['./lib/schema.sql'],
  },
  eslint: {
    // CI gate — `next build` will fail on ESLint errors. Warnings are
    // surfaced but do not block. The current config (eslint.config.js) has
    // bug-class rules at `error`, stylistic ones at `warn`.
    ignoreDuringBuilds: false,
  },
  // Security + cache headers
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    return [
      // Security headers on all routes
      { source: '/(.*)', headers: securityHeaders },
      // Long-term cache for immutable 3D assets
      {
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/textures/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/basis/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.wgsl$/,
      type: 'asset/source',
    });
    return config;
  },
};

export default nextConfig;
