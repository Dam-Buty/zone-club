# CLAUDE.md - Zone Club

## Projet

Frontend 3D immersif pour Zone Club, un videoclub en ligne. Experience FPS dans un videoclub retro des annees 90. Monolithe Next.js (API + frontend).

## Stack

- **Framework** : Next.js 15 App Router + React 19
- **3D** : Three.js 0.184 via React Three Fiber (WebGPU renderer)
- **Etat** : Zustand 5 avec persistance localStorage
- **Styles** : Tailwind CSS v4
- **DB** : SQLite via `better-sqlite3` (server-side only)
- **Auth** : Cookies signes avec `cookie-signature` (pas de JWT)
- **Build** : `next build` avec `output: 'standalone'`

## Regles Git — OBLIGATOIRE

1. **Avant de travailler sur une branche feature** : TOUJOURS `git rebase main` ou verifier que la branche est a jour avec main. Ne jamais commencer a coder sur une branche qui n'a pas les derniers commits de main.
2. **Quand on commit un fix sur main depuis une branche feature** (via stash) : TOUJOURS cherry-pick ou rebase le fix sur la branche feature immediatement apres. Le double stash (stash → pop sur main → commit → re-stash → pop sur feature) perd le fix car il est consomme par le commit sur main et n'est plus dans le second stash.
3. **Ne jamais laisser une branche feature diverger de main** sans raison. Si un commit est pousse sur main pendant qu'on travaille sur une feature, le ramener sur la branche feature avant de continuer.

## Commandes

```bash
npm run dev          # Dev server (port 3000)
npm run build        # Build production standalone
npm run start        # Start production server
SEED_MOCK=1 npm run seed  # Seed films DB (garde-fou : exit 1 sans SEED_MOCK=1)
npm run deploy       # Deploy complet : down app, clean .next, build, up app
docker compose up -d # Production (7 services)
```

**Deploy** : `npm run deploy` gere tout le cycle (down → clean → build → up). Le container app monte le dossier du projet et sert le build standalone — on build depuis la machine hote (bien plus rapide que dans le container).

## Architecture

