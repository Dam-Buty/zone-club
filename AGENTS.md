# AGENTS.md — Zone Club

Guide de travail pour les agents sur ce dépôt. `CLAUDE.md` pointe ici.

## Projet

Vidéoclub en ligne complet : frontend 3D immersif (FPS dans un vidéoclub des années 90),
catalogue, acquisition et transcodage automatiques, diffusion, chaîne linéaire 24/7,
comptes / crédits / critiques, et un gérant LLM. Monolithe Next.js (API + frontend) plus
deux services Node autonomes.

## Stack

- **Framework** : Next.js 15 App Router + React 19, `output: 'standalone'`
- **3D** : Three.js 0.184 via React Three Fiber — WebGPU + TSL à l'intérieur, WebGL nu à l'extérieur
- **État** : Zustand 5 avec persistance localStorage
- **Styles** : Tailwind CSS v4 + CSS Modules
- **DB** : SQLite via `better-sqlite3` (server-side only), migrations idempotentes au boot
- **Auth** : cookies signés `cookie-signature` (pas de JWT) + CSRF par vérification d'origine (`middleware.ts`)
- **Média** : ffmpeg 7, NVENC distant par pipe SSH, tesseract/pgsrip, Radarr
- **LLM** : Vercel AI SDK + OpenRouter, tracing Langfuse

## Règles Git — OBLIGATOIRE

1. **Avant de travailler sur une branche feature** : TOUJOURS `git rebase main` ou vérifier
   que la branche est à jour. Ne jamais commencer à coder sur une branche qui n'a pas les
   derniers commits de main.
2. **Quand on commit un fix sur main depuis une branche feature** (via stash) : TOUJOURS
   cherry-pick ou rebase le fix sur la branche feature immédiatement après. Le double stash
   (stash → pop sur main → commit → re-stash → pop sur feature) perd le fix : il est consommé
   par le commit sur main et n'est plus dans le second stash.
3. **Ne jamais laisser une branche feature diverger de main** sans raison.

## Commandes

```bash
npm run dev              # Dev server (port 3000) — dev:mobile pour 0.0.0.0:3001
npm run build            # Build production standalone
npm run deploy           # Cycle complet : down app → rm -rf .next → npm i → build → up app
npm run seed             # Seed catalogue depuis src/data/mock/films.json
npm run refresh          # Rafraîchit les métadonnées TMDB
npm run report           # Rapport de collection
npm run migrate          # Migration media reset (--keep pour conserver)
npm run configure:radarr # Configuration Radarr déclarative et idempotente (--dry)
npm run test:phase       # Garde-fous (node --test) — test:phase:full ajoute le build
npm run audit:unused     # Assets/scripts orphelins (:strict = exit non-zéro)
npm run transcode:progress   # watch SQL sur les films en cours de traitement

npm run cinema:up|down|restart|rebuild|logs   # chaîne HLS 24/7
npm run bot:up|down|restart|rebuild|logs      # bot Discord
npm run loopback:start|stop|status            # renvoie l'audio de la chaîne vers la sortie locale
```

**Deploy** : le container `app` monte le dossier du projet et sert le build standalone —
on build depuis la machine hôte (bien plus rapide que dans le container).

## Arborescence

```
app/
├── page.tsx                 # Dynamic import de src/App (ssr: false)
├── layout.tsx               # Root layout — preload HDR / GLB / KTX2 dès le parse HTML
└── api/                     # 40 routes App Router (table complète plus bas)
middleware.ts                # CSRF Origin/Referer sur /api/* non-GET, bypass x-api-key
instrumentation.ts           # Boot : cleanup scheduler, Radarr poller, recoverMediaPipeline, Langfuse

lib/                         # Backend
├── db.ts schema.sql migrations/   # SQLite + migrations idempotentes
├── auth.ts session.ts passphrase.ts rate-limit.ts
├── films.ts rentals.ts reviews.ts requests.ts board.ts bonus.ts symlinks.ts
├── radarr.ts radarr-poller.ts     # acquisition + poller 2 min
├── media/                         # ← le pipeline, voir section dédiée
│   ├── process-film.ts            # orchestrateur + file d'attente
│   ├── probe.ts identify-tracks.ts iso639.ts media-dir.ts
│   ├── quality-control.ts stuck-imports.ts
│   ├── video-plan.ts remote-encode.ts ffmpeg-ops.ts ocr-subs.ts
│   ├── refresh.ts run-stats.ts
├── chat.ts chat-tools.ts user-facts.ts dictionaries/   # gérant LLM
├── cast-sessions.ts cast-session-checker.ts
├── cleanup.ts push.ts tmdb.ts

src/
├── App.tsx                  # Vrai point d'entrée : gate WebGPU, lazy loading, prefetch catalogue, PWA
├── api/index.ts             # Client API frontend
├── store/index.ts + slices/ # Zustand (manager.ts, tutorial.ts externalisés)
├── components/
│   ├── exterior/scene/      # ExteriorScene.ts — WebGL pur, shader vitrine, pluie, phares
│   ├── interior/            # Scène WebGPU : Aisle, CassetteInstances, Controls, Lighting,
│   │                        # PostProcessingEffects, MinitelScreen, InteractiveTVDisplay,
│   │                        # LaZoneCRT, VHSCaseViewer, BenchmarkMode
│   ├── minitel/             # Overlay Minitel 1982 (catalogue, recherche, commande)
│   ├── terminal/            # TVTerminal — compte + admin
│   ├── player/              # VHSPlayer + Google Cast / AirPlay
│   ├── manager/             # Chat du gérant + composants Generative UI
│   ├── videoclub/ tutorial/ mobile/ ui/ board/ auth/ review/ search/
├── hooks/                   # useGoogleCast, useKTX2Textures, useIdleDetection…
├── utils/                   # CassetteTextureArray (atlas), VHSCoverGenerator…

cinema-stream/               # Service Node autonome — chaîne HLS 24/7
zone-discord-bot/            # Service Node autonome — présence Discord
scripts/                     # seed, migrate, configure-radarr, cinema-cam*, entrypoint…
tests/                       # node --test — architecture, domain, cache, media, performance
```

