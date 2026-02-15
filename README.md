# Zone Club

Videoclub 3D immersif en vue FPS (ambiance retro 90s), avec location de VHS et lecture video dans le navigateur.

## Stack technique

- Next.js 15 (App Router) + React 19
- Three.js + React Three Fiber
- Rendu mixte:
  - Exterieur: WebGL (`THREE.WebGLRenderer`)
  - Interieur: WebGPU (`THREE.WebGPURenderer`)
- Zustand (state), SQLite (`better-sqlite3`), auth cookie signee
- Docker Compose (app + storage + Radarr VO/VF + Bazarr)

## Documentation

- Rendu 3D, WebGPU, optimisations et benchmark: `docs/3d-rendering-webgpu.md`
- Notes projet: `CLAUDE.md`

## Prerequis

- Node.js 20+ recommande
- npm
- Navigateur recent avec acceleration materielle active
- WebGPU requis pour la scene interieure

## Demarrage local

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

App locale: `http://localhost:3000`

## Scripts utiles

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run seed
npm run test:phase
npm run test:phase:full
npm run audit:unused
npm run audit:unused:strict
```

## Fonctionnement rendu 3D

- Scene exterieure:
  - `src/components/exterior/ExteriorView.tsx`
  - `src/components/exterior/scene/ExteriorScene.ts`
- Scene interieure (WebGPU):
  - `src/components/interior/InteriorScene.tsx`
  - `src/components/interior/Aisle.tsx`
  - `src/components/interior/CassetteInstances.tsx`
  - `src/components/interior/PostProcessingEffects.tsx`

Optimisations principales deja implementees:

- Instancing massif des cassettes + `DataArrayTexture`
- Chunking automatique selon `maxTextureArrayLayers`
- Upload GPU par couche (`copyExternalImageToTexture`) quand possible
- Textures KTX2 avec fallback JPEG
- Post-processing adapte desktop/mobile
- Raycast cible/throttle (pas de scan recursif complet a chaque frame)

Details complets: `docs/3d-rendering-webgpu.md`.

## Benchmark mode WebGPU

Activation:

1. Ouvrir le terminal utilisateur in-game
2. Compte > `Benchmark WebGPU` > `ACTIF`

Alternative:

- Ajouter `?benchmark=1` a l'URL

Affichage:

- Overlay temps reel (FPS, frametime, draw calls, triangles, chunks/instances)
- Export JSON depuis le panneau benchmark

## Controles

Desktop:

- Deplacement: fleches `↑ ↓ ← →` (et aussi `W/A/S/D`)
- Regarder: souris
- Interaction: clic gauche ou `E`
- Liberer le pointeur: `Esc`

Mobile:

- Deplacement: joystick virtuel
- Camera: glisser sur l'ecran
- Interaction: bouton/tap contextualise

## Variables d'environnement

Voir `.env.example` pour la liste complete.

Variables principales:

- `DOMAIN`, `SUBDOMAIN`, `STORAGE_SUBDOMAIN`
- `RADARR_VO_API_KEY`, `RADARR_VF_API_KEY`
- `TMDB_API_KEY`, `NEXT_PUBLIC_TMDB_API_KEY`
- `HMAC_SECRET`
- `SABNZBD_DOWNLOADS`

## Docker / Production

Build app:

```bash
npm run build
```

Lancement stack:

```bash
docker compose up -d
```

Services:

- `app` (Next.js)
- `storage` (lighttpd media)
- `radarr-vo`
- `radarr-vf`
- `bazarr`

## Workflow de refactor safe

Avant/apres chaque refactor:

```bash
npm run test:phase
npm run build
```

`test:phase` couvre:

- imports casses
- references assets manquantes
- coherence domaine (types/store)
- budget de taille fichiers (regle <= 1000 lignes avec exceptions explicites)

## Notes

- `npm run build` ignore volontairement le lint (config Next actuelle), pour debloquer les migrations progressives.
- Si WebGPU n'est pas disponible, l'application affiche un ecran explicatif et n'ouvre pas la scene interieure.