```
app/
├── page.tsx                 # Dynamic import de src/App (ssr: false)
├── layout.tsx               # Root layout (VT323 font preconnect, asset preloads)
├── api/                     # 39 routes (Next.js App Router) — voir table complete plus bas
│   ├── auth/                # login, logout, register, recover (POST)
│   ├── films/               # GET endpoints: list, [tmdbId], aisle/[a], genre/[s], desk-display
│   ├── genres/              # GET liste genres
│   ├── me/                  # GET user + notifications + weekly-bonus (GET/POST)
│   ├── rentals/[filmId]/    # POST rent + sous-routes (extend, return, progress, rewind, etc.)
│   ├── reviews/[filmId]/    # GET / POST / PUT
│   ├── requests/            # GET / POST (commandes de films)
│   ├── board/               # GET/POST notes + DELETE [noteId] (sticky board)
│   ├── cast-sessions/       # POST/PATCH/DELETE — Chromecast session tracking
│   ├── chat/                # POST + chat/close (LLM manager)
│   ├── poster/[...path]/    # GET — proxy TMDB images (disk cache)
│   ├── push-subscribe/      # POST — web push subscription
│   ├── test/forced-video/   # GET — forced-rental video stream (dev only)
│   └── admin/               # 8 routes admin (is_admin gate)
│       ├── films/           # POST add + [filmId]/{aisle,availability,download} + status
│       ├── requests/        # GET liste + PATCH [id] (approve/reject)
│       └── stats/           # GET (users, films, rentals, requests)
lib/                          # Backend logic, ~23 modules
├── db.ts                    # SQLite (better-sqlite3) + migrations au boot
├── schema.sql               # DB schema
├── auth.ts                  # Auth helpers (cookie + api-key)
├── session.ts               # Cookie session management
├── rate-limit.ts            # Per-IP rate limit (login, register, recover)
├── passphrase.ts            # Password / passphrase hashing
├── films.ts                 # Film catalog CRUD
├── rentals.ts               # Rental rent/return/extend logic + symlinks
├── reviews.ts               # Reviews CRUD
├── requests.ts              # Film commandes
├── board.ts                 # Sticky board notes
├── bonus.ts                 # Weekly bonus credits
├── user-facts.ts            # Manager chat user-fact memory
├── radarr.ts                # Radarr API client (dual VO/VF)
├── radarr-poller.ts         # Background Radarr sync (instrumentation)
├── transcoder.ts            # FFmpeg transcode queue (VO/VF)
├── tmdb.ts                  # TMDB API client (server-side)
├── chat.ts + chat-tools.ts  # LLM manager backend
├── cast-sessions.ts         # Cast session DB persistence
├── cast-session-checker.ts  # Background cast session monitor
├── cleanup.ts               # Cleanup scheduler (expired rentals)
├── symlinks.ts              # Media symlink management
└── push.ts                  # Web Push notifications
src/
├── App.tsx                  # Main React app (Canvas + UI)
├── api/index.ts             # Frontend API client
├── store/index.ts           # Zustand store
├── components/
│   ├── interior/            # 3D scene (Aisle, CassetteInstances, Controls, Lighting, etc.)
│   ├── exterior/            # Building exterior + idle video
│   ├── terminal/            # TVTerminal (retro CRT interface)
│   ├── player/              # VHSPlayer (video player + Google Cast)
│   ├── tutorial/            # TutorialOverlay (guided tour, 7 steps, Rick portrait)
│   ├── videoclub/           # VHSCaseOverlay (K7 detail panel + tutorial annotations)
│   ├── manager/             # NPC manager avatar + chat (GenUI forms)
│   ├── minitel/             # MinitelOverlay + shared.ts (AISLES_ORDER)
│   ├── search/              # SearchModal
│   ├── auth/                # AuthModal
│   ├── review/              # ReviewModal
│   ├── board/               # BoardOverlay (sticky board UI)
│   ├── ui/                  # WeeklyBonusToast, RentalTimer
│   └── mobile/              # Touch controls + joystick
├── services/tmdb.ts         # TMDB client (frontend)
└── types/three-webgpu.d.ts  # Custom WebGPU type declarations
instrumentation.ts           # Startup code (cleanup scheduler, Radarr poller)
scripts/
└── seed-films.ts            # Seed DB depuis src/data/mock/films.json
```

## API Backend

- Same-origin (pas de CORS, `API_BASE = ''`)
- Auth par cookies signes httpOnly (`credentials: 'include'`)
- Convention `filmId` (asymetrique, attention) :
  - `/api/films/[tmdbId]` -> lookup par `films.tmdb_id`
  - `/api/rentals/[filmId]`, `/api/reviews/[filmId]`, `/api/cast-sessions { filmId }`,
    `/api/admin/films/[filmId]/{aisle,availability,download}` -> lookup par `films.id` interne
  - `src/api/index.ts:173` documente : `// filmId ici est l'ID interne du film (pas tmdb_id)`
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
| `GET` | `/api/films/aisle/[aisle]` | Films par allee (12 valeurs, voir section "Allees valides") |

### Toutes les routes (source: `app/api/**/route.ts`)