`cinema-stream/` et `zone-discord-bot/` sont **exclus du tsconfig racine** : ce sont des
sous-projets avec leur propre `package.json`, `tsconfig.json` et `Dockerfile`.

## Docker (5 services)

| Service | Image | Rôle |
|---|---|---|
| `app` | build local (`node:22-trixie-slim`) | Next.js standalone + tout le pipeline média |
| `storage` | `sebp/lighttpd` | Sert les MP4 transcodés et le HLS de la chaîne |
| `radarr` | `linuxserver/radarr` | Acquisition (instance **unique**) |
| `cinema-stream` | build local | Chaîne HLS 24/7 |
| `zone-discord-bot` | build local | Présence Discord (`network_mode: host`) |

Notes d'infra qui ont coûté cher :

- **L'image `app` est Debian 13 (trixie) pour ffmpeg 7**, pas 12. Le ffmpeg 5.1 de Debian 12
  traite les sorties multiples **en série** : un mux à deux sorties y coûte exactement le
  double d'une seule (10,37 s contre 5,42 s mesurés). À partir de la 6/7, les deux encodages
  AAC tournent en parallèle.
- **Radarr a un bind unique aux chemins identiques à l'hôte** (`/data/phat-two:/data/phat-two`).
  Library et téléchargements doivent partager le même point de montage, sinon le noyau refuse
  `link()` (`EXDEV`) et les liens durs cassent. Chemins identiques = pas de remote path mapping.
- Les téléchargements SABnzbd sont montés en lecture seule **au même chemin** côté `app` : ça
  permet de sonder soi-même un fichier que Radarr refuse d'importer au lieu d'attendre un délai
  en espérant qu'il change d'avis (il ne change jamais).
- L'entrypoint recopie la clé SSH depuis le bind hôte vers `/root/.ssh` : openssh refuse une
  clé dont le propriétaire n'est ni root ni l'utilisateur courant.

## API Backend

- Same-origin (pas de CORS, `API_BASE = ''`)
- Auth par cookies signés httpOnly (`credentials: 'include'`)
- **Convention `filmId` (asymétrique, attention)** :
  - `/api/films/[tmdbId]` → lookup par `films.tmdb_id`
  - `/api/rentals/[filmId]`, `/api/reviews/[filmId]`, `/api/cast-sessions { filmId }`,
    `/api/admin/films/[filmId]/*` → lookup par `films.id` interne

