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
  // Il n'y a plus de clé `eslint:` ici : Next 16 a supprimé l'option en même
  // temps que la commande `next lint`, et `next build` ne lint plus du tout.
  // Le garde-fou est passé dans le script `test:phase:full`, qui enchaîne
  // désormais lint + tests + build.
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
  // Pas de bloc `webpack()` : il déclarait un loader `asset/source` pour les
  // .wgsl, or le dépôt n'a jamais contenu un seul fichier .wgsl (les shaders
  // passent par TSL, en TypeScript). Règle morte, supprimée — et de toute façon
  // un webpack custom fait échouer un build Turbopack.
  //
  // `npm run build` passe malgré tout `--webpack`, et c'est mesuré, pas
  // décoratif : le traçage de fichiers de Turbopack n'arrive pas à borner les
  // chemins fs construits à l'exécution (`join(CACHE_DIR, size, …)` dans
  // /api/poster, `join(BACKUP, mediaDir)` dans process-film, les liens de
  // location dans symlinks.ts) et ratisse tout le dossier du projet. Il le dit
  // lui-même au build : « The file pattern … matches 20463 files — overly broad
  // patterns can lead to over bundling ».
  //
  //   Turbopack : .next/standalone = 1,6 Go, instrumentation.js trace 5230
  //               fichiers dont 4753 parasites — radarr-vo-config et
  //               radarr-vf-config (1,3 Go à eux deux), zone.db, et .env.
  //   webpack   : .next/standalone = 92 Mo, 56 fichiers tracés, 0 parasite.
  //
  // `outputFileTracingExcludes` ne rattrape rien : Turbopack l'ignore (testé, y
  // compris sur la clé `/instrumentation`, le traçage fautif). Sous webpack il
  // est inutile, la trace est déjà propre — d'où son absence ici.
  //
  // `next dev` reste sur Turbopack : il ne produit pas de sortie standalone,
  // donc le problème ne s'y pose pas, et on garde le dev rapide.
};

export default nextConfig;