| Methode(s) | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | publique | Login user/passphrase |
| `POST` | `/api/auth/logout` | session | Logout |
| `POST` | `/api/auth/register` | publique | Inscription |
| `POST` | `/api/auth/recover` | publique | Recovery via phrase |
| `GET` | `/api/me` | session | Profil utilisateur |
| `GET` | `/api/me/notifications` | session | Notifications retour |
| `GET / POST` | `/api/me/weekly-bonus` | session | Status + claim bonus hebdo |
| `GET` | `/api/films` | publique | Liste films |
| `GET` | `/api/films/[tmdbId]` | mixte | Detail film + rental status |
| `GET` | `/api/films/aisle/[aisle]` | publique | Films par allee |
| `GET` | `/api/films/genre/[slug]` | publique | Films par genre |
| `GET` | `/api/films/desk-display` | publique | 3 derniers retours (deskFilms) |
| `GET` | `/api/genres` | publique | Liste genres |
| `POST` | `/api/rentals/[filmId]` | session | Louer un film |
| `GET` | `/api/rentals/[filmId]/download` | session | Stream / range source du film |
| `PATCH` | `/api/rentals/[filmId]/extend` | session | Prolonger location |
| `PATCH` | `/api/rentals/[filmId]/progress` | session | Maj watch position |
| `POST` | `/api/rentals/[filmId]/return` | session | Retourner (early-return credit) |
| `POST` | `/api/rentals/[filmId]/request-return` | session | Demander retour anticipe |
| `POST` | `/api/rentals/[filmId]/rewind` | session | Rewind reward credit |
| `PATCH` | `/api/rentals/[filmId]/viewing-mode` | session | Mode 'sur_place' (cast/local) |
| `GET / POST / PUT` | `/api/reviews/[filmId]` | mixte | Reviews CRUD |
| `GET / POST` | `/api/requests` | session | Commandes de films |
| `GET / POST` | `/api/board` | publique | Sticky notes (lecture publique) |
| `DELETE` | `/api/board/[noteId]` | session | Supprimer note |
| `POST / PATCH / DELETE` | `/api/cast-sessions` | session | Chromecast session tracking |
| `POST` | `/api/chat` | mixte | LLM manager streaming (cookie OR x-api-key) |
| `POST` | `/api/chat/close` | mixte | Fermer session chat |
| `GET` | `/api/poster/[...path]` | publique | Proxy TMDB images (disk cache 30j) |
| `POST` | `/api/push-subscribe` | session | Web Push subscription |
| `GET` | `/api/test/forced-video` | publique | Stream video forcee (dev/test) |
| `POST` | `/api/admin/films` | admin | Ajouter film (TMDB id) |
| `GET` | `/api/admin/films/status` | admin | Statut transcode batch |
| `PATCH` | `/api/admin/films/[filmId]/aisle` | admin | Assigner allee / nouveaute |
| `PATCH` | `/api/admin/films/[filmId]/availability` | admin | Toggle dispo |
| `POST` | `/api/admin/films/[filmId]/download` | admin | Lancer Radarr VO+VF |
| `GET` | `/api/admin/requests` | admin | Liste commandes en attente |
| `PATCH` | `/api/admin/requests/[id]` | admin | Approve / reject commande |
| `GET` | `/api/admin/stats` | admin | Stats globales |

NB : il n'y a **pas** de `DELETE /api/rentals/[filmId]` (utiliser `POST /return`), ni `DELETE /api/reviews/[filmId]` (PUT à la place), ni `DELETE /api/requests` — le doc historique mentionnait ces routes, elles n'existent pas.

## Catalogue de films

### Schema DB (table `films`)

Colonnes cles pour le catalogue :
- `aisle TEXT` — allee dans le videoclub (12 valeurs, voir section "Allees valides")
- `is_nouveaute BOOLEAN` — badge "nouveau" (un film peut etre dans une allee ET nouveaute)
- `radarr_vo_id INTEGER` — ID dans Radarr VO (null = pas encore telecharge)
- `radarr_vf_id INTEGER` — ID dans Radarr VF (null = pas encore telecharge)
- `is_available BOOLEAN` — visible pour les utilisateurs
- `file_path_vo TEXT` / `file_path_vf TEXT` — chemins fichiers (remplis par radarr-poller)

### Flow complet : ajouter un film

