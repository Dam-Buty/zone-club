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

**IMPORTANT** : Le container app monte le dossier du projet et sert le build standalone. Builder depuis la machine hote (bien plus rapide que dans le container), puis redemarrer le container qui pickup le nouveau build :
```bash
npm run build && docker compose restart app
```
Si `.next/` a des fichiers root (crees par le container), supprimer d'abord : `sudo rm -rf .next`

## Architecture

```
app/
├── page.tsx                 # Dynamic import de src/App (ssr: false)
├── layout.tsx               # Root layout
├── api/                     # API routes (Next.js App Router)
│   ├── auth/                # login, logout, register, recover
│   ├── films/               # list, [tmdbId], genre/[slug]
│   │   └── aisle/[aisle]/   # GET films par allee
│   ├── rentals/[filmId]/    # GET|POST|DELETE
│   ├── reviews/[filmId]/    # GET|POST|DELETE
│   ├── requests/            # GET|POST|DELETE
│   ├── genres/              # GET
│   ├── me/                  # GET (current user)
│   └── admin/
│       ├── films/           # POST (ajouter film), GET (liste admin)
│       │   └── [filmId]/
│       │       ├── aisle/       # PATCH (assigner allee)
│       │       ├── availability/# PATCH (toggle dispo)
│       │       └── download/    # POST (lancer Radarr VO+VF)
│       ├── requests/        # GET|PATCH (gestion demandes)
│       └── stats/           # GET
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
scripts/
└── seed-films.ts            # Seed DB depuis src/data/mock/films.json
```

## API Backend

- Same-origin (pas de CORS, `API_BASE = ''`)
- Auth par cookies signes httpOnly (`credentials: 'include'`)
- Les IDs films dans les URLs sont des `tmdb_id`, pas des `id` internes
- Dual Radarr : `radarr_vo_id` + `radarr_vf_id` pour films VO/VF

### Routes admin (auth admin requise)

| Methode | Route | Description |
|---|---|---|
| `POST` | `/api/admin/films` | Ajouter un film (body: `{ tmdb_id }`) |
| `POST` | `/api/admin/films/[filmId]/download` | Lancer telechargement Radarr VO+VF |
| `PATCH` | `/api/admin/films/[filmId]/aisle` | Assigner allee / nouveaute (body: `{ aisle?, is_nouveaute? }`) |
| `PATCH` | `/api/admin/films/[filmId]/availability` | Toggle disponibilite |
| `GET` | `/api/admin/stats` | Stats (users, films, rentals, requests) |

### Routes films

| Methode | Route | Description |
|---|---|---|
| `GET` | `/api/films/aisle/[aisle]` | Films par allee (action, horreur, sf, comedie, classiques, bizarre, nouveautes) |

## Catalogue de films

### Schema DB (table `films`)

Colonnes cles pour le catalogue :
- `aisle TEXT` — allee dans le videoclub (action, horreur, sf, comedie, classiques, bizarre)
- `is_nouveaute BOOLEAN` — badge "nouveau" (un film peut etre dans une allee ET nouveaute)
- `radarr_vo_id INTEGER` — ID dans Radarr VO (null = pas encore telecharge)
- `radarr_vf_id INTEGER` — ID dans Radarr VF (null = pas encore telecharge)
- `is_available BOOLEAN` — visible pour les utilisateurs
- `file_path_vo TEXT` / `file_path_vf TEXT` — chemins fichiers (remplis par radarr-poller)

### Flow complet : ajouter un film

```
1. SEED (bulk)           npm run seed
   └─ Lit src/data/mock/films.json (structure: { aisle: [tmdb_id, ...] })
   └─ Fetch metadata TMDB pour chaque film
   └─ Insert en DB avec aisle + is_nouveaute
   └─ Ne lance PAS les telechargements Radarr

2. AJOUT UNITAIRE        POST /api/admin/films { tmdb_id }
   └─ Fetch metadata TMDB (titre, synopsis, poster, acteurs, genres...)
   └─ Insert en DB (aisle=null, is_available=false)

3. ASSIGNER ALLEE        PATCH /api/admin/films/{id}/aisle { aisle, is_nouveaute }
   └─ Place le film dans une allee du videoclub 3D
   └─ Optionnel: marquer comme nouveaute

4. LANCER TELECHARGEMENT POST /api/admin/films/{id}/download
   └─ Appelle addMovie() sur Radarr VO (version originale)
   └─ Appelle addMovie() sur Radarr VF (version francaise)
   └─ Stocke radarr_vo_id + radarr_vf_id en DB
   └─ Radarr surveille et telecharge automatiquement

5. RADARR POLLER         (automatique, instrumentation.ts)
   └─ Sync periodique des fichiers depuis Radarr
   └─ Met a jour file_path_vo / file_path_vf en DB

6. ACTIVER               PATCH /api/admin/films/{id}/availability
   └─ Toggle is_available = true
   └─ Le film apparait dans le videoclub 3D
```

