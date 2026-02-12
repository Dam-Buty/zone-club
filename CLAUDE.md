# CLAUDE.md - Zone Club

## Projet

Frontend 3D immersif pour Zone Club, un videoclub en ligne. Experience FPS dans un videoclub retro des annees 90. Monolithe Next.js (API + frontend).

## Stack

- **Framework** : Next.js 15 App Router + React 19
- **3D** : Three.js 0.182 via React Three Fiber (WebGPU renderer)
- **Etat** : Zustand 5 avec persistance localStorage
- **Styles** : Tailwind CSS v4
- **DB** : SQLite via `better-sqlite3` (server-side only)
- **Auth** : Cookies signes avec `cookie-signature` (pas de JWT)
- **Build** : `next build` avec `output: 'standalone'`

## Commandes

```bash
npm run dev          # Dev server (port 3000)
npm run build        # Build production standalone
npm run start        # Start production server
npm run seed         # Seed films database
docker compose up -d # Production (5 services)
```

## Architecture

```
app/
├── page.tsx                 # Dynamic import de src/App (ssr: false)
├── layout.tsx               # Root layout
├── api/                     # 20 API routes (Next.js App Router)
│   ├── auth/                # login, logout, register, recover
│   ├── films/               # list, [tmdbId], aisle/[aisle], genre/[slug]
│   ├── rentals/[filmId]/    # GET|POST|DELETE
│   ├── reviews/[filmId]/    # GET|POST|DELETE
│   ├── requests/            # GET|POST|DELETE
│   ├── genres/              # GET
│   ├── me/                  # GET (current user)
│   └── admin/               # films, download, aisle, availability, requests, stats
lib/
├── db.ts                    # SQLite (better-sqlite3)
├── auth.ts                  # Auth helpers
├── session.ts               # Cookie session management
├── films.ts                 # Film catalog CRUD
├── rentals.ts               # Rental logic
├── reviews.ts               # Reviews CRUD
├── requests.ts              # Film requests
├── radarr.ts                # Radarr API client (dual VO/VF)
├── radarr-poller.ts         # Background Radarr sync
├── tmdb.ts                  # TMDB API client
├── cleanup.ts               # Cleanup scheduler
├── symlinks.ts              # Media symlink management
├── passphrase.ts            # Password hashing
└── schema.sql               # DB schema
src/
├── App.tsx                  # Main React app (Canvas + UI)
├── api/index.ts             # Frontend API client
├── store/index.ts           # Zustand store
├── components/
│   ├── interior/            # 3D scene (Aisle, Cassette, Controls, Lighting, etc.)
│   ├── exterior/            # Building exterior + idle video
│   ├── terminal/            # TVTerminal (retro CRT interface)
│   ├── player/              # VHSPlayer (video player)
│   ├── ui/                  # Modals (film detail, search, auth, review)
│   ├── mobile/              # Touch controls + joystick
│   └── manager/             # NPC manager avatar + chat
├── services/tmdb.ts         # TMDB client (frontend)
└── types/three-webgpu.d.ts  # Custom WebGPU type declarations
instrumentation.ts           # Startup code (cleanup scheduler, Radarr poller)
```

## API Backend

- Same-origin (pas de CORS, `API_BASE = ''`)
- Auth par cookies signes httpOnly (`credentials: 'include'`)
- Les IDs films dans les URLs sont des `tmdb_id`, pas des `id` internes
- Dual Radarr : `radarr_vo_id` + `radarr_vf_id` pour films VO/VF

## Frontend 3D

### Composants cles
- **Controls.tsx** : FPS controls + raycasting + collisions (ZQSD/WASD)
- **Cassette.tsx / CassetteInstances.tsx** : VHS interactives (InstancedMesh + DataArrayTexture)
- **TVTerminal.tsx** : Interface CRT retro (compte, locations, admin)
- **VHSPlayer.tsx** : Player video avec switch VF/VO/sous-titres

### Hysteresis de selection
Double hysteresis pour eviter le flickering aux bords des cassettes :
- **Controls** : 400ms delay avant deselection + compteur hits consecutifs
- **Cassette** : 50ms select / 250ms deselect (asymetrique)

### Collisions
Zones definies dans Controls.tsx : `{ minX, maxX, minZ, maxZ, name }`.

## Performance

| Optimisation | Detail |
|---|---|
| Lumieres | 8 au lieu de 21 (-62%) via mode optimise |
| Raycast | Throttle tous les 2 frames (30/sec) |
| Cassettes | 1 InstancedMesh + geometrie partagee pour ~520 cassettes |
| Shadows | `castShadow={false}` sur cassettes (-520 shadow renders) |
| Textures | TMDB w200 + DataArrayTexture + anisotropic filtering |
| Materials | Module-level shared materials (pas inline dans les loops) |
| useFrame | Registry Map + single useFrame au lieu de 500+ callbacks |
| Zustand | Selectors individuels dans Canvas (jamais full-store) |

## Conventions

### TypeScript
- Strict mode active
- Types explicites pour les props
- `extend(THREE as any)` pour R3F WebGPU compatibility
- `baseUrl: "."` requis avec `paths` dans tsconfig

### R3F
- `useFrame` pour animations par frame
- `useRef` pour acces aux objets Three.js
- `useMemo` pour geometries/textures (eviter recreation)
- `React.memo` sur tous les composants Canvas

## Docker (5 services, 0 builds)

| Service | Image | Role |
|---|---|---|
| `app` | `node:22-slim` | Next.js standalone (`server.js`) |
| `storage` | `sebp/lighttpd` | Streaming video (films VO/VF) |
| `radarr-vo` | `linuxserver/radarr` | Gestion films VO |
| `radarr-vf` | `linuxserver/radarr` | Gestion films VF |
| `bazarr` | `linuxserver/bazarr` | Sous-titres |

Pas de Docker build — l'app monte `.next/standalone` directement dans le container.

## Variables d'environnement

| Variable | Usage |
|---|---|
| `NEXT_PUBLIC_TMDB_API_KEY` | Cle TMDB (client-side) |
| `TMDB_API_KEY` | Cle TMDB (server-side) |
| `RADARR_VO_API_KEY` | API key Radarr VO |
| `RADARR_VF_API_KEY` | API key Radarr VF |
| `HMAC_SECRET` | Signature cookies |
| `DATABASE_PATH` | Chemin SQLite (`/data/zone.db`) |
| `DOMAIN` | Domaine de base |
| `SUBDOMAIN` | Sous-domaine app |
| `STORAGE_SUBDOMAIN` | Sous-domaine storage |

## Build Notes

- `eslint: { ignoreDuringBuilds: true }` — lint issues pre-existants de l'ere Vite
- `serverExternalPackages: ['better-sqlite3', 'bcrypt']` — modules natifs
- Three.js WebGPU types : augmentation `ArrayBufferView<any>` sur `GPUQueue.writeBuffer`
- `src/types/three-webgpu.d.ts` — declarations custom pour three/webgpu, three/tsl, addons

## Skills

- **threejs-webgpu-architect** : Architecture Three.js/R3F, performance, photorealisme, assets
- **webgpu-pure** : WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- **webgpu-canvas-text** : Texte dans scenes WebGPU via CanvasTexture (Troika incompatible WebGPU)