```
1. SEED (bulk)           SEED_MOCK=1 npm run seed   (exit 1 sans SEED_MOCK=1)
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

12 allees physiques + 1 virtuelle. Source de verite TS : `AisleType` dans `src/types/index.ts`.

| Allee | Notes |
|---|---|
| `action` | |
| `aventure` | |
| `bizarre` | |
| `classiques` | |
| `comedie` | |
| `drame` | |
| `horreur` | |
| `policier` | |
| `romance` | |
| `sf` | |
| `thriller` | |
| `animation` | |
| `nouveautes` | **virtuel** — filtre sur `is_nouveaute = 1`, pas une etagere physique. Un film peut etre dans `action` ET `nouveautes`. |

- Backend whitelist (`app/api/films/aisle/[aisle]/route.ts` `VALID_AISLES`) = les 12 physiques.
- Frontend ordre (`src/components/minitel/shared.ts` `AISLES_ORDER`) = les 12 physiques + `nouveautes`.
- Le 3D consomme les 13 (`src/components/interior/Aisle.tsx`).
- Le schema SQLite ne contraint pas la valeur (`aisle TEXT`) — la validation est applicative.

### Script seed (`SEED_MOCK=1 npm run seed`)

**Garde-fou** : `scripts/seed-films.ts` exit 1 sans `SEED_MOCK=1` (dev/test only) — `npm run seed` seul affiche une erreur et ne seed pas. Lit `src/data/mock/films.json` :
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
  - Dropdown allee (12 valeurs, voir section "Allees valides")
  - Toggle NEW (is_nouveaute)
  - Bouton DL (lance telechargement Radarr VO+VF, disparait une fois lance)
  - Toggle DISPO (is_available)
- **Demandes** : gestion des film_requests (approve/reject)
- **Stats** : users, films dispo/total, locations actives, demandes en attente

## Frontend 3D

### Composants cles
- **Controls.tsx** : FPS controls + raycasting + collisions (ZQSD/WASD) + tutorial camera waypoints
- **CassetteInstances.tsx** : VHS interactives (InstancedMesh + atlas 2D DataTexture). PAS DataArrayTexture — driver bugs sur NVIDIA Vulkan / iOS Metal, voir `memory/data-array-texture-tearing.md`. (Le legacy `Cassette.tsx` a été supprimé — remplacé par CassetteInstances ; ses constantes vivent dans `cassette-constants.ts`.)
- **TVTerminal.tsx** : Interface CRT retro (compte, locations, admin)
- **VHSPlayer.tsx** : Player video VF/VO/sous-titres + Google Cast (machine a etats unifiee — voir section dediee)
- **ActiveCastIndicator.tsx** : Chip flottant "Now Playing on TV" quand cast actif + player ferme. Tap → reouvre le player en mode telecommande.
- **TutorialOverlay.tsx** : Visite guidee 7 etapes, portrait Rick, dialogues, chevrons swipe
- **VHSCaseOverlay.tsx** : Panel K7 detail + annotations tutorial + glow cyclique + popup "credits insuffisants" avec action "Voir le Manager"
- **VHSCaseViewer.tsx** : Positionnement 3D de la K7 (fix cameraDirWithPitch pour tutorial)
- **WeeklyBonusToast.tsx** : Notification bonus credits hebdomadaire

### Hysteresis de selection
Double hysteresis pour eviter le flickering aux bords des cassettes :
- **Controls** : 400ms delay avant deselection + compteur hits consecutifs
- **CassetteInstances** : 50ms select / 250ms deselect (HYSTERESIS_SELECT=0.05 / HYSTERESIS_DESELECT=0.25, asymetrique)

### Collisions
Zones definies dans `Controls.tsx` : `{ minX, maxX, minZ, maxZ, name, cornerRadius? }`. `cornerRadius > 0` donne un coin arrondi (le coin de la zone est rogne par un quart-de-cercle, le joueur glisse autour au lieu de buter).

**Collision response** (3 paths, dans cet ordre) :
1. **Tangent projection sur coin arrondi** : si on heurte un quadrant de coin (cornerRadius > 0), on projette le mouvement sur la tangente du cercle → glissement continu le long du coin, plus de tremblement frame-par-frame.
2. **Axis-aligned slide** : pour les murs droits, slide sur l'axe libre (canSlideX ou canSlideZ).
3. **Cancel + damp velocity** : si les deux axes sont bloques (coin concave de deux murs droits perpendiculaires), on annule le mouvement et amortit la velocite a 15% pour casser le cycle "input → push → bounce".

L'AABB nudge precedent (qui poussait un seul axe et break) etait la source du tremblement permanent dans les coins.

### Player + Cast — machine a etats unifiee

`PlayerState` (`src/types/index.ts`): `'playing' | 'paused' | 'seeking' | 'rewinding' | 'fastforwarding' | 'casting' | 'awaitingCast'`.

**Pattern central** : `activeCastFilmId` (store) persiste a travers `closePlayer()` — la session Cast vit sur le receiver (TV) independamment de l'overlay player. Cela permet le flow "tap cast → ferme player pour marcher dans le clubvideo → reouvre player → retombe direct en mode telecommande".

**Transitions cle** :
- `tap "Regarder sur TV"` → `paused → awaitingCast` (local pause immediat, overlay 📡 anime) → `castMedia()` → succes : `awaitingCast → casting` / echec : `awaitingCast → paused` + resume local
- `closePlayer()` ne touche PAS `activeCastFilmId`. Le `castSessions.end()` au cleanup est aussi retire. La session DB reste tracee.
- `openPlayer(filmId)` declenche auto-detect : si `activeCastFilmId === currentPlayingFilm` ET SDK pas encore reconnect → `awaitingCast` avec timeout 6s. SDK confirme → promote `casting`. Timeout sans confirmation → endCast + paused.
- Disconnect detector (`!isCastConnected && playerState === 'casting'`) gated par `wasCastConnectedRef.current` : evite le tear-down premature au remount avant que le SDK ait re-publie ses events.

**Store actions liees** :
- `setActiveCastFilmId(id)` : set normal
- `endCast()` : clear activeCastFilmId. Appele UNIQUEMENT a la fin reelle du cast (Stop, disconnect, fin de film). PAS au closePlayer.
- `closePlayer()` : `isPlayerOpen=false, currentPlayingFilm=null`. **NE TOUCHE PAS activeCastFilmId**.
- `openPlayer(filmId)` : autorise toujours l'ouverture meme pendant un cast d'un autre film.

**`<video>` autoplay** : `autoPlay={playerState !== 'casting' && playerState !== 'awaitingCast'}`. Empeche le tag video de redemarrer une lecture locale quand on est cense caster.

**UI cast** (mobile-focus, voir `VHSPlayer.module.css`) :
- `castingOverlay` (full-screen) avec scanlines CSS (::before pseudo) pour coherence VHS/CRT
- `awaitingIcon` : 3 cercles concentriques pulsants emanent du disque satellite incline
- `awaitingDots` : 3 dots blinkent en sequence apres le titre
- `nowPlayingHeader` : chip device + titre film
- `nowPlayingTransport` : -15s · Play/Pause · +15s (circulaire central)
- `nowPlayingVolumeRow` : slider volume TV via `remoteSetVolume`
- `nowPlayingSecondary` : "📱 Sur le tel" (switch back local en preservant la position via `lastKnownCastTimeRef`) + "⏹ Arreter" (Stop classique)

VHSControls (les boutons VHS classiques) sont CACHES quand `playerState === 'casting' || 'awaitingCast'` — sinon double UI.

**Hook `useGoogleCast.ts`** :
- `preloadCastSdk()` exporte — appele dans `InteriorScene` quand `isSitting=true` pour pre-charger le script 1-3s avant que user tape "TV".
- Le SDK promise est cache (subsequent calls = instant).
- `wasCastConnectedRef.current` flippe true des que SDK publie `isCastConnected=true`. Gate du disconnect handler.

**Sync position local ↔ cast** :
- Save loop : `updateRentalProgress` toutes les 10s (avant : 30s). Save sur `<video>.onPause` event. Save sur `handleCastCurrentVideo` success (handoff position). Final flush via `flushPositionRef` au unmount du player.
- Resume : `<video>.currentTime = rental.watchPosition` au canplay event.
- Disconnect cast → resume local : `video.currentTime = lastKnownCastTimeRef.current` (SDK reset `remoteTime=0` AVANT que disconnect effect fire, donc on lit le ref maintenu pendant le throttle 1s).

### Tutorial (visite guidee)

Systeme de visite guidee en 7 etapes avec le manager Rick comme guide.

**Architecture** :
- `TUTORIAL_WAYPOINTS` (store) : 7 positions/lookAt camera, utilisees par Controls pour le lerp
- `tutorialStep` (0-6 | null) : etape courante, null = tutorial inactif
- `tutorialCameraTarget` : cible camera courante, consommee par Controls
- `TutorialOverlay.tsx` : portraits Rick, dialogues, points d'etape, chevrons swipe
- `VHSCaseOverlay.tsx` : annotations tutorial + glow cyclique sur les boutons (step 3)

**Etapes** :
| Step | Description | Visuel |
|------|-------------|--------|
| 0 | Bienvenue | Dialogue bottom |
| 1 | Navigation | Dialogue bottom |
| 2 | K7 ouverte, navigation | Chevrons swipe (mobile) / arrows pulse (desktop) |
| 3 | Systeme de credits | Liste rewards +1cr, glow cyclique boutons |
| 4 | Manager | Dialogue bottom |
| 5 | TV/Canape | Dialogue bottom |
| 6 | Bonne visite | Dialogue bottom |

**Fin du tutorial** : teleportation waypoint[0] (entree) + modale inscription si non authentifie (`showPostTutorialAuth`)

**K7 pendant tutorial** :
- Step 2 : ouvre une K7 aleatoire via `selectFilm()`
- Step 3 : K7 reste ouverte (no-op)
- Step 4+ : ferme la K7
- Positionnement : utilise `cameraDirWithPitch` (direction camera avec pitch) au lieu de la direction aplatie (Y=0)

## Performance

| Optimisation | Detail |
|---|---|
| Lumieres | 8 au lieu de 21 (-62%) via mode optimise |
| Raycast | Throttle tous les 3 frames (~20/sec, `RAYCAST_INTERVAL=3`) |
| Cassettes | 1 InstancedMesh + geometrie partagee pour ~520 cassettes |
| Shadows | `castShadow={false}` sur cassettes (-520 shadow renders) |
| Textures | TMDB w200 + atlas 2D DataTexture (PAS DataArrayTexture) + anisotropic filtering |
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

## Docker (7 services, 3 builds)

| Service | Image / Build | Role |
|---|---|---|
| `app` | **build `.`** → `zone-app` (Dockerfile `FROM node:22-slim`) | Next.js standalone — build l'image ET monte `.:/app`, entrypoint `scripts/docker-entrypoint.sh` |
| `storage` | `sebp/lighttpd` | Streaming video (films VO/VF) |
| `radarr-vo` | `linuxserver/radarr` | Gestion films VO |
| `radarr-vf` | `linuxserver/radarr` | Gestion films VF |
| `bazarr` | `linuxserver/bazarr` | Sous-titres |
| `cinema-stream` | **build `./cinema-stream`** | Flux HLS "cinéma live" (FFmpeg playlist VF → `media/public/symlinks/cinema-live`) |
| `zone-discord-bot` | **build `./zone-discord-bot`** | Bot Discord (network_mode: host) |

3 services se buildent (`app`, `cinema-stream`, `zone-discord-bot`) ; les 4 autres tirent des images upstream. Le service `app` monte le dossier du projet (`.:/app`) — on build le standalone sur la machine hôte (plus rapide que dans le container).

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
| `OPENROUTER_API_KEY` | Clef API OpenRouter (LLM manager, `app/api/chat`) — requis pour le manager |
| `CHAT_MODEL` | Modèle LLM OpenRouter (défaut `z-ai/glm-4.7-flash`) |
| `RADARR_VO_URL` / `RADARR_VF_URL` | URLs Radarr (défaut `http://radarr-vo:7878` / `…-vf:7878`) |
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