| Méthode(s) | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` \| `register` \| `recover` | publique | Login / inscription / récupération |
| `POST` | `/api/auth/logout` | session | Logout |
| `GET` | `/api/me` | session | Profil |
| `GET` | `/api/me/notifications` | session | Notifications retour |
| `GET / POST` | `/api/me/weekly-bonus` | session | Statut + claim bonus hebdo |
| `GET` | `/api/films` | publique | Liste films |
| `GET` | `/api/films/[tmdbId]` | mixte | Détail + statut de location + `has_vf`/`has_vo` |
| `GET` | `/api/films/aisle/[aisle]` | publique | Films par rayon |
| `GET` | `/api/films/genre/[slug]` | publique | Films par genre |
| `GET` | `/api/films/desk-display` | publique | 3 derniers retours (comptoir) |
| `GET` | `/api/genres` | publique | Liste genres |
| `POST` | `/api/rentals/[filmId]` | session | Louer |
| `GET` | `/api/rentals/[filmId]/download` | session | Stream / range source |
| `PATCH` | `/api/rentals/[filmId]/extend` \| `progress` \| `viewing-mode` | session | Prolonger / position / mode |
| `POST` | `/api/rentals/[filmId]/return` \| `request-return` \| `rewind` | session | Retour / demande / rembobinage |
| `GET / POST / PUT` | `/api/reviews/[filmId]` | mixte | Critiques |
| `GET / POST` | `/api/requests` | session | Commandes de films |
| `GET / POST` | `/api/board` | publique | Post-it (lecture publique) |
| `DELETE` | `/api/board/[noteId]` | session | Supprimer un post-it |
| `POST / PATCH / DELETE` | `/api/cast-sessions` | session | Suivi des sessions Cast |
| `POST` | `/api/chat` · `/api/chat/close` | mixte | Gérant LLM (cookie OU `x-api-key`) |
| `GET` | `/api/poster/[...path]` | publique | Proxy TMDB (cache disque 30 j) |
| `POST` | `/api/push-subscribe` | session | Abonnement Web Push |
| `GET` | `/api/test/forced-video` | publique | Stream vidéo forcée (dev/test) |
| `POST` | `/api/admin/films` | admin | Ajouter un film (`{ tmdb_id }`) |
| `GET` | `/api/admin/films/status` | admin | Statut de traitement par lot |
| `PATCH` | `/api/admin/films/[filmId]/aisle` \| `availability` | admin | Rayon / nouveauté / dispo |
| `POST` | `/api/admin/films/[filmId]/download` \| `refresh` | admin | Lancer Radarr / rafraîchir métadonnées |
| `GET` | `/api/admin/requests` · `PATCH /api/admin/requests/[id]` | admin | Commandes (approve/reject) |
| `GET` | `/api/admin/stats` | admin | Stats globales |

Il n'y a **pas** de `DELETE /api/rentals/[filmId]` (utiliser `POST /return`), ni de
`DELETE /api/reviews/[filmId]` (`PUT` à la place), ni de `DELETE /api/requests`.

## Base de données

Tables : `users`, `films`, `genres`, `film_genres`, `rentals`, `reviews`, `film_requests`,
`weekly_bonuses`, `return_requests`, `user_facts`, `board_notes`, `film_processing_runs`,
`push_subscriptions`, `cast_sessions`.

Colonnes clés de `films` :

| Colonne | Rôle |
|---|---|
| `aisle` | Rayon (12 valeurs, voir plus bas) |
| `is_nouveaute` | Badge « nouveau » — additif, un film peut être en rayon ET nouveauté |
| `is_available` | Visible pour les utilisateurs |
| `radarr_id` | ID dans l'instance Radarr unique |
| `original_language` | Pilote le choix du profil de qualité et l'identification VO |
| `media_dir` | Dossier de sortie (nom de dossier Radarr, « Titre (Année) ») |
| `file_path_vo_transcoded` / `file_path_vf_transcoded` | MP4 finaux |
| `subtitle_fr_vtt` / `_srt`, `subtitle_en_vtt` / `_srt` | Sous-titres extraits |
| `transcode_status` / `_progress` / `_error` | `pending` · `done` · `error` · `qc_failed` · `rejected_release` |
| `qc_attempts` / `qc_force` | Compteur de rejets QC / laissez-passer manuel |
| `duration_sec` | Cache ffprobe — **utilisé par la chaîne 24/7** |
| `actors` / `directors` / `synopsis` | Lourds — `actors` seul pèse 232 Ko sur l'ensemble du catalogue. Servis par le **détail** uniquement, jamais par les listes |
| `stock` | Nombre de copies (défaut 2) |

⚠️ `radarr_vo_id`, `radarr_vf_id`, `file_path_vo`, `file_path_vf` sont des **colonnes mortes**
de l'ère 2×Radarr. Plus aucun writer. Ne pas s'en servir, ne pas les remettre en service.

## Pipeline média

C'est le sous-système le plus dense du dépôt. Lire `lib/media/process-film.ts` avant d'y
toucher.

### Architecture

**Une seule instance Radarr** qui télécharge une release **MULTi** (VF + VO dans le même MKV) ;
toute la séparation VO/VF et l'extraction des sous-titres se fait localement. Deux profils de
qualité selon `original_language` (`RADARR_QUALITY_PROFILE_ID` pour les films non francophones,
`_FR` pour les francophones), poussés par `scripts/configure-radarr.ts` (idempotent, `--dry`).

### Flux

1. **Ajout** — `POST /api/admin/films` → `addFilmFromTmdb()` crée la ligne, sans toucher Radarr.
2. **Déclenchement** — `POST /api/admin/films/[id]/download` → `triggerDownload()` choisit le
   profil, ajoute à Radarr avec recherche automatique, stocke `radarr_id`.
3. **Poller** (`lib/radarr-poller.ts`, toutes les 2 min, démarré par `instrumentation.ts`) :
   `checkStuckImports()` puis, pour chaque film pending, `getMovieStatus()` ; si `hasFile`,
   `enqueueProcessFilm()`. `recoverMediaPipeline()` réenfile tout au boot (reprise après crash).
4. **`processFilm()`** — file locale, `PROCESS_MAX_CONCURRENT` = 1 par défaut (le GPU distant
   est partagé) :
   - localisation du MKV → `probeStreams()` → `identifyTracks()` (VO, VF, subs texte, subs image)
   - **contrôle qualité** avant tout travail coûteux (sauf retraitement ou `qc_force`)
   - **backup du MKV lancé en parallèle**, sérialisé globalement
   - `planVideo()` → copie ou encodage GPU distant
   - **en parallèle** : une passe ffmpeg unique extrait audio + sous-titres, OCR si besoin
   - remux final en **copie pure** → `vo.mp4` (+ `vf.mp4`), `-movflags +faststart`
   - écriture DB, `is_available = 1`, `transcode_status = 'done'`
   - libération de la source (suppression MKV + `unmonitor`) après backup confirmé
5. **Erreur** → `transcode_status = 'error'`, MKV **jamais supprimé**, film retriable au cycle suivant.

### Décisions

**Plan vidéo** (`video-plan.ts`) — copie directe si et seulement si : H.264, `yuv420p`, profil web
(baseline/main/high, pas High10), ≤ 1920×1080, et débit ≤ `VIDEO_COPY_MAX_BITRATE` (6 Mbit/s).
Sinon encodage. Réencoder une source déjà propre ne gagne rien et perd une génération.

**Encodage distant** (`remote-encode.ts`) — pipe SSH, pas un service HTTP. ffmpeg local démuxe la
vidéo seule → `ssh` → ffmpeg distant NVDEC/NVENC → `.part` local → rename atomique. Trois variantes :

- `cudaCommand` (nominal) : `-hwaccel cuda`, `scale_cuda` si > 1080p, `format=yuv420p` (NVENC 8 bits)
- `softwareDecodeCommand` : H.264 non-8-bit — **NVDEC ne décode le H.264 qu'en 8 bits**, donc décodage CPU
- `hdrCommand` : HDR→SDR via **libplacebo** (`tonemap_cuda` absent, interop CUDA→Vulkan en échec) ;
  le downscale se fait **AVANT** l'upload Vulkan, contrainte mémoire de la machine distante

La sortie est **toujours taguée SDR BT.709** : sinon un Chromecast bascule en mode HDR sur un
fichier qui n'en est plus un. Garde-fous anti-troncature par message ffmpeg ET par ratio de durée.

**Contrôle qualité** (`quality-control.ts`) — appliqué **après** téléchargement, l'indexeur n'exposant
aucune métadonnée audio. Non francophone : exige VF + VO distincte + sous-titres FR (texte ou PGS
convertible). Francophone : une piste FR suffit. Sur rejet, on blackliste la release et on laisse
Radarr relancer sa recherche lui-même (pas d'appel `searchMovie` explicite — évite le double
téléchargement). Au-delà de `QC_MAX_ATTEMPTS`, statut `qc_failed`, plus de retry.

**Imports bloqués** (`stuck-imports.ts`) — vérifiés à chaque cycle du poller, indépendamment des
films pending (un import bloqué n'a pas encore `hasFile`). On **sonde le fichier au ffprobe** au lieu
d'attendre un délai ; s'il est illisible, on agit immédiatement.

**OCR** (`ocr-subs.ts`) — `pgsrip` + tesseract, **PGS uniquement**. Le VobSub est explicitement exclu.
Déclenché seulement si la meilleure piste texte de la langue est absente ou fait moins de
`SUB_FORCED_MAX_CUES` cues (heuristique « piste forcée » vs dialogues complets). Post-traitement de
correction des confusions de caractères. Échec = `null`, jamais fatal.

**Métriques** — une ligne `film_processing_runs` par exécution (décision vidéo, durée par étape,
tailles, issue). Les logs Docker ont une fenêtre de ~12 jours, les questions arrivent après.

### Sorties

`MEDIA_FILMS_PATH/<media_dir>/` → `vo.mp4`, `vf.mp4`, `sub.fr.{vtt,srt}`, `sub.en.{vtt,srt}`.
H.264 ≤ 1080p SDR BT.709, AAC stéréo 192k, faststart.

À la location, `createRentalSymlinks()` crée un dossier UUID sous `SYMLINKS_PATH`, servi par
lighttpd. L'URL est le secret ; elle disparaît au retour.

## Chaîne cinéma 24/7 (`cinema-stream/`)

Playlist **sans état** : la position courante est une fonction pure de l'horloge.
`(maintenant − PLAYLIST_START) mod durée totale`, films triés par `id`, durées lues depuis
`duration_sec`. N'importe quel processus retombe sur le même résultat sans coordination.

`PLAYLIST_START` (`YYYY-MM-DD`) est converti en minuit **Europe/Paris**, gestion DST incluse.

Au boot, ffprobe + `UPDATE duration_sec` pour tout film sans cache. Puis : liste concat ffmpeg
(`inpoint` sur le premier film pour démarrer à la bonne seconde), **dupliquée 50 fois** pour
simuler une boucle infinie sans logique de bouclage, et un ffmpeg `-re` long-running qui écrit du
HLS dans `HLS_OUT_DIR` (volume `media_public`, servi par lighttpd) : segments 4 s, fenêtre de 6,
GOP fixe, `delete_segments+omit_endlist+independent_segments`.

Chien de garde : si le `.m3u8` n'a pas été touché depuis 30 s, SIGKILL. Au redémarrage la position
est **recalculée depuis l'horloge** — un crash ne met pas la chaîne en retard, il fait sauter le
passage manqué.

⚠️ `cinema-stream` ouvre la DB **en écriture** (il écrit `duration_sec`). Le bot Discord l'ouvre en
lecture seule et **dépend de ce cache** — sans `cinema-stream` démarré au moins une fois, le bot ne
voit aucun film.

## Bot Discord (`zone-discord-bot/`)

**Il ne streame rien, et c'est délibéré.** Les libs de streaming vidéo Discord exigent un *selfbot*
(token utilisateur) ; Discord bloque l'envoi vidéo depuis les bots officiels. Risque de ban. La
responsabilité est donc scindée :

- Le **bot officiel** recalcule la même position dans la playlist (code dupliqué depuis
  `cinema-stream`, synchronisé par la DB partagée et `PLAYLIST_START`) et met à jour toutes les
  60 s le statut du salon vocal (`PUT /channels/{id}/voice-status`) et son activité. Il rejoint le
  vocal en `selfDeaf`/`selfMute` et n'y émet rien.
- L'**image et le son** passent par une machine opérateur : `scripts/cinema-cam.sh` ingère le HLS
  dans une caméra virtuelle `v4l2loopback` + un null-sink PulseAudio dont le monitor sert de micro.
  OBS sur macOS. L'humain partage sa « webcam » — cas d'usage standard.
  `scripts/cinema-cam-install.sh` pose deux unités systemd (module au boot + service user).

## Frontend 3D

### Deux pipelines de rendu

**Extérieur** (`src/components/exterior/scene/ExteriorScene.ts`) — WebGL pur, **sans R3F**. Quad
plein écran, photo de devanture + masque RGB (R = néons, G = vitres, B = métal) pilotant un shader
GLSL maison. Pluie en 3 couches de `LineSegments` avec vent et rafales, phares procéduraux
(voitures / police / pompiers) réfléchis sur vitre, métal et flaques, letterboxing dynamique.
Desktop uniquement — sur mobile, image statique + bouton.

**Intérieur** — WebGPU (`THREE.WebGPURenderer` + R3F + TSL). **Pas de repli WebGL** : sans
`navigator.gpu`, `App.tsx` affiche un écran d'excuses avec instructions par navigateur.

### Optimisations réelles

| Sujet | Implémentation |
|---|---|
| ~520 cassettes | **1 seul `InstancedMesh`**, géométrie partagée |
| Jaquettes | **Atlas 2D** (`DataTexture`, cellules 200×300, ~78 Mo) — **PAS `DataArrayTexture`** |
| Upload GPU | Un seul flush en fin de chargement (`markDirty()`) au lieu d'un upload par poster |
| Animation du survol | **Compute shader TSL** sur storage buffers (`instancedArray` + `Fn().compute()`), avec hot path / cold path |
| Tubes néon | 2 `InstancedMesh` (tube + réglette) pour 16 positions = 2 draw calls au lieu de 32 |
| Ombres | 1 seule shadow map, figée après 3 frames (`shadow.autoUpdate = false`) |
| Scène statique | **Throttle adaptatif** : 60 fps actif → 20 fps au repos |
| Murs | `mergeGeometries` — 3 murs en 1 mesh |
| Anti-aliasing | `antialias: false` + supersampling ×1.25 + SMAA + sharpen RCAS |
| Textures | KTX2 / Basis Universal avec repli JPEG, mipmaps trilinéaires + anisotropie 16 + LOD bias −0.25 (desktop seul) |
| Premier affichage | Warmup : balayage caméra 4 orientations + `compileAsync` en boucle jusqu'à plateau des pipelines |
| Raycast | Depuis (0,0) dans `useFrame`, throttlé, pas de scan récursif complet |

Post-processing (`PostProcessingEffects.tsx`, TSL) — desktop : Bloom → DoF (uniquement quand une K7
est ouverte) → vignette → SMAA → sharpen. Mobile : Bloom → vignette → FXAA. Le SSGI est présent mais
désactivé (~3× le frame time).

Il n'y a **ni LOD ni occlusion culling** : la scène est petite, `frustumCulled = false` sur les
cassettes.

### Interfaces diégétiques

- **Minitel** (`src/components/minitel/` + `interior/MinitelScreen.tsx`) — modèle GLB 1982, écran
  peint en `CanvasTexture` (VT323) sur un mesh du GLB, hitboxes exposées sur
  `window.__minitelHitboxes` et routées depuis le raycaster de `Controls.tsx`. Modes
  `sommaire/recherche/rayons/alpha/commander/detail`, recherche floue locale, recherche TMDB pour
  **commander** un film absent, et « ILLUMINER » qui déclenche le highlight GPU de la K7 en rayon.
- **Terminal TV** (`src/components/terminal/TVTerminal.tsx` + `interior/InteractiveTVDisplay.tsx`) —
  CRT du canapé : compte, locations, historique, crédits, critiques, badges. Panneau admin
  déverrouillé en tapant `admin` au clavier (films, rayons, dispo, téléchargement, commandes, stats).
- **LaZoneCRT** — vieille télé branchée sur un service de TV linéaire maison (externe au dépôt).
  MP4 progressifs, pas de HLS. `VideoTexture` recréée à chaque changement de source (contournement
  d'un bug de texture GPU périmée en WebGPU), détection de frame bloquée > 2,5 s → skip auto.

### Collisions (`Controls.tsx`)

Zones `{ minX, maxX, minZ, maxZ, name, cornerRadius? }`. Réponse en 3 chemins, dans cet ordre :

1. **Projection tangentielle sur coin arrondi** — glissement continu le long du coin
2. **Slide sur axe libre** — murs droits
3. **Annulation + amortissement de la vélocité à 15 %** — coin concave de deux murs perpendiculaires

L'ancien nudge AABB (qui poussait un seul axe puis `break`) était la source d'un tremblement 60 Hz
permanent dans les coins.

### Store Zustand

`src/store/index.ts` (monolithe, ~1000 lignes) + 2 slices externalisées (`slices/manager.ts`,
`slices/tutorial.ts`). Persist `videoclub-storage` avec `partialize` restreint (`localUser`,
`rentalHistory`, flags d'onboarding, scène courante) — **pas l'auth**, gérée par cookie.

`rentalHistory` est **alimenté par le serveur** (`fetchMe` → `/api/me`) et contient **toutes** les
locations, actives comprises : ne pas l'additionner à `rentals.length` pour obtenir un total. La copie
persistée n'est qu'un cache d'affichage en attendant la réponse de `fetchMe` ; `logout()` la vide.

`InteractionMode` : `'none' | 'sitting' | 'minitel' | 'tvStanding' | 'lazoneStanding' |
'lazoneWatching' | 'film'`. Remplace 6 setters mutex codés à la main qui avaient dérivé ; les
booléens `isXxx` subsistent comme vues dérivées pour les ~50 sites de lecture existants.

Store exposé sur `window.__store` hors production (debug / Playwright).

### Player + Cast — machine à états unifiée

`PlayerState` : `'playing' | 'paused' | 'seeking' | 'rewinding' | 'fastforwarding' | 'casting' |
'awaitingCast'`.

**Pistes** : `AudioTrack` (`'vf' | 'vo'`) et `SubtitleTrack` (`'off' | 'fr' | 'en'`). Les quatre
peuvent manquer indépendamment — un film est régulièrement VF-only, ou VO avec les seuls sous-titres
anglais. Deux effets « snap » ramènent la sélection sur quelque chose qui existe, sans jamais rallumer
des sous-titres coupés à la main. Côté `<video>`, une seule `<track>` est montée à la fois, avec une
`key` par langue : swapper le `src` d'une `<track>` déjà montée ne rafraîchit pas la textTrack, et
l'attribut `default` d'une `<track>` insérée après le parse n'est pas honoré de façon fiable — d'où
l'effet qui force `track.mode` explicitement (`addtrack` inclus, la piste pouvant arriver après le rendu).

Le Cast ne transporte **pas** les sous-titres : le receiver reçoit l'URL du MP4, rien d'autre.

**Pattern central** : `activeCastFilmId` **persiste à travers `closePlayer()`**. La session Cast vit
sur le receiver indépendamment de l'overlay : on peut fermer le lecteur, marcher dans les rayons, le
rouvrir et retomber directement en mode télécommande.

- `tap « Regarder sur TV »` → `paused → awaitingCast` (pause locale immédiate) → succès `casting`,
  échec retour `paused` + reprise locale
- `closePlayer()` : `isPlayerOpen=false`, `currentPlayingFilm=null`. **Ne touche pas `activeCastFilmId`.**
- `endCast()` : appelé **uniquement** à la fin réelle du cast (Stop, disconnect, fin de film)
- `openPlayer(filmId)` : auto-détection — si `activeCastFilmId` correspond et que le SDK n'a pas
  encore reconnecté → `awaitingCast` avec timeout 6 s
- Le détecteur de disconnect est gaté par `wasCastConnectedRef` : sans ça, au remount le SDK publie
  `isCastConnected=false` avant d'avoir republié ses events → tear-down prématuré
- `<video autoPlay={playerState !== 'casting' && playerState !== 'awaitingCast'}>`
- `preloadCastSdk()` est appelé dès `isSitting=true` : le SDK met 1 à 3 s à charger, et l'utilisateur
  tape « TV » avant

Sync de position : `updateRentalProgress` toutes les 10 s + sur `pause` + au handoff cast + flush
final au unmount. Au disconnect, on restaure depuis `lastKnownCastTimeRef` (le SDK remet `remoteTime`
à 0 **avant** que l'effet de disconnect ne lise).

### Tutorial

7 étapes, `TUTORIAL_WAYPOINTS` dans le store, lerp caméra dans `Controls`. Étape 2 ouvre une K7
aléatoire, étape 3 la garde ouverte avec annotations et glow cyclique, étape 4+ la ferme. Fin :
téléportation au waypoint d'entrée + modale d'inscription si non authentifié.

## Gérant LLM

- **Provider** : OpenRouter via `@ai-sdk/openai`, Vercel AI SDK (`streamText`, `stepCountIs(5)`)
- **Modèle** : `CHAT_MODEL` (défaut `z-ai/glm-4.7-flash`)
- **Persona** : Michel, gérant depuis 1984 — bourru, tutoie, 2 à 4 phrases, jamais d'emoji.
  Deux prompts système : authentifié (contexte crédits / locations / critiques / faits mémorisés)
  et invité (orienté inscription)
- **Outils** (`lib/chat-tools.ts`, Zod) qui renvoient des **composants React**, pas du texte :
  `get_film`, `backdrop`, `rent`, `critic`, `watch`, `add_credits`, `remember_fact` ; en invité :
  `signup`, `signin`
- **Mémoire** : table `user_facts`, réinjectée dans le prompt système sous « CE QUE TU SAIS SUR CE CLIENT »
- **Rate limit** : invité 8/h, authentifié 40/h, clé API illimitée
- **Observabilité** : Langfuse via `@langfuse/otel`, `experimental_telemetry` avec `sessionId`/`userId`

### Test CLI

```bash
curl -s "https://$SUBDOMAIN.$DOMAIN/api/chat" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_SECRET" -H "x-user-id: 1" \
  -d '{"messages":[{"id":"m1","role":"user","content":"Salut","parts":[{"type":"text","text":"Salut"}]}],"events":[]}'
