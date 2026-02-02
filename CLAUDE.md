# CLAUDE.md - Zone Club Frontend 3D

## Projet

Frontend 3D immersif pour Zone Club, un vidéoclub en ligne. Expérience FPS dans un vidéoclub rétro des années 90.

## Stack Technique

- **Framework** : React 18 + TypeScript
- **3D** : Three.js via React Three Fiber (@react-three/fiber)
- **État** : Zustand avec persistance localStorage
- **Build** : Vite
- **Styles** : CSS Modules

## Commandes

```bash
# Développement
npm run dev

# Build production
npm run build

# Preview du build
npm run preview

# Docker
docker compose up -d
docker compose build --no-cache frontend
```

## Architecture du Code

### Composants 3D (`src/components/interior/`)

| Fichier | Description |
|---------|-------------|
| `Aisle.tsx` | Scène principale du magasin (murs, sol, éclairage) |
| `WallShelf.tsx` | Étagères murales avec cassettes |
| `IslandShelf.tsx` | Îlot central double face (NOUVEAUTÉS) |
| `Cassette.tsx` | Cassette VHS interactive avec hover smooth |
| `Manager3D.tsx` | Gérant 3D (Quentin) avec animations |
| `Controls.tsx` | Contrôles FPS + raycasting + collisions |
| `InteractiveTVDisplay.tsx` | Écran TV ouvrant le terminal |
| `GenreSectionPanel.tsx` | Panneaux de genre suspendus |

### Terminal TV (`src/components/terminal/`)

| Fichier | Description |
|---------|-------------|
| `TVTerminal.tsx` | Interface terminal rétro (compte, locations, admin) |
| `TVTerminal.module.css` | Styles scanlines, effet CRT |

### Player Vidéo (`src/components/player/`)

| Fichier | Description |
|---------|-------------|
| `VHSPlayer.tsx` | Player vidéo avec switch VF/VO/sous-titres |
| `VHSControls.tsx` | Contrôles style magnétoscope |

### Services (`src/services/`)

| Fichier | Description |
|---------|-------------|
| `tmdb.ts` | Client API TMDB (films, recherche, top rated) |

### API (`src/api/`)

| Fichier | Description |
|---------|-------------|
| `index.ts` | Client API backend (auth, rentals, reviews, admin) |

### Store (`src/store/`)

| Fichier | Description |
|---------|-------------|
| `index.ts` | Zustand store (auth, rentals, UI state, player) |

## Conventions

### TypeScript
- Strict mode activé
- Types explicites pour les props de composants
- Interfaces pour les données API

### React Three Fiber
- `useFrame` pour les animations par frame
- `useRef` pour accéder aux objets Three.js
- `useMemo` pour les géométries/textures (éviter recréation)

### Cassettes - Hystérésis de Sélection
```typescript
// Problème résolu : flickering aux bords des cassettes
// Solution : double hystérésis (Controls + Cassette)

// Dans Controls.tsx :
const DESELECT_DELAY = 0.4 // 400ms avant désélection
const MIN_HITS_TO_CHANGE = 3 // Hits consécutifs pour changer

// Dans Cassette.tsx :
const HYSTERESIS_SELECT = 0.05 // 50ms pour sélectionner
const HYSTERESIS_DESELECT = 0.25 // 250ms pour désélectionner
```

### Collisions
```typescript
// Zones de collision définies dans Controls.tsx
// Format : { minX, maxX, minZ, maxZ, name }
const COLLISION_ZONES = [
  { minX: -0.8 - 0.756, maxX: -0.8 + 0.756, minZ: -1.134, maxZ: 1.134, name: 'ilot' },
  // ...
]
```

## Points d'Attention

### Performance
- Les textures sont chargées une fois via `useMemo`
- Les cassettes utilisent `lerp` pour les animations smooth
- Le raycasting est limité au centre de l'écran (crosshair)

### API Backend
- URL configurée via `VITE_API_URL`
- Cookies httpOnly pour l'auth (credentials: 'include')
- Les IDs films dans les URLs sont des `tmdb_id`, pas des `id` internes

### TMDB
- Clé API via `VITE_TMDB_API_KEY`
- Posters : `https://image.tmdb.org/t/p/w200{poster_path}`
- Fallback couleur si pas de poster

### Terminal Admin
- Accès : taper "admin" au clavier quand le terminal est ouvert
- Réservé aux utilisateurs avec `is_admin: true`

## Leçons Apprises (02/02/2026)

### Hystérésis pour éviter le flickering
**Problème** : Aux bords des cassettes, le raycast alternait rapidement entre hit/miss, causant un flickering visuel désagréable (2-20 Hz).

**Solution** : Double hystérésis
1. **Côté Controls** : Délai de 400ms avant désélection + compteur de hits consécutifs
2. **Côté Cassette** : État stable interne avec délais asymétriques (50ms select, 250ms deselect)

### Îlot Central - Direction du Hover
**Problème** : Les cassettes de l'îlot sont rotées de 90°, donc l'animation Z les poussait dans le mauvais sens.

**Solution** : Prop `hoverOffsetZ` configurable (-0.08 pour l'îlot au lieu de +0.08).

### Films NOUVEAUTÉS
- Chargés depuis TMDB API (top rated des 10 dernières années)
- Fallback sur le catalogue local si l'API échoue
- 30 films affichés (15 par côté de l'îlot)

## Docker

### Architecture
```
Traefik (externe)
├── ${FRONTEND_SUBDOMAIN}.${DOMAIN} → nginx (frontend)
├── ${SUBDOMAIN}.${DOMAIN}          → SvelteKit API
└── ${STORAGE_SUBDOMAIN}.${DOMAIN}  → lighttpd (vidéos)
```

### Build
```dockerfile
# Multi-stage : Node (build) → nginx (serve)
FROM node:20-alpine AS builder
# ... build avec VITE_API_URL et VITE_TMDB_API_KEY

FROM nginx:alpine
# ... copie dist + nginx.conf
```

### Variables d'environnement Docker
| Variable | Usage |
|----------|-------|
| `VITE_API_URL` | URL du backend SvelteKit |
| `VITE_TMDB_API_KEY` | Clé API TMDB |
| `FRONTEND_SUBDOMAIN` | Sous-domaine Traefik |
