import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'bcrypt'],
  outputFileTracingIncludes: {
    '/**': ['./lib/schema.sql'],
  },
  eslint: {
    // Pre-existing lint issues from Vite migration — fix incrementally
    ignoreDuringBuilds: true,
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