- `eslint: { ignoreDuringBuilds: false }` — **CI gate** : `next build` ECHOUE sur les erreurs ESLint (les warnings ne bloquent pas). Voir `next.config.ts:10-15`.
- `serverExternalPackages: ['better-sqlite3', 'bcrypt']` — modules natifs
- Three.js WebGPU types : augmentation `ArrayBufferView<any>` sur `GPUQueue.writeBuffer`
- `src/types/three-webgpu.d.ts` — declarations custom pour three/webgpu, three/tsl, addons

## Regles obligatoires - Projets 3D / Graphiques

### Avant de coder

1. **Etudier l'image de reference pixel par pixel** — materiaux, textures, eclairages, proportions
2. **Decouper en sous-taches granulaires** — chaque tache verifiable visuellement
3. **Rechercher l'etat de l'art** — ne JAMAIS assumer, chercher comment les experts font
4. **Comprendre l'objectif a 100%** — poser autant de questions que necessaire
5. **Verifier visuellement apres chaque modification** — comparer avec la reference
6. **Admettre quand je ne sais pas** — indiquer une alternative avec indice de confiance

### Interdictions

- JAMAIS utiliser des boites/formes simples par paresse au lieu de la bonne geometrie
- JAMAIS pretendre qu'une tache est "completee" sans verification visuelle
- JAMAIS passer a l'etape suivante sans validation visuelle
- JAMAIS generer du code "plausible" sans reflechir a l'objectif