```

Le SDK attend des UIMessages avec `id`, `role`, `content` **et** `parts`.

## PWA

`public/sw.js` — deux stratégies seulement :

- **cache-first** : assets 3D immuables (`/models`, `/textures`, `/basis`, `.glb/.ktx2/.hdr/.wasm`)
  et bundles Next hashés
- **network-only** : tout le reste, catalogue compris

### ⚠️ Bumper `VERSION` quand un asset 3D change

**Toute modification d'un fichier sous `public/models/`, `public/textures/` ou `public/basis/`
impose de bumper `VERSION` dans `public/sw.js`.** Sinon les visiteurs déjà venus gardent l'ancien
fichier indéfiniment.

La règle est plus large que la liste `PRECACHE_URLS` : le `cache-first` est sélectionné **par
chemin** (`/models/`, `/textures/`, `/basis/`, ou une extension `.glb` / `.ktx2` / `.hdr` /
`.wasm`), donc les 11 GLB et tous les jeux de textures sont concernés, pas seulement les 18 URLs
précachées. Ces URLs ne sont pas content-hashées — rien d'autre ne les invalide. Le `activate`
supprime tous les caches dont le nom ne correspond pas au `VERSION` courant.

Les bundles Next (`/_next/static/`) sont eux content-hashés : ils n'ont pas besoin du bump.

C'est une étape manuelle sans garde-fou, signalée deux fois en audit (`docs/audit-2026-03-17.md`,
P-09 et C-11) et jamais automatisée. Le catalogue a été sorti du cache pour cette raison ; les
assets 3D, eux, y restent — ils sont réellement immuables entre deux déploiements.

### Fraîcheur du catalogue

`network-only` dans le service worker : le cache du catalogue est celui du navigateur, piloté par le
`Cache-Control` des routes (`public, max-age=0, must-revalidate, s-maxage=300,
stale-while-revalidate=3600`). Le `max-age=0` explicite évite de laisser la fraîcheur à
l'heuristique du navigateur faute de directive.

Les routes de liste servent `FILM_LIST_COLUMNS` (`lib/films.ts`) et non la ligne entière : 120 Ko
gzip pour les 13 rayons au lieu de 233. L'admin et le détail gardent la ligne complète.

Push : `web-push` + VAPID, table `push_subscriptions`, nettoyage auto des abonnements 410/404. La
notification « film terminé sur la TV » ouvre `/?castEnded={filmId}`, consommé en deep-link par `App.tsx`.

## Catalogue

### Rayons valides

12 rayons physiques + 1 virtuel. Source de vérité TS : `AisleType` dans `src/types/index.ts`.

`action` · `aventure` · `bizarre` · `classiques` · `comedie` · `drame` · `horreur` · `policier` ·
`romance` · `sf` · `thriller` · `animation`

`nouveautes` est **virtuel** : filtre sur `is_nouveaute = 1`, pas une étagère. Un film peut être dans
`action` ET `nouveautes`.

- Whitelist backend : `VALID_AISLES` dans `app/api/films/aisle/[aisle]/route.ts` (les 12 physiques)
- Ordre frontend : `AISLES_ORDER` dans `src/components/minitel/shared.ts` (12 + `nouveautes`)
- Le 3D consomme les 13 (`src/components/interior/Aisle.tsx`)
- Le schéma SQLite ne contraint pas (`aisle TEXT`) — validation applicative. Un test de cohérence
  (`tests/domain/consistency.test.mjs`) vérifie l'alignement des trois listes.

### Seed

`npm run seed` lit `src/data/mock/films.json` (`{ "action": [tmdb_id, ...], ... }`). Premier rayon
gagne en cas de doublon, `nouveautes` positionne `is_nouveaute`, 250 ms entre chaque appel TMDB. Ne
lance **pas** les téléchargements.

## Tests

Runner **natif Node** (`node --test`), pas de Jest/Vitest.

| Dossier | Contenu |
|---|---|
| `tests/architecture/` | Imports morts, budget de taille (≤ 1000 lignes, exceptions listées), assets référencés existants |
| `tests/domain/` | Audits figés en régressions (sécurité, performance, UX/compat) + cohérence des types |
| `tests/media/` | Pipeline : `identify-tracks`, `iso639`, `quality-control`, `video-plan`, `media-dir` (`.test.ts`, type-strip natif Node 22) |
| `tests/cache/` | LRU des textures VHS, cache TMDB, en-têtes HTTP |
| `tests/performance/` | Rejoue la logique de collision de `Controls.tsx` |

La plupart des tests `domain`/`architecture` sont de l'**analyse statique du code source** (regex et
assertions sur le texte des fichiers) — pattern « audit as test », pour empêcher le retour de
régressions constatées lors des audits.

## Variables d'environnement

| Variable | Usage |
|---|---|
| `DOMAIN` / `SUBDOMAIN` / `STORAGE_SUBDOMAIN` | Domaines Traefik |
| `TMDB_API_KEY` / `NEXT_PUBLIC_TMDB_API_KEY` | TMDB serveur / client |
| `HMAC_SECRET` | Signature des cookies |
| `API_SECRET` | Clé API pour tests automatisés (`x-api-key`) |
| `DATABASE_PATH` | Chemin SQLite (`/data/zone.db`) |
| `RADARR_URL` / `RADARR_API_KEY` | Instance Radarr unique |
| `RADARR_QUALITY_PROFILE_ID` / `_FR` | Profils MULTi / TrueFrench |
| `RADARR_ROOT_FOLDER` | Racine Radarr côté container |
| `MEDIA_LIBRARY_PATH` / `MEDIA_FILMS_PATH` / `MEDIA_BACKUP_PATH` / `SYMLINKS_PATH` | Chemins média |
| `DELETE_MKV_AFTER_BACKUP` | Suppression de la source après backup |
| `FORCED_RENTAL_VIDEO_URL` / `FORCED_RENTAL_FILE_PATH` | **Dev/staging** : sert la même vidéo pour toute location, VF **et** VO, sans sous-titres. Court-circuite les symlinks — donc rend la dispo VF/VO/ST intestable en local |
| `SPARK_SSH_HOST` / `_HOSTNAME` / `_PORT` / `_USER` | Accès à la machine d'encodage distante |
| `GPU_ENCODE_PRESET` / `GPU_ENCODE_CQ` / `GPU_MAX_WIDTH` / `GPU_MAX_HEIGHT` | Paramètres NVENC |
| `VIDEO_COPY_MAX_BITRATE` | Seuil copie vs réencodage (défaut 6000000) |
| `MUX_AUDIO_BITRATE` / `MUX_AUDIO_CHANNELS` | AAC de sortie (192k, 2) |
| `SUB_FORCED_MAX_CUES` / `OCR_TIMEOUT_MS` | Heuristique « piste forcée » / timeout OCR |
| `QC_REQUIRE_VF_AUDIO` / `_VO_AUDIO` / `_FR_SUBS` / `QC_MAX_ATTEMPTS` | Contrôle qualité |
| `IMPORT_STUCK_MINUTES` | Délai avant action sur import bloqué (⚠️ défaut code 5, `.env.example` dit 15) |
| `PROCESS_MAX_CONCURRENT` | Films traités en parallèle (défaut 1) |
| `PLAYLIST_START` | Date de mise en service de la chaîne 24/7 (`YYYY-MM-DD`) |
| `HLS_OUT_DIR` / `FILMS_ROOT` | Chaîne 24/7 |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_VOICE_CHANNEL_ID` / `STATUS_REFRESH_MS` | Bot Discord |
| `OPENROUTER_API_KEY` / `CHAT_MODEL` | Gérant LLM |
| `LANGFUSE_SECRET_KEY` / `_PUBLIC_KEY` / `_BASEURL` | Observabilité LLM |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `NEXT_PUBLIC_GOOGLE_CAST_APP_ID` | Receiver Cast (défaut : receiver média par défaut) |