### Allees valides

`action` | `horreur` | `sf` | `comedie` | `classiques` | `bizarre` | `nouveautes` (virtual)

`nouveautes` n'est pas une allee physique — c'est un filtre sur `is_nouveaute = 1`. Un film peut etre dans `action` ET `nouveautes`.

### Script seed (`npm run seed`)

Lit `src/data/mock/films.json` :
```json
{
  "action": [550, 603, ...],
  "nouveautes": [550, 999, ...],
  ...
}
```
- Premier allee gagne si un film apparait dans plusieurs sections
- `nouveautes` set `is_nouveaute=true` (additif, pas une allee)
- Delai 250ms entre chaque appel TMDB (rate limit)
- Films existants : met a jour aisle/nouveaute seulement

### Admin Terminal (TVTerminal.tsx)

Panel admin cache accessible via code "admin" tape au clavier quand le terminal est ouvert.

Fonctionnalites :
- **Ajouter un film** : saisir TMDB ID → fetch metadata → insert DB
- **Gestion films** : liste avec controles par film :
  - Dropdown allee (--/action/horreur/sf/comedie/classiques/bizarre)
  - Toggle NEW (is_nouveaute)
  - Bouton DL (lance telechargement Radarr VO+VF, disparait une fois lance)
  - Toggle DISPO (is_available)
- **Demandes** : gestion des film_requests (approve/reject)
- **Stats** : users, films dispo/total, locations actives, demandes en attente

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
| `API_SECRET` | Clef API pour tests automatises (header `x-api-key`) |
| `DATABASE_PATH` | Chemin SQLite (`/data/zone.db`) |
| `DOMAIN` | Domaine de base |
| `SUBDOMAIN` | Sous-domaine app |
| `STORAGE_SUBDOMAIN` | Sous-domaine storage |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (observabilite LLM) |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key |
| `LANGFUSE_BASEURL` | Langfuse base URL (`https://cloud.langfuse.com`) |

## API Testing

Auth alternative par clef API pour tests CLI / automatises (pas besoin de cookies) :
```bash
curl -s "https://club.lazone.at/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_SECRET" \
  -H "x-user-id: 1" \
  -d '{"messages":[{"id":"m1","role":"user","content":"Salut","parts":[{"type":"text","text":"Salut"}]}],"events":[]}'
```

**Format messages** : Le Vercel AI SDK attend des UIMessages avec `id`, `role`, `content` et `parts` (array de `{type:"text", text:"..."}`)

**Routes supportees** : `/api/chat` (POST), `/api/chat/close` (POST)

## Langfuse (observabilite LLM)

Tracing OpenTelemetry via `@langfuse/otel` dans `instrumentation.ts`.

- Chaque appel `streamText` / `generateText` a `experimental_telemetry: { isEnabled: true }` avec `userId` et `sessionId` dans les metadata
- Les traces Langfuse incluent : modele, tokens, latence, system prompt, messages, tool calls
- Dashboard : https://cloud.langfuse.com
- API : `curl -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" https://cloud.langfuse.com/api/public/traces`

## Build Notes

- `eslint: { ignoreDuringBuilds: true }` — lint issues pre-existants de l'ere Vite
- `serverExternalPackages: ['better-sqlite3', 'bcrypt']` — modules natifs
- Three.js WebGPU types : augmentation `ArrayBufferView<any>` sur `GPUQueue.writeBuffer`
- `src/types/three-webgpu.d.ts` — declarations custom pour three/webgpu, three/tsl, addons

## Skills

- **threejs-webgpu-architect** : Architecture Three.js/R3F, performance, photorealisme, assets
- **webgpu-pure** : WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- **webgpu-canvas-text** : Texte dans scenes WebGPU via CanvasTexture (Troika incompatible WebGPU)