### Lecons apprises

**Geometrie (01/02/2026)** : Echec avec des boites au lieu de geometrie tubulaire (NeonTube.ts existait). Resultat : rendu "jeu video 2005" au lieu du photorealisme demande.

**Instancing (03/02/2026)** : InstancedMesh ne fonctionne PAS quand chaque instance a sa propre texture (cassettes avec posters TMDB uniques). Utiliser geometrie partagee + meshes individuels.

**Ciblage FPS (02/02/2026)** : Les evenements pointer R3F (`onPointerOver`, `onClick`) suivent la position souris reelle, pas le centre ecran. En mode pointer lock, il faut raycaster depuis `(0,0)` dans `useFrame` + store Zustand pour `targetedCassetteKey`.
```
INCORRECT: Evenements pointer R3F → Position souris reelle
CORRECT:   useFrame → Raycast depuis (0,0) → Store Zustand → Cassette lit le store
```

**Identification objets 3D repetes** : Utiliser une cle basee sur la position (`cassetteKey: {shelf-type}-{position}-{row}-{col}`) plutot que l'ID de contenu (`filmId`). Stocker les deux dans `userData`.

**Variables reutilisables** : Vector3, Matrix4, Frustum → HORS du composant pour eviter allocations par frame.

**Direction camera aplatie (02/03/2026)** : Dans VHSCaseViewer, `_cameraDir` est aplatie (Y=0) pour un positionnement K7 horizontal stable. Toute utilisation de `_cameraDir.y` APRES l'aplatissement donne 0. Pour positionner un objet dans la direction reelle de la camera (avec pitch), sauvegarder la direction AVANT l'aplatissement.
```
INCORRECT: camera.getWorldDirection(_dir) → _dir.y = 0 → utiliser _dir.y (= toujours 0)
CORRECT:   camera.getWorldDirection(_dir) → sauver {x,y,z} → _dir.y = 0 → utiliser la copie
```