## Conventions

### TypeScript
- Strict mode, types explicites pour les props
- `extend(THREE as any)` pour la compat R3F / WebGPU
- `baseUrl: "."` requis avec `paths` dans tsconfig
- `src/types/three-webgpu.d.ts` : déclarations custom pour `three/webgpu`, `three/tsl`, addons

### R3F
- `useFrame` pour les animations, `useRef` pour les objets Three.js
- `useMemo` pour géométries et textures (éviter la recréation)
- `React.memo` sur tous les composants Canvas
- Selectors Zustand **individuels** dans le Canvas, jamais le store complet
- Vector3 / Matrix4 / Frustum réutilisables déclarés **hors composant** (pas d'allocation par frame)

### Build
- `eslint: { ignoreDuringBuilds: true }` — dette de lint de l'ère Vite
- `serverExternalPackages: ['better-sqlite3', 'bcrypt']` — modules natifs
- Loader webpack pour `.wgsl` (asset/source)

## Règles obligatoires — travail 3D / graphique

### Avant de coder
1. **Étudier la référence visuelle en détail** — matériaux, textures, éclairage, proportions
2. **Découper en sous-tâches vérifiables visuellement**
3. **Chercher l'état de l'art** — ne jamais assumer
4. **Vérifier visuellement après chaque modification**
5. **Admettre quand on ne sait pas**, avec une alternative et un indice de confiance

### Interdictions
- JAMAIS de boîtes/formes simples par paresse au lieu de la bonne géométrie
- JAMAIS prétendre qu'une tâche est « complétée » sans vérification visuelle
- JAMAIS générer du code « plausible » sans réfléchir à l'objectif

## Leçons apprises

Ces entrées correspondent à du code encore en place. Si une leçon décrit une architecture disparue,
elle doit être supprimée, pas conservée « pour l'histoire ».

**Ciblage FPS** — les événements pointer R3F (`onPointerOver`, `onClick`) suivent la position souris
réelle, pas le centre de l'écran. En pointer lock il faut raycaster depuis `(0,0)` dans `useFrame` et
passer par le store.
```
INCORRECT: événements pointer R3F → position souris réelle
CORRECT:   useFrame → raycast depuis (0,0) → store Zustand → le composant lit le store
```

**Identification d'objets 3D répétés** — clé basée sur la position
(`{type-étagère}-{position}-{rangée}-{colonne}`) plutôt que sur l'ID de contenu. Stocker les deux
dans `userData`.

**Direction caméra aplatie** — dans `VHSCaseViewer`, `_cameraDir` est aplatie (Y=0) pour un
positionnement K7 horizontal stable. Toute lecture de `_cameraDir.y` **après** l'aplatissement donne 0.
Sauvegarder la direction **avant**.

**Atlas plutôt qu'array texture** — les `DataArrayTexture` déchirent horizontalement sur pilotes
Vulkan/NVIDIA et sur Metal iOS. L'atlas 2D de `CassetteTextureArray.ts` existe pour ça, ne pas
« simplifier » en revenant à une array texture.

**Boutons `disabled` = échec silencieux sur mobile** — `<button disabled>` avale le tap sans aucun
retour. Laisser le bouton actif, laisser le `onClick` décider et afficher une popup explicative.

**Dispo VF/VO = le fichier TRANSCODÉ, et ça ne se teste pas en dev** — la version réellement jouable
est `file_path_v{f,o}_transcoded` (c'est ce dont `streaming_urls` et les symlinks se servent), jamais
`file_path_v*` ni `radarr_v*_id` (colonnes mortes). La DB de dev n'a aucun transcode et
`FORCED_RENTAL_VIDEO_URL` force les deux versions : la validation VF/VO se fait **en prod** ou sur une
réponse d'API mockée.

**Historique de location : serveur, pas local** — `getUserRentalHistory` renvoyait déjà tout, mais
`store.fetchMe` ne câblait pas `rentalHistory` ; les writers locaux (`addToHistory`, `removeRental`)
n'avaient aucun caller. Résultat : liste vide en permanence, sans erreur nulle part. Un helper de store
sans caller n'est pas du code mort inoffensif, c'est une fonctionnalité silencieusement absente.

**Changer le type de retour d'une fonction `lib/` → grep les callers d'abord** — `getUserRentalHistory`
semblait n'en avoir qu'un (`/api/me`) ; `lib/chat.ts` était le second. D'où le retour en **superset**
(`SELECT r.*` + colonnes jointes) plutôt qu'une projection.

**Le `persist` zustand écrase les paramètres d'URL au rechargement** — `videoclub-storage` réhydrate
avant que le code ne lise la query string, donc un A/B piloté par URL compare deux fois la même valeur.
Vider la clé localStorage puis recharger, ou lire la valeur live, avant de conclure qu'un réglage
« ne fait rien ».

**Cache de build Next.js** — un `.next` corrompu provoque des `PageNotFoundError` fantômes sur des
routes API valides. Toujours `rm -rf .next` avant un build de vérification (c'est ce que fait
`npm run deploy`).

**Bump de `three` et cache de prod** — bumper la version dans `package.json` ne suffit pas si le
serveur a un `node_modules` en cache. Préférer le nom d'API long-vivant quand un rename n'a qu'un
alias de compatibilité.

**TAAU 0.75× sur mobile : rejeté** — le temporal upscaling casse les jaquettes de K7 sous le seuil de
lisibilité. Ne pas réessayer sous 0,85× tant que les K7 sont le contenu principal.

**Contention disque** — trois curseurs de lecture concurrents sur un disque mécanique saturé
plafonnent à 19 Mo/s. D'où la passe ffmpeg unique pour audio + sous-titres.

**Backups SSHFS concurrents** — 20 films d'affilée ont étranglé le lien : 40 s pour le premier,
7307 s pour le dernier. Les backups sont sérialisés, ne pas paralléliser.

**Process ffmpeg orphelins** — sur échec de l'encodage distant, les jobs latéraux doivent être tués
via `AbortSignal` (destruction du pipe → SIGTERM → SIGKILL après 5 s). Six tentatives sans ça = douze
ffmpeg vivants.

## Skills

- `threejs-webgpu-architect` — architecture Three.js/R3F, performance, photoréalisme, assets
- `webgpu-pure` — WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- `webgpu-canvas-text` — texte dans une scène WebGPU via `CanvasTexture` (Troika est incompatible WebGPU)
