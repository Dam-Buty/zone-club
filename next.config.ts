import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3', 'bcrypt'],
  outputFileTracingIncludes: {
    '/**': ['./lib/schema.sql'],
  },
  eslint: {
    // Pre-existing lint issues from Vite migration — fix incrementally
    ignoreDuringBuilds: true,
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