**Build cache Next.js** : Un cache `.next` corrompu peut causer des `PageNotFoundError` fantomes sur des routes API valides. Toujours `rm -rf .next` avant un build de verification.

**Three.js bump + cache prod (27/05/2026)** : Bumper la version de `three` dans `package.json` ne suffit pas si le serveur de prod a un `node_modules` cache. Le rename `THREE.PostProcessing → THREE.RenderPipeline` (r182 alias) a crash en prod parce que le serveur build avec r183 cache ou `RenderPipeline` n'existe pas. **Toujours prefer le nom long-vivant** (`PostProcessing` ici) quand le rename a juste un alias backward-compat, sauf si on controle 100% le cache de deploiement.

**Cast SDK ne se charge qu'a l'ouverture du player** (27/05/2026) : `useGoogleCast({ enabled: isPlayerOpen })` retarde le `loadCastSdk()` de 1-3s. Si le user tape "TV" rapidement au prompt, `isCastReady=false` → fall through au mirroring fallback → user pense que le cast est casse. Fix : appeler `preloadCastSdk()` quand `isSitting=true` (intent fort pre-cast) pour pre-chauffer le cache du SDK promise.

**closePlayer wipait activeCastFilmId** (29/05/2026) : Le design original traitait le cast comme ephemeral, tied au player overlay. Mais la TV continue de jouer apres close. La pattern correcte : `activeCastFilmId` est persistant. `closePlayer` ne le touche pas. `endCast()` est une action separee appelee uniquement a la fin reelle du cast.

**SDK reset state on disconnect avant qu'on lise** : Quand l'utilisateur stop le cast, `onIsConnectedChanged` fire et set `remoteTime=0, isMediaLoaded=false, playerState='UNKNOWN'` AVANT que le disconnect-resume useEffect ait pu lire. Pattern : `lastKnownCastTimeRef.current = remoteCastTime if remoteCastTime > 0` mis a jour a chaque render. Le ref garde la derniere valeur valide.

**Disconnect detector gate `wasCastConnectedRef`** : Le useEffect `!isCastConnected && playerState === 'casting'` fire au mount avec `isCastConnected=false` (SDK pas encore reconnect) → tear-down premature. Fix : flag local qui flippe true des que SDK publie connected=true. Le disconnect handler skip si jamais ete connecte dans cette session.

**TAAU 0.75x sur mobile rejete** (22/05/2026) : Voir `memory/taau-mobile-rejected.md`. Le rendu temporal upscaling brise les posters K7 au-dessous du seuil de lisibilite. Pas re-essayer en-dessous de 0.85x tant que les K7 sont le contenu principal.

**Tremblement coin = AABB nudge alternant** (24/05/2026) : Quand deux axes sont bloques, l'ancien fallback poussait UN seul axe puis break → l'autre mur restait viole → frame suivante poussait l'autre axe. Resultat : oscillation 60Hz. Fix : tangent projection pour coins arrondis, cancel-move + velocity damp pour coins concaves de murs droits.

**Boutons disabled = silent fail sur mobile** (27/05/2026) : `<button disabled>` avale le tap event sans aucun feedback. Pattern correct : laisser le bouton actif, le `onClick` decide si l'action est faisable et surface une popup explicative. Le user comprend pourquoi ca marche pas + a une action.

## Skills

- **threejs-webgpu-architect** : Architecture Three.js/R3F, performance, photorealisme, assets
- **webgpu-pure** : WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- **webgpu-canvas-text** : Texte dans scenes WebGPU via CanvasTexture (Troika incompatible WebGPU)
- **webgpu-light-baking-nee** : Bake lightmap/GI WebGPU/TSL (Next-Event Estimation, three-mesh-bvh gather) — bruit, émetteurs néon, ombres, seams UV
