# AGENTS.md — Zone Club

Guide de travail pour les agents sur ce dépôt. `CLAUDE.md` pointe ici.

## Projet

Vidéoclub en ligne complet : frontend 3D immersif (FPS dans un vidéoclub des années 90),
catalogue, acquisition et transcodage automatiques, diffusion, chaîne linéaire 24/7,
comptes / crédits / critiques, et un gérant LLM. Monolithe Next.js (API + frontend) plus
deux services Node autonomes.

## Stack

- **Framework** : Next.js 16 App Router + React 19.2, `output: 'standalone'` — build en `--webpack` (cf. `next.config.ts`)
- **3D** : Three.js 0.187 via React Three Fiber — WebGPU + TSL à l'intérieur, WebGL nu à l'extérieur
- **État** : Zustand 5 avec persistance localStorage
- **Styles** : Tailwind CSS v4 + CSS Modules
- **DB** : SQLite via `better-sqlite3` (server-side only), migrations idempotentes au boot
- **Auth** : cookies signés `cookie-signature` (pas de JWT) + CSRF par vérification d'origine (`proxy.ts`)
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
npm run build            # Build production standalone (--webpack : Turbopack sur-bundle, voir next.config.ts)
npm run deploy           # Cycle complet : down app → rm -rf .next → npm i → build → up app
npm run logs             # Logs suivis des 3 services applicatifs (app, cinema-stream, bot)
npm run seed             # Seed catalogue depuis src/data/mock/films.json
npm run refresh          # Rafraîchit les métadonnées TMDB
npm run report           # Rapport de collection
npm run media:check      # Contrôle des fichiers des films disponibles : rapport seul, code 1 s'il y a des anomalies
                         # (-- --film <id> : un film ; -- --mark : marque les versions défectueuses). Sur la machine des fichiers
npm run migrate          # Migration media reset (--keep pour conserver)
npm run configure:radarr # Configuration Radarr déclarative et idempotente (--dry)
npm run test:phase       # Garde-fous (node --test) — test:phase:full = lint + tests + build
npm run audit:unused     # Assets/scripts orphelins (:strict = exit non-zéro)
npm run transcode:progress   # watch SQL sur les films en cours de traitement

npm run cinema:up|down|restart|rebuild|logs   # chaîne HLS 24/7
npm run bot:up|down|restart|rebuild|logs      # bot Discord
npm run loopback:start|stop|status            # renvoie l'audio de la chaîne vers la sortie locale
```

**Deploy** : le container `app` monte le dossier du projet et sert le build standalone —
on build depuis la machine hôte (bien plus rapide que dans le container).

**Logs** : `npm run logs` suit les trois services **applicatifs** — `app`, `cinema-stream`,
`zone-discord-bot` — nommés en dur. `radarr`, `storage` et `transmission` sont de
l'infrastructure tierce et bavarde : on les regarde à la demande, service par service. Liste
explicite et non calculée, donc **un nouveau service applicatif doit être ajouté ici à la main**.

Un service arrêté reste inclus, et c'est voulu : ses dernières lignes expliquent souvent
pourquoi il ne tourne plus. `docker compose logs` ne démarre rien (vérifié : le `StartedAt`
d'un container arrêté ne bouge pas).

## Arborescence

```
app/
├── page.tsx                 # Dynamic import de src/App (ssr: false)
├── layout.tsx               # Root layout — précharge les seules images de la devanture (l'intérieur attend qu'elle soit affichée)
└── api/                     # 47 routes App Router (table complète plus bas)
proxy.ts                     # CSRF Origin/Referer sur /api/* non-GET, bypass x-api-key (ex-middleware.ts)
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
├── cast-sessions.ts cast-session-store.ts cast-completion.ts cast-session-checker.ts   # séances de Cast suivies par le serveur
├── cleanup.ts push.ts tmdb.ts

src/
├── App.tsx                  # Vrai point d'entrée : trois scènes (devanture, vidéoclub, borne), lazy loading, prefetch catalogue, PWA
├── api/index.ts             # Client API frontend
├── data/storefront-mobile.json  # Mise en page de la devanture mobile — FABRIQUÉE, ne pas retoucher à la main
├── store/index.ts + slices/ # Zustand (manager.ts, tutorial.ts, cast.ts externalisés)
├── cast/                    # Le Cast, sans React : cast-machine.ts (la machine, pure), cast-service.ts (le seul
│                            # endroit qui touche au SDK de Google), cast-sdk.ts (ses types, le chargement du script),
│                            # cast-wire.ts (le fil vers la TV, pur), cast-labels.ts (les mots des panneaux)
├── components/
│   ├── exterior/            # Devanture : ExteriorView (bureau animé / image fixe sur mobile), le film
│   │                        # d'approche de la borne (useApproachFilm.ts), storefront-layout.ts (géométrie
│   │                        # des deux devantures, pure et testée)
│   ├── exterior/scene/      # ExteriorScene.ts — WebGL pur, shader vitrine, pluie, phares
│   ├── kiosk/               # Borne de location — DOM pur, aucun rendu 3D (voir section dédiée)
│   ├── interior/            # Scène WebGPU : Aisle, CassetteInstances, Controls, Lighting,
│   │                        # PostProcessingEffects, MinitelScreen, InteractiveTVDisplay,
│   │                        # LaZoneCRT, VHSCaseViewer, BenchmarkMode
│   ├── minitel/             # Overlay Minitel 1982 (catalogue, recherche, commande)
│   ├── terminal/            # TVTerminal — compte + admin
│   ├── player/              # VHSPlayer, panneaux du Cast (CastPanels, CastNotices, ActiveCastIndicator) / AirPlay
│   ├── manager/             # Chat du gérant + composants Generative UI
│   ├── videoclub/ tutorial/ mobile/ ui/ board/ auth/ review/ search/
├── hooks/                   # useKTX2Textures, useBackGuard, useIsMobile…
├── utils/                   # CassetteTextureArray (atlas), VHSCoverGenerator, interior-preload-gate
│                            # (vanne des préchargements 3D), account-rules (règles d'un compte)…

cinema-stream/               # Service Node autonome — chaîne HLS 24/7
zone-discord-bot/            # Service Node autonome — présence Discord
scripts/                     # seed, migrate, configure-radarr, cinema-cam*, entrypoint…
tools/devanture-borne/       # Fabrique des images de la devanture mobile (Python + Blender) — voir « Extérieur »
tests/                       # node --test — architecture, domain, cache, media, performance, helpers (faux SDK du Cast)
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
| `POST` | `/api/auth/logout` | session | Logout — clôt d'abord les séances de Cast ouvertes du visiteur |
| `GET` | `/api/me` | session | Profil — complète d'abord les séances de Cast échues |
| `GET` | `/api/me/notifications` | session | Notifications retour |
| `GET / POST` | `/api/me/weekly-bonus` | session | Statut + claim bonus hebdo |
| `GET` | `/api/films` | publique | Liste films |
| `GET` | `/api/films/[tmdbId]` | mixte | Détail + statut de location + `has_vf`/`has_vo` |
| `GET` | `/api/films/[tmdbId]/extras` | publique | Fiche détaillée de la borne : accroche, public, sortie, pays, équipe, note (TMDB, cache 30 j) |
| `GET` | `/api/films/[tmdbId]/related` | publique | « À voir aussi » : films de nos rayons (même réalisateur, acteurs en commun) |
| `GET` | `/api/films/[tmdbId]/trailer/status` · `/trailer` | publique | Bande-annonce sans publicité : état (lance sa récupération) · fichier MP4 (plages d'octets) |
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
| `POST` | `/api/playback-failures` | session | Trace d'une lecture en échec : film, version, lieu, genre d'échec, position (corps de 1 024 octets au plus, 30 par quart d'heure ; jamais l'adresse de diffusion). 204 sans corps |
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
| `POST` | `/api/perf` | publique | Mesure de terrain d'une entrée dans la boutique (anonyme, `sendBeacon`) |
| `GET` | `/api/admin/perf` | admin | Mesures agrégées par appareil et par build (`?days=`, `?recent=`, `?automated=1`) |
| `GET` | `/api/admin/playback-failures` | admin | Lectures en échec par film, piste audio et lieu, puis les 50 dernières traces, sans le visiteur (`?days=`, 30 par défaut, 1 à 365) → `{ days, groups, recent }` ; 403 hors admin |

Il n'y a **pas** de `DELETE /api/rentals/[filmId]` (utiliser `POST /return`), ni de
`DELETE /api/reviews/[filmId]` (`PUT` à la place), ni de `DELETE /api/requests`.

## Base de données

Tables : `users`, `films`, `genres`, `film_genres`, `rentals`, `reviews`, `film_requests`,
`weekly_bonuses`, `return_requests`, `user_facts`, `board_notes`, `film_processing_runs`,
`push_subscriptions`, `cast_sessions`, `client_perf_runs`, `playback_failures`.

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
| `vf_unplayable` / `vo_unplayable` | 1 = version marquée illisible par `npm run media:check -- --mark` (fichier absent, illisible, sans piste, fin indécodable, sous 90 % de la durée TMDB) : elle compte comme **absente partout** — `has_vf` / `has_vo` de la fiche, adresses de la location, téléchargement. Les liens d'une location couvrent tous les fichiers transcodés : le drapeau, relu à chaque lecture, masque l'adresse — une version démarquée pendant une location se lance aussitôt. Sans version jouable, la location est refusée (aucun crédit dépensé), et la borne le dit avant même la connexion. Chaque « fin indécodable » du rapport porte sa raison (rien décodé, délai dépassé, ou la première ligne d'erreur de ffmpeg) : à lire avant `--mark`. Le script ne touche ni `is_available` ni `duration_sec`. Un fichier refait par le pipeline garde son drapeau : relancer `--mark`, qui le retire d'une version redevenue saine. La prévisualisation `/admin` ignore les drapeaux |
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
Desktop uniquement. L'image (`public/storefront.jpeg`, 2102 × 1117) et son masque
(`public/storefront-mask.png`, 2891 × 1536) sont **fabriqués** : la photo d'origine élargie de mur à
gauche, la **borne de location** rendue sous Blender à 16 cm de la porte, et un masque qui glisse
comme la photo, où la borne entre en aplats (vitres en vert, carrosserie en bleu ; son néon n'a pas
de rouge, il ne vacille pas). Validée par Rusmir le 18/11/2026. Le **format de l'image** vient de la
mise en page `src/data/storefront-desktop.json` (5782 × 3072), jamais d'une constante : la scène le
reçoit à sa construction, la vue en tire la boîte de l'image dans la fenêtre (`fitBox`). La borne
entière et la porte entière se cliquent (zones placées en pourcentages de cette boîte) ; indicateurs
« BORNE LOCATION ▼ » au-dessus de l'écran de la borne et « PUSH ▼ » au-dessus de la plaque.
`ExteriorScene.pause()` / `resume()` arrêtent la boucle pendant le film d'approche.

**Devanture mobile** (et repli du bureau sans WebGL) — une **image fabriquée**, vue reculée : la
photo d'origine de la porte, un mur reconstitué à sa gauche, le toit, un ciel de pluie, et la
**borne de location** rendue sous Blender puis raccordée à la photo (validée par Rusmir le
18/11/2026).

- **Fabrication** : `sh tools/devanture-borne/fabrique.sh` refait **les deux devantures** d'une
  commande (variantes « mobile » et « bureau » : fond, textures, parcours du néon, rendus Cycles,
  composition, masque du bureau, **films d'approche**) et écrit dans `public/` les images, le
  masque et les deux films, et dans `src/data/` les **mises en page** `storefront-mobile.json` et
  `storefront-desktop.json`. Prérequis (Blender 5.3, ffmpeg) et rôle de chaque script :
  `tools/devanture-borne/README.md`. Ne jamais retoucher ces sorties à la main : modifier la
  géométrie de la variante (`geometrie.json`, `geometrie-bureau.json`) ou les scripts, puis relancer.
- **Mise en page** : où sont la borne, son écran, la porte et la plaque « PUSH » dans l'image, en
  fractions (0 à 1), **projetées par la caméra de la scène Blender** ; et le film d'approche
  (`approche` : fichier, taille, durée, et où est l'écran de la borne dans sa **dernière** image).
  C'est la seule source des positions côté site.
- **La scène** (`ExteriorView`, `.mobileStage`) : un bloc aux proportions de l'image, posé en
  « cover » et cadré sur l'ensemble borne + porte par `stageBox` (`storefront-layout.ts`, fonctions
  pures testées sur cinq fenêtres). L'image, les zones d'appui (la borne entière, la porte entière)
  et l'indicateur PUSH en sont des **enfants placés en pourcentages de la scène** — plus aucune
  position en pourcentages de la fenêtre, qui ne tombait sur l'objet que pour un seul format
  d'écran.
- **La barre des deux boutons** (« BORNE 24/7 », « PORTE VIDÉOCLUB ») est une bande opaque **sous
  l'image**, pas posée dessus : la scène lui réserve sa hauteur (`stageBox(…, reserve)`) et
  **remonte sans rétrécir** — c'est le ciel qui cède la place (Rusmir, 18/11/2026). Chaque bouton
  est sous son objet et **à sa largeur** (`choiceSpans`) ; ses tailles intérieures suivent sa
  largeur (`cqw`). La hauteur de la barre est dans la feuille de style et dans `ExteriorView.tsx`
  (`CHOICES_BAR_HEIGHT`, un test les tient égales) ; l'encoche du bas s'y ajoute, relue sur la barre.
- **Le film d'approche de la borne** (mobile **et** bureau ; il remplace le zoom de la première
  livraison — Rusmir, 18/11/2026 : « un zoom qui n'en est pas un vrai ») : un film de 3 s, 91
  images, rendu par la fabrique, où l'appareil **avance pour de bon** de la devanture jusqu'à
  l'écran de la borne (la borne est recalculée par Blender à chaque image ; le mur de la photo, un
  plan, se recale exactement ; sur mobile le ciel, à l'infini, ne grossit pas). Sa première image
  est l'image fixe de la devanture. `public/storefront-borne-approche.mp4` (1920 × 1020) pour le
  bureau ; pour le mobile **deux films du même trajet** — `storefront-mobile-borne-approche-hd.mp4`
  (1080 × 1936) et `storefront-mobile-borne-approche.mp4` (720 × 1290, léger) —, la devanture
  prenant la haute définition quand l'écran en tire parti (`pickApproachFilm` : largeur de la scène
  en points d'écran réels) et le film léger sinon, ou si le visiteur économise ses données (Rusmir,
  18/11/2026). H.264 muet ; hauteur **paire** obligatoire (1935 était refusé par l'encodeur).
  - `useApproachFilm` télécharge le film **une fois la devanture affichée** et le joue depuis la
    mémoire. Au choix de la borne : `onKioskIntent` d'abord (GPU et chargements du vidéoclub libérés
    **avant** l'animation), puis le film se fond sur la devanture dès sa première image réellement
    affichée ; pendant qu'il joue, la scène glisse (`approachTransform`) pour que l'écran filmé de
    la dernière image tombe sur l'écran de l'interface (`kioskScreenBox` sur téléphone,
    `kioskScreenBoxDesktop` sur bureau — formules de `KioskView.module.css`, tenues par des tests ;
    sur PC le corps de la borne est collé à **gauche** de la fenêtre).
  - **La borne ne se fait jamais attendre** : film pas encore téléchargé, animations réduites,
    lecture refusée, erreur, première image qui ne vient pas → `onOpenKiosk` tout de suite. Les
    minuteurs de garde vivent dans le crochet, armés à la lecture, jamais à l'appui.
  - Un clic pendant le film mène à l'arrivée, mais pas dans sa première demi-seconde : un double
    clic ne l'escamote pas.
  - **La borne apparaît en fondu sur la devanture** (`App.tsx`, `kiosk-reveal`, 280 ms) : la
    devanture reste montée dessous le temps du fondu, figée sur la dernière image du film. Jamais
    d'écran noir.
  - ⚠️ **Le Chromium de Playwright ne lit pas le H.264** : toute vérification du film passe par le
    vrai Chrome (`chromium.launch({ channel: 'chrome' })`).
  - ⚠️ **Le film doit porter son étiquette de transfert sRGB** (`color_trc=iec61966-2-1`, écrite
    par le filtre `setparams` : les options `-color_primaries` / `-color_trc` de ffmpeg 8
    n'arrivent pas dans le fichier). Sans elle, Chrome sur Mac (décodage matériel) l'affichait plus
    clair que l'image fixe : +2 à +6 niveaux par canal, un éclaircissement visible au lancement.
    Étiqueté, il s'affiche comme elle (écart 0,4). `fabrique.sh` relit les étiquettes par `ffprobe`
    et s'arrête si elles manquent.
  - Chaque retour de la borne monte une devanture **neuve** (`key={exteriorVisit}` dans `App.tsx`) :
    « Quitter » cliqué pendant le fondu d'apparition retrouvait sinon la devanture restée dessous,
    figée sur la dernière image du film, où plus rien ne répondait.
  - Le conteneur de la devanture est en `overflow: clip` : en `hidden`, un bouton hors champ qui
    prenait le focus (la zone de la borne, fenêtre en paysage) faisait défiler la devanture.
- Ces images sont servies en `network-only` par le service worker (elles ne sont ni sous
  `/models`, `/textures`, `/basis`, ni d'une extension mise en cache) : les changer ne demande pas
  de bumper `VERSION`.

**Intérieur** — WebGPU (`THREE.WebGPURenderer` + R3F + TSL). **Pas de repli WebGL.** Sans
`navigator.gpu` le site reste ouvert : la devanture s'affiche (image fixe au besoin), la porte
explique pourquoi le vidéoclub 3D ne peut pas s'ouvrir et renvoie vers la **borne de location**,
qui loue et lit les films sans aucun rendu 3D. Ni le chunk 3D, ni ses assets, ni le service worker
ne sont alors envoyés (`src/utils/interior-preload-gate.ts`).

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

`src/store/index.ts` (monolithe, ~1100 lignes) + 3 slices externalisées (`slices/manager.ts`,
`slices/tutorial.ts`, `slices/cast.ts`). Persist `videoclub-storage` avec `partialize` restreint
(`localUser`, `rentalHistory`, flags d'onboarding, scène courante, `lastCastFilmId`) — **pas l'auth**,
gérée par cookie, et **jamais l'état du Cast** (`cast` porte l'adresse du film et des drapeaux passagers).

`rentalHistory` est **alimenté par le serveur** (`fetchMe` → `/api/me`) et contient **toutes** les
locations, actives comprises : ne pas l'additionner à `rentals.length` pour obtenir un total. La copie
persistée n'est qu'un cache d'affichage en attendant la réponse de `fetchMe` ; `logout()` la vide, comme
`lastCastFilmId` (sinon le visiteur suivant sur le même appareil recevrait « Location terminée » pour un film qu'il
n'a pas loué).

**`fetchMe` et `refreshRentals`** lisent tous deux `/api/me` (l'historique par une seule fonction, `historyFromApi`).
`fetchMe` pose « non connecté » sur **tout** échec, panne réseau comprise. Le Cast ne l'appelle donc jamais : ses
ports passent par `refreshRentals`, qui n'écrit `rentals` et l'historique qu'en cas de succès, ne touche à rien et
rejette sur une panne, laisse `fetchMe` constater un vrai 401, et n'écrit pas la réponse d'un compte qui a changé
pendant l'appel (décision : `rentalsRefreshOutcome`, `src/utils/rentals-refresh.ts`). Avant, une panne réseau à la
clôture d'une séance faisait demander à la borne de se reconnecter, cookie valide.

`InteractionMode` : `'none' | 'sitting' | 'minitel' | 'tvStanding' | 'lazoneStanding' |
'lazoneWatching' | 'film'`. Remplace 6 setters mutex codés à la main qui avaient dérivé ; les
booléens `isXxx` subsistent comme vues dérivées pour les ~50 sites de lecture existants.

**Cast et lecteur** — la tranche `slices/cast.ts` porte `cast` (l'état de la machine du Cast) et ses actions ;
`lastCastFilmId` est le film dont le Cast court peut-être encore, pour la page rechargée (persisté, écrit par le
service). Les composants lisent `cast` (`castView`, `castOwnsFilm`, `castPending`) ; aucun ne l'écrit. L'ancien champ
dérivé `activeCastFilmId` a été retiré le 19/11/2026 : plus personne ne le lisait. `openPlayer(filmId, { from?:
'kiosk' | 'store', ask?: boolean })` dit d'où le visiteur vient (`playerFrom`, défaut `'store'` : le libellé du
retour du lecteur et de la télécommande) et si l'invite « Regarder sur TV ? » doit être posée (`playerAsk`, défaut
`true`, mobile seulement). `closePlayer()` ne touche ni à `playerFrom` ni à la TV : il prévient seulement la tranche
(`castPlayerClosed`), qui retire le message du Cast que montrait ce lecteur et la reprise qu'il n'a pas prise —
« Location terminée » excepté. Détail dans « Player + Cast ».

Store exposé sur `window.__store` hors production (debug / Playwright).

### Player + Cast — un service, une machine à états

Le Cast ne vit plus dans le lecteur (refonte du 18/11/2026, document de conception
`docs/superpowers/specs/2026-11-18-cast-refonte-design.md`, à lire avant d'y toucher). Avant elle, cinq effets
React et deux gestionnaires du lecteur écrivaient le même état du Cast et se contredisaient : le Cast démarrait,
puis cassait dès qu'on fermait et rouvrait le lecteur, et le visiteur n'avait d'autre issue que de recharger la
page. Chaque pièce a maintenant un seul rôle :

| Pièce | Rôle |
|---|---|
| `src/cast/cast-machine.ts` | **La machine, pure** : `castReduce(state, event) → { state, effects }` décide de tout. Aucun import de valeur. |
| `src/cast/cast-service.ts` (+ `cast-sdk.ts`) | **La seule partie impure**, une instance pour toute la page : charge et initialise le SDK de Google, traduit ses rappels en événements, exécute les effets. `cast-sdk.ts` : les types du SDK et le chargement de son script. |
| `src/cast/cast-wire.ts`, `src/cast/cast-labels.ts` | Du pur, testé sans SDK : le fil (ce qu'on envoie à la TV, ce qu'on comprend d'un statut — `cast-wire.ts` n'importe aucune valeur) et les mots des panneaux. |
| `src/store/slices/cast.ts` | **Le seul appelant du service.** Publie l'état (`cast`), branche l'API et le store sur les « ports » du service (séance serveur, relecture de la location par `refreshRentals` — jamais `fetchMe` —, film mémorisé), traduit les gestes du visiteur et du store en événements : `startCast`, `castFilm`, `castToggle`, `castSeekBy`, `castVolume`, `castStop`, `castToPhone`, `castRetry`, `castCancel`, `castDismiss`, `castSubtitle`, `takeCastResume`, `castLoggedOut`, `castPlayerClosed`, `castRentalGone`. |
| `VHSPlayer.tsx`, `CastPanels.tsx`, `CastNotices.tsx`, `ActiveCastIndicator.tsx`, `kiosk/KioskCastBar.tsx` | **Les écrans** : ils lisent `cast` et demandent par ces actions ; aucun n'écrit l'état du Cast. |

`PlayerState` (`src/types/index.ts`) ne connaît plus le Cast : `'playing' | 'paused' | 'seeking' | 'rewinding' |
'fastforwarding'`. Le hook `useGoogleCast` a été supprimé, avec `awaitingCast`, `casting`, le délai de 6 s,
`wasCastConnectedRef`, `lastKnownCastTimeRef`, `endCast()` et le drapeau `castOnOpen` : ne pas les réintroduire (des
gardes de `tests/domain/cast-player.test.mjs` et `cast-store.test.mjs` le vérifient).

**Pistes : une seule décision de version** (spec `docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md`,
§ 4.1, 4.3 b et 4.4). Le lecteur n'a plus de piste à lui : `usePlayerVersion(filmId, streamingUrls)` lui rend la
version jouée — un couple `{ audio: 'vf' | 'vo', subtitle: 'off' | 'fr' | 'en' }` (`VersionChoice`) —, décidée par
`decideVersion` (`src/utils/version-choice.ts`, via `versionDecisionFor` de `slices/version.ts`) comme pour la borne et
le Cast : le choix fait pour ce film, sinon la version préférée du compte, sinon le défaut (VF si elle existe, sinon
VOSTFR, sinon VO + sous-titres anglais, sinon VO). Les quatre pistes peuvent manquer indépendamment ; une version
demandée que le film n'a pas est remplacée **et l'écran le dit** : la note (« VOSTFR · VF indisponible pour ce film »)
s'écrit dans les lignes sous l'en-tête (`VersionNoteLine`). Un seul bouton « Version » (`VHSControls`, le nom de la
version qui joue) ouvre la liste partagée (`VersionList`, dans `PlayerVersionPanel`, classes de sa propre feuille) ; une
version absente y est une ligne de texte avec sa raison, jamais un bouton grisé. Les touches `V` (l'autre piste audio,
`nextAudio`) et `T` (sans sous-titres → français → anglais, `nextSubtitle`) restent. Un choix dans la liste, `V`, `T` et
« Essayer en … » du panneau d'échec écrivent le **choix de ce film** (`chooseFilmVersion`) : la version préférée, que
seul « Mon compte » règle, n'est jamais touchée par le lecteur. **La question des sous-titres** (décision `ask` : version
préférée VOSTFR, film sans sous-titres français mais avec la VF) : la borne la pose avant d'ouvrir le lecteur, le
vidéoclub non — le lecteur la pose donc lui-même quand la vidéo joue ici, par-dessus elle, **vidéo en pause derrière** :
la lecture automatique est désarmée (`localAutoPlay` reçoit `question`) et toute lecture qui partirait quand même — une
reprise du Cast, une touche média — est arrêtée aussitôt dans `onPlay` (`playHeldHere`, `src/utils/cast-on-open.ts` : TV
aux commandes, panneau d'échec ou question). Elle passe avant l'invite « Regarder sur TV ? ». La réponse devient le choix
de ce film et lance la lecture : autre piste, le nouvel élément part de lui-même ; même piste, le lecteur appelle `play()`
si rien d'autre ne retient la vidéo. Elle n'est pas reposée à la réouverture. Sous les deux réponses, une troisième
ligne plus discrète, **« Retour »** (décision de Rusmir du 20/11/2026), ferme le lecteur sans rien lancer ni retenir ;
Échap fait de même. Sous la liste, Échap et le geste retour la referment.

**La vidéo remontée garde sa fin et sa position.** L'élément `<video>` est remonté à chaque autre piste audio et à chaque
« Réessayer » : sa `key` vaut `${version?.audio}-${videoUrl}-${attempt}`. Tout ce qui l'écoute suit cette key — dans
`useVideoLifecycle`, deux effets qui dépendent tous deux de `videoKey` (un test le vérifie) : la **fin du film** (`ended` →
« BE KIND REWIND » ou la fermeture) et la **place de l'élément**, prise une seule fois, à l'ouverture comme après un
remontage : au `loadedmetadata` du nouvel élément (ou tout de suite s'il les a déjà), un élément encore sous 1 s part de
la seconde transmise par l'élément remplacé (0 à l'ouverture) ou de la position de la location. Jamais au `canplay` :
entre les métadonnées et la première lecture possible, la durée est connue et quitter le lecteur enregistrait la
position 0 ; et une sauvegarde ne réarme rien (après ⏮, le film n'est plus ramené à l'ancienne position). Le crochet reçoit la position enregistrée de la location telle
quelle et lit la durée sur l'élément ; il ne décide rien : **une seule règle pure, `src/utils/video-swap.ts`**, sert la
reprise à l'ouverture, le remontage et le départ sur la télé — depuis le lecteur (`startAt` de « Regarder sur TV »,
calculé sur la durée de sa vidéo) comme depuis la borne (« Sur ma télé » n'envoie pas de départ : `castStartAt` de
`src/cast/cast-wire.ts` applique la même règle). **Trois écarts restent** : (1) sur le chemin de la borne, le client ne
connaît pas la durée du fichier (il n'a que la durée TMDB, `runtime`, qui n'est pas celle du fichier : fichiers
tronqués, versions longues), donc une position enregistrée dans les 10 dernières secondes y part telle quelle sur la
télé, alors que le téléphone repart du début ; (2) « Regarder sur TV » touché avant que la vidéo d'ici ait ses
métadonnées (`sendToTv`) : durée inconnue, même conséquence ; (3) la reprise venue de la télé (`takeCastResume`) place la
vidéo d'ici à la position de la télé, ou à défaut à celle de la location, sans cette règle. Ailleurs, téléphone et télé
partent de la même seconde.
`swapResumeTime` : la plus grande des deux positions, celle de l'élément remplacé (0 à
l'ouverture) et celle de la location (un changement fait avant la première image ne repart pas de zéro) ; **une position
enregistrée dans les 10 dernières secondes du fichier vaut le début** (`RESUME_END_MARGIN_S`), sinon elle est reprise
quel que soit le pourcentage — la progression ne redescend jamais, et un film fini puis revu jusqu'à 200 s reprend à
200 s ; durée inconnue (pas encore de métadonnées) : la position est reprise. `resumeSeek` : ne déplace jamais un
élément qui a déjà sa position (1 s ou plus). `leavingTime` : un élément remplacé avant d'avoir repris sa position la
transmet au suivant. Avant, l'écouteur de fin et la reprise restaient sur l'ancien élément : plus de « BE KIND REWIND »
après un changement de version, et un changement avant la première image repartait de zéro.

Côté `<video>`, une seule `<track>` est montée à la fois, avec une `key` par langue : swapper le `src` d'une `<track>`
déjà montée ne rafraîchit pas la textTrack, et l'attribut `default` d'une `<track>` insérée après le parse n'est pas
honoré de façon fiable — d'où l'effet qui force `track.mode` explicitement (`addtrack` inclus, la piste pouvant arriver
après le rendu).

**Une version qui ne se lance pas** (`src/utils/playback-failure.ts`, `PlaybackFailurePanel.tsx`). Le lecteur
annonce « Cette version ne se lance pas » sur une erreur de la vidéo (écouteur `error` en phase de capture : celles du
`<source>` comptent) ou après 15 s sans métadonnées (`PLAYBACK_START_TIMEOUT_MS`) — **armé seulement quand la lecture est
voulue** (`startTimerArmed` : jamais sous l'invite « Regarder sur TV ? », pendant un Cast ni sous « BE KIND REWIND »).
Trois sorties, aucun `<button disabled>` : « Essayer en {nom} » (l'autre piste, à la même position ; absent sans autre
piste — elle devient le choix de ce film : rouvert, il part dans cette version), « Réessayer » (remonte le `<video>`),
« Retour ». Le panneau retient la vidéo, et rien de tout cela ne touche la version préférée du compte. **Une trace par échec affiché** (pas par essai) part par `POST /api/playback-failures` dans
`playback_failures` : film, piste, sous-titres, lieu, genre, position, navigateur — **jamais l'adresse du fichier**, secret
de la location (pas de colonne pour, six champs nommés côté client, rien pour une prévisualisation /admin). `/admin` la
montre dans « Lectures en échec » : une ligne par film, version (« VF » ou « VO ») et lieu (« appareil » ou « télé »), avec le
nombre d'échecs et la date du dernier ; le visiteur n'y figure jamais (`withoutVisitor`). Seul le lecteur d'appareil
envoie des traces pour l'instant ; la route accepte déjà le lieu `tv` et le genre `tv_load`.

**Sous-titres en Cast** — les `<track>` du `<video>` local ne traversent pas le réseau. Les WebVTT
sont donc **side-loadés** dans le `MediaInfo` (`mediaInfo.tracks`, `text/vtt`, IDs stables fr=1/en=2)
et la langue active part dans `request.activeTrackIds`. Pendant le cast, un changement de piste passe
par l'action `castSubtitle` → `setCastSubtitle` du service (`editTracksInfo` sur la séance média, avec accusé
ou délai) sans recharger le film (boutons STFR/STEN de la télécommande + touche `T`, qui changent aussi la version
de ce film, même piste audio) ; « Regarder sur TV » envoie la version que joue le lecteur
(`castFilm(filmId, { version, startAt })`). Changer de piste audio pendant un Cast n'existe pas encore ; la séance média
vivant dans le service, la bascule marche aussi après fermeture et réouverture du lecteur.
`buildCastSubtitleTracks()` (`src/utils/cast-subtitles.ts`) n'accepte que les URLs
absolues : un chemin `/seed-media/...` n'est pas joignable par le Chromecast, et déclarer des tracks
impose le CORS sur le MP4 comme sur le VTT (le storage envoie `Access-Control-Allow-Origin: *` sur
les deux). Le receiver par défaut ne gère que les pistes **texte**, une seule active à la fois. AirPlay
n'est pas couvert : `webkitShowPlaybackTargetPicker` envoie l'URL seule.

**Le service : une initialisation, un seul `setOptions`.** `startCast()` est idempotent et demandé de partout où le
Cast peut servir : à l'entrée dans le vidéoclub ou dans la borne (`App.tsx`), à l'ouverture du panneau de la borne
(`KioskReady`), par les gestes de la tranche qui s'adressent à la TV (`castFilm`, `castToggle`, `castStop`… jusqu'à
`castRentalGone`) et par le lecteur à son montage (filet pour `/admin`, où il est monté hors de `App`). Les autres
ne le démarrent pas : `castSubtitle`, `takeCastResume`, `castLoggedOut` et `castPlayerClosed` n'ont rien à dire à un
service qui ne tourne pas encore. La première demande lance `initCast` : il charge le SDK, appelle `context.setOptions(`
**une seule fois**, crée **un** `RemotePlayer` et **un** `RemotePlayerController`, pose ses écouteurs pour toute la vie
de la page. Il n'y a qu'**un** `setOptions(` dans tout `src/` (dans `cast-service.ts`), et
`tests/domain/cast-service-wiring.test.mjs` les compte. **Pourquoi** : un second appel coupe sans bruit le canal des
commandes sur Chrome Android, alors que le SDK continue de dire « connecté » et que le temps estimé avance — la TV
n'obéit plus et rien ne le dit (l'ancien hook le rappelait à chaque ouverture du lecteur). Le service vit autant que
la page : lecteur fermé, la TV reste suivie et le serveur informé. Le sélecteur d'appareils exige l'activation de
l'appui : `castFilm` s'appelle **directement** dans le gestionnaire, sans `await` ni promesse avant, et le service
appelle `requestSession` dans la pile même de l'appui (un test le garde). SDK pas encore chargé : il l'attend, et si
l'activation est perdue le visiteur a « Réessayer ».

**La machine** (`cast-machine.ts`). Phases (`CastPhase`) : `idle` (repos) · `choosing` (sélecteur ouvert : **aucun
délai**, le visiteur y prend le temps qu'il veut) · `connecting` et `loading` (20 s chacune, `CAST_CONNECT_TIMEOUT_MS`
et `CAST_LOAD_TIMEOUT_MS`) · `remote` (la TV joue : la télécommande) · `ended` (la TV a fini le film) · `lost` (la TV
ne répond plus). Autres délais, exportés par la machine : `CAST_ACK_TIMEOUT_MS` (accusé d'une commande, 5 s),
`CAST_STATUS_TIMEOUT_MS` (réponse à une demande de statut, 5 s), `CAST_REPORT_EVERY_MS` (surveillance de la TV et envoi
de la position au serveur, 10 s). **Qui envoie, qui exécute** : le service envoie les événements qui viennent du SDK,
de la TV et du serveur (`SDK_READY` — avec l'appareil d'une séance reprise avant lui —, `SESSION_STARTED`,
`MEDIA_STATUS`, `NO_MEDIA`, `STATUS_FAILED`, `TICK`, `PAGE_VISIBLE`, `RENTAL_STATE`, `RENTAL_UNREAD`…) ; la tranche
envoie ceux qui viennent du visiteur et du store (`REQUEST_CAST`, `COMMAND`, `USER_STOP`, `USER_TO_PHONE`,
`USER_CANCEL`, `USER_RETRY`, `USER_DISMISS`, `RESUME_TAKEN`, `RENTAL_GONE`, `PLAYER_CLOSED`) ; la machine rend des
**effets** (`OPEN_PICKER`, `LOAD_MEDIA`, `REQUEST_STATUS`, `SEND_COMMAND`, `STOP_AND_END_SESSION`, `SERVER_OPEN` /
`SERVER_REPORT` / `SERVER_CLOSE`, `READ_RENTAL`, `REMEMBER_FILM`, minuteurs) que **seul le service exécute** :
`runEffect` finit par une branche `never`, un effet ajouté sans son cas ne compile pas.
`sendCast` met les événements en file : tous les effets d'un pas s'exécutent, dans l'ordre, sur l'état qui les a
produits. Un cas nouveau est une transition de plus dans `castReduce` (et sa ligne dans
`tests/domain/cast-machine.test.mjs`), jamais un effet React qui écrit l'état.

**Ce que le lecteur lit** : `castView(state, filmId)` — `local` · `choosing` · `connecting` · `loading` · `remote` ·
`ended` · `lost` · `other-on-tv` (la TV est prise, ou en passe de l'être, par un AUTRE film). `castOwnsFilm(state)`
donne le film que la TV signale lecteur fermé (`remote`, `lost` ou `ended`). `castPending(state, filmId,
lastCastFilmId)` dit que la machine attend encore la TV ou le serveur pour le film mémorisé d'une page rechargée (SDK
pas prêt, statut demandé, location en relecture) : `castView` dit alors `local`, mais la TV joue peut-être ce film.
Le lecteur s'abonne à des valeurs simples (la vue de ce film, le message, la reprise, l'attente) : la position, qui
avance chaque seconde, ne le redessine pas.

Règles que suit le lecteur (`VHSPlayer.tsx` lit la vue et envoie des intentions, il ne décide de rien) :

- **La vidéo locale ne part jamais d'elle-même quand la TV est en jeu ou qu'une question attend.** Une seule règle,
  pure et testée : `localAutoPlay` (`src/utils/cast-on-open.ts`). Vrai seulement si la vidéo d'ici a la main
  (`playsHere` : vue `local`, ou `other-on-tv` — un AUTRE film sur la TV n'est pas le même film sur deux écrans), que
  l'invite « Regarder sur TV ? » n'attend pas de réponse, qu'aucun rembobinage n'est proposé ou en cours, qu'aucun
  message n'attend de choix (`noticeHoldsPlayback` : lancement raté `connect_failed` / `load_failed`, ou Cast absent
  du navigateur `unavailable`, sous le panneau « recopie d'écran »), que la machine n'attend plus la TV ou le serveur
  pour ce film (`castPending`) et que la question des sous-titres n'est pas affichée (`question`, voir « Pistes »).
  L'invite n'existe que sur mobile, et passe après la question des sous-titres : posée à l'ouverture quand l'appelant la demande
  (`playerAsk`) ou quand un tel message est là, elle revient quand une attente (sélecteur, connexion, lancement)
  retombe sur `local` ; son second bouton dit « Continuer sur ce téléphone » (ou tablette, ordinateur :
  `continueHereLabel`). Toute vue où la vidéo d'ici n'a pas la main (attente, télécommande, liaison perdue, film
  terminé) la met en pause : jamais le film sur les deux écrans, jamais sous « BE KIND REWIND ». Sans invite ni Cast,
  ouvrir un film que la TV n'a pas le lance ici : c'est le cas normal.
- **Lecteur sans location** (échue pendant le film puis relue, prévisualisation adoptée sur le site principal) : il ne
  dessine rien, et se ferme lui-même une fois ses données relues (`playerWithoutRental`, cast-on-open) ; la machine
  reçoit `RENTAL_GONE` (`castRentalGone`) — un Cast de ce film s'arrête, « Location terminée ». Échap le ferme aussi,
  même sans `<video>` monté. Avant, il restait « ouvert », la borne inerte dessous, sans sortie visible.
- **Reprise ici.** « Arrêter », « Sur ce téléphone » (« Continuer sur ce téléphone » depuis la liaison perdue) et un
  arrêt venu d'ailleurs laissent `cast.resume`, que le lecteur prend une seule fois (`takeCastResume`) : il reprend à la
  position de la TV — à celle de la location quand la machine n'en connaît aucune (`position` null, page rechargée) — et
  ne lance la lecture que si le visiteur a choisi de continuer ici. Sinon il reste **en pause** : le visiteur n'est
  peut-être plus devant son téléphone. Une reprise de ce film que le lecteur n'a pas prise part à sa fermeture
  (`PLAYER_CLOSED`) : elle ne ressurgit pas à une ouverture lointaine.
- **Fin du film sur la TV** (`ended`) : la location est vue (100 %, position 0) et la séance serveur close. Le lecteur
  ouvert propose « BE KIND REWIND » — une seule décision, `rewindPromptFor` (`src/utils/cast-on-open.ts`) : ÉJECTER, ou
  fermeture directe si le rembobinage est déjà réclamé (« NON MERCI », qui laisse revoir le film, ne sert qu'à un film
  fini ailleurs et vu à l'ouverture). Lecteur fermé, la puce ou la barre dit « Film terminé » jusqu'au rembobinage ou à
  l'éjection (ÉJECTER ferme le lecteur puis appelle `castDismiss` : le film terminé est oublié). La séance avec la TV
  reste ouverte, le film suivant part sans repasser par le sélecteur.
- **Les messages** (`cast.notice`, mots dans `castNoticeView`) sont une ligne fermable sous l'en-tête (`CastNoticeLine`),
  avec « Réessayer » quand un nouvel essai a un sens : « La diffusion sur {nom} s'est arrêtée » (arrêt venu de la
  télécommande de la TV, d'Android, du menu Cast de Chrome ou d'une autre application : lecteur en pause à la dernière
  position, séance serveur close), « La télé n'a pas pu lire le film » + Réessayer, « Impossible de joindre {nom} » +
  Réessayer, « Le film n'a pas pu démarrer sur {nom} » + Réessayer, « Location terminée » (voir « Borne de
  location »), « Ce film n'a pas de source vidéo à envoyer sur la télé » (posé par la tranche, le service ne le connaît
  pas). Un navigateur sans Cast (`unavailable`) ouvre le panneau « recopie d'écran » avec « Le Cast n'est pas disponible
  sur ce navigateur. », et le film ne démarre pas dessous. Un sélecteur refermé n'est **pas** une panne : retour
  silencieux. Nom de la TV inconnu : les textes disent « la télé » (`castDeviceLabel`) — après un rechargement,
  `SDK_READY` donne celui de la séance reprise. Aucun message technique du SDK à l'écran. Le message que montrait le
  lecteur part à sa fermeture (`PLAYER_CLOSED`), sauf « Location terminée », que la borne montre lecteur fermé.
- **Les panneaux** (`CastPanels`, lus dans le store) couvrent le lecteur : l'attente (« Choisis ton appareil dans la
  fenêtre Google Cast. », « Connexion à {nom}… », « Lancement du film sur {nom}… », avec « Annuler » — qui, la
  connexion ou le lancement commencés, arrête aussi la séance qui s'ouvre), la télécommande
  (état réel de la TV : position, lecture/pause, ±15 s, volume, sous-titres, « ← Retour à la borne » ou « ← Retour au
  vidéoclub » d'après `playerFrom`, « Sur ce téléphone » — libellé d'appareil par `watchHereLabel` —, « Arrêter » ;
  elle pose aussi les commandes de l'écran verrouillé d'Android et sa notification média, du code **jamais vu sur un
  appareil** à ce jour) et la liaison perdue (« La télé ne répond plus » :
  « Réessayer », « Continuer sur ce téléphone », « Fermer » — jamais une impasse). **Jamais de `<button disabled>`** : un
  bouton qui attend l'accusé de la TV porte `aria-busy="true"`, est estompé et ignore l'appui. Le curseur de volume
  suit le doigt et la TV ne reçoit qu'une commande, au relâchement (`volumeSettle`) ; la machine ne prend qu'une
  commande à la fois (`busy`).
- **Échap, le geste retour, « ← Retour… »** : pendant un Cast (attente, télécommande, liaison perdue), Échap, `E` et le
  geste retour ferment le lecteur **sans rien demander au Cast** — la TV continue, la puce du vidéoclub ou la barre de la
  borne la signale, et un appui rouvre le lecteur directement sur la télécommande (`openPlayer(filmId, { from, ask:
  false })`). Espace pilote la TV, `T` change ses sous-titres. Seul « Arrêter » met fin à la séance : la TV revient à son
  accueil. « Sur ce téléphone » fait de même, puis reprend ici.
- **Un autre film passe sur la TV** (`other-on-tv`) : lecteur local normal — la lecture part ici aux mêmes règles
  qu'en `local` —, avec le bandeau « {titre} est en cours sur {nom} » (`OtherFilmBanner`) ; « Regarder sur TV »
  demande alors « Remplacer {titre} sur {nom} ? » avant de remplacer. Dans le vidéoclub, la fiche de la K7 ne bloque
  plus un film loué pendant qu'un autre passe sur la TV : « S'INSTALLER ET REGARDER » ouvre ce lecteur, comme pour tout
  film loué (l'ancien « DIFFUSION EN COURS — ARRÊTEZ D'ABORD » est parti le 19/11/2026).
- **La puce** (`ActiveCastIndicator`, vidéoclub 3D seulement) paraît lecteur fermé quand la TV a un film à signaler :
  « TÉLÉCOMMANDE » (point vert), « LA TÉLÉ NE RÉPOND PLUS » (point orange), « FILM TERMINÉ ». L'appui rouvre le lecteur
  sans invite : la TV a déjà son film.

**Ce que fait la machine quand rien ne va comme prévu** :

- **La TV ne répond plus** (`lost`) : une commande sans accusé (5 s) ou un statut sans réponse (5 s) ne se devinent pas,
  la machine redemande le statut ; sans réponse, la liaison est perdue et le dit. La séance serveur **reste ouverte**
  (la TV joue sans doute encore, l'estimation continue) ; le statut est redemandé toutes les 10 s et la télécommande
  revient si la TV répond. « Continuer sur ce téléphone » tente d'arrêter la TV, clôt la séance serveur à la dernière
  position, puis reprend ici — sinon le vérificateur remettrait la location à 100 % en plein visionnage.
- **Page rechargée, ou rendue après un gel** : le service redemande le statut à la TV. La location n'est relue sur le
  serveur (`READ_RENTAL`) que si la TV n'a plus de média — liste vide, `IDLE`, ou un média qui n'est pas d'ici —, ou si
  aucune séance n'est revenue au démarrage ; pas à chaque reprise. Média présent : télécommande. Plus de média et
  location à 100 % : film terminé. Plus de média et location sous 100 % : repos, lecteur en pause à la dernière position
  enregistrée, avec « La diffusion… s'est arrêtée ». `IDLE`/`FINISHED` de ce film : film terminé. Film mémorisé
  (`lastCastFilmId`) et TV qui ne répond pas à la demande de statut : « La télé ne répond plus », plutôt qu'un lecteur
  qui repartirait en local pendant qu'elle joue peut-être. Tant que ni la TV ni le serveur n'ont répondu,
  `castPending` retient la vidéo d'ici de ce film ; l'attente est bornée (SDK chargé en 8 s au plus, statut en 5 s,
  relecture en 10 s — une relecture impossible le dit par `RENTAL_UNREAD`, et le film cesse d'être attendu sans être
  oublié de `lastCastFilmId`).
- **Une relecture périmée ne coupe pas la télécommande.** La séance d'une page rechargée peut revenir APRÈS le délai de
  reprise (500 ms) : SDK_READY part sans elle et relit la location, puis la TV répond qu'elle joue. En télécommande ou
  en liaison perdue, seule la relecture que la machine a demandée elle-même (plus de média : `rentalAsked`) conclut ;
  une autre est ignorée (sauf une location disparue, qui arrête toujours la TV). Avant, la barre disparaissait, la
  séance serveur était close et le film pouvait jouer sur les deux écrans.
- **Fin sans `FINISHED`** : un `IDLE` sans raison, ou une séance média disparue, à 95 % ou plus de la dernière durée
  connue, est une fin ; `CANCELLED`, `INTERRUPTED` et `ERROR` gardent leur sens.
- **La location disparaît pendant un Cast** (échéance, retour) : la tranche le voit (`rentalGoneFilm` sur `rentals`),
  la machine reçoit `RENTAL_GONE`, la TV s'arrête, la séance se termine, la puce disparaît et une ligne « Location
  terminée » reste — la borne la dit elle-même. Un lecteur resté ouvert sur ce film se ferme de lui-même (voir
  « Lecteur sans location »). Une prévisualisation /admin n'a pas de location : celle d'un vrai film qui s'éteint ne
  l'arrête pas.
- **Déconnexion pendant un Cast** : `logout()` arrête le Cast (`castLoggedOut` → `RENTAL_GONE`) AVANT la requête de
  déconnexion, tant que le cookie existe, et vide `lastCastFilmId`. Côté serveur, `POST /api/auth/logout` clôt toutes
  les séances ouvertes du visiteur (`ended = 1`, locations intactes) AVANT d'effacer le cookie
  (`closeOpenCastSessions`) : le DELETE du téléphone peut arriver après lui (401), l'onglet a pu être fermé, la
  déconnexion venir d'un autre appareil — sans cela le vérificateur passait la location à 100 % à l'heure de fin
  estimée d'un film arrêté.

**Trois faits mesurés le 18/11/2026 (Pixel 9a, Chrome 157, vers « Téléviseur Pièce à vivre », récepteur standard) —
à tenir pour acquis, ce sont eux qui ont dicté la conception :**

- **F1** — si `setOptions` n'est transmis qu'une fois, la télécommande obéit encore après fermeture et réouverture du
  lecteur. Rappelé une seconde fois, il suffit à couper les commandes sans que le SDK ne s'en aperçoive. D'où le
  service unique.
- **F2** — après un rechargement de page, `setOptions` au démarrage reprend la séance en quelques millisecondes
  (`SESSION_RESUMED`) mais **sans média** ; un message `GET_STATUS` sur `urn:x-cast:com.google.cast.media` fait revenir
  le film en cours (état, position, durée, titre) en moins d'une seconde. Le service le demande à chaque séance reprise
  (effet `REQUEST_STATUS`) et lit la **réponse brute** : l'objet média du SDK n'existe pas encore. Le film est reconnu
  par le `customData` du média, posé au chargement : `{ filmId }` pour une location, `{ filmId, preview: true }` pour
  une prévisualisation /admin (qui n'est jamais suivie par le serveur).
- **F3** — à la fin du film, l'écouteur de la séance média (`Media.addUpdateListener`) reçoit `IDLE` avec
  `idleReason: "FINISHED"`, durée encore lisible sur l'objet média : c'est le signal de fin. `RemotePlayer`, lui, remet
  durée et position à 0 dans le même lot : le service lit l'objet média, jamais `RemotePlayer` (sauf le volume du
  récepteur). Repli si le signal manque (séance média disparue, ou `IDLE` sans raison) : dernière position connue
  ≥ 95 % de la dernière durée connue, mémorisées **avant** la remise à zéro.
- Aussi mesuré : Chrome gèle la page 60 s après son passage en arrière-plan et la reprend au retour (la position part
  au passage en arrière-plan, un statut est redemandé au retour : `PAGE_HIDDEN`, `PAGE_VISIBLE`, événement `resume`) —
  mais la séance n'en sort PAS intacte, voir F6 ; `endCurrentSession(true)` libère bien la TV ; `requestSession` appelé sur une séance existante
  ouvre une fenêtre native « Arrêter la diffusion » (le service rejoint la séance au lieu de rouvrir le sélecteur) ;
  le sélecteur rejette `'cancel'` quand le visiteur le referme.

**Trois autres faits, mesurés à la recette du 21/11/2026 (mêmes appareils) — chacun a d'abord été un défaut :**

- **F4 — une entrée d'historique referme le sélecteur d'appareils.** Un `history.pushState` (ou un retrait d'entrée)
  pendant que la fenêtre native « Caster sur » s'ouvre la referme : `requestSession` rejette `'cancel'` en moins d'une
  seconde (expérience contrôlée : avec l'entrée, fermeture ; sans, la fenêtre reste). « Sur ma télé » de la borne
  ouvrait le lecteur — et sa garde du geste retour — dans le même appui : le sélecteur ne s'affichait jamais. La pile
  des gardes sait donc **retenir** l'historique (`hold` dans `src/hooks/back-guard-stack.ts`, `holdBackGuards` dans
  `useBackGuard.ts`) : la tranche du Cast la tient tant que la phase est `choosing` ; les gardes ouvertes entre-temps
  reçoivent leur entrée à la libération. Toute nouvelle écriture dans l'historique doit passer par cette pile.
- **F5 — sur une séance neuve, le chargement se dit réglé avant d'avoir eu lieu.** Quand la TV doit lancer
  l'application, le SDK annonce un objet média provisoire (`IDLE`) 86 ms après `loadMedia`, l'abandonne, et règle la
  promesse sans objet média ; la TV charge le film 2 s plus tard et le SDK crée alors un autre objet, **sans**
  `MEDIA_SESSION`. Le service relit donc la séance (`lookForMedia`) sur un signal de `RemotePlayer`
  (`IS_MEDIA_LOADED_CHANGED`, `PLAYER_STATE_CHANGED` : signal seulement, jamais source) et chaque seconde pendant
  `loading` ; un objet au repos n'est jamais repris. Sans cela : « Le film n'a pas pu démarrer » après 20 s, la TV en
  lecture.
- **F6 — au retour d'un gel, la liaison de la page est coupée et le SDK ne le sait pas.** Il se dit `CONNECTED`,
  séance et objet média à l'appui, mais tout envoi lève `InvalidStateError` (« Presentation connection is
  disconnected ») et rien ne revient seul (30 s d'essais refusés). `chrome.cast.requestSessionById(id)` rejoint la
  séance sans fenêtre native : un NOUVEL objet de séance, où un envoi repasse 370 ms après — et `SESSION_RESUMED`
  n'est pas toujours annoncé. Quand une demande de statut ne peut pas partir, le service redemande donc la séance (une
  fois par demande) puis renvoie la demande toutes les 500 ms sur la séance courante (`statusSendFailed`,
  `retryStatus`) ; l'échéance de 5 s conclut sinon à la liaison perdue, et chaque `TICK` retente. Mesuré après 80 s
  d'arrière-plan : séance rejointe en 0,6 s, la télécommande ne quitte pas l'écran.
- Levé aussi le 21/11 : le récepteur standard renvoie bien `customData` au chargement **et** dans sa réponse à
  `GET_STATUS` ; il accepte une piste de sous-titres servie avec `Access-Control-Allow-Origin: *` (il vient la chercher
  avec `Origin: https://www.gstatic.com`), et la bascule de piste se fait sans recharger le film.

**Position, en lecture locale** : `updateRentalProgress` toutes les 10 s quand la vidéo joue, sur `pause` et à la
fermeture du lecteur (flush final). Pendant un Cast, ou sur un film que la TV vient de finir, le lecteur n'écrit plus
rien : sa vidéo, en pause, écraserait la position tenue par le service, voire les 100 % d'une fin vue sur la TV.

**Suivi serveur d'un film regardé sur la TV, téléphone éteint** (`docs/superpowers/specs/2026-11-17-cast-suivi-serveur-design.md`,
repris par la refonte du 18/11). Une fois le film lancé sur la TV, on doit pouvoir fermer l'application. Le suivi est
tenu par le **service**, plus par le lecteur : il tourne donc aussi lecteur fermé, tant que la page vit. `SERVER_OPEN`
crée la séance de Cast au chargement (`POST /api/cast-sessions`), `SERVER_REPORT` envoie la position toutes les 10 s en
`remote` et au passage en arrière-plan (`PATCH` de la séance **et** progression de la location), `SERVER_CLOSE` la clôt
(`DELETE`, `finished` vrai quand le téléphone a vu la fin). Les appels partent dans **une file** : une position ne
PART pas après la clôture qui la suit. Sur le fil, ce n'est pas garanti : chaque port de la tranche se règle
(`settle` : abandon après 10 s), et un appel abandonné peut encore aboutir plus tard — un `PATCH` de position resté
bloqué plus de 10 s peut arriver après le `DELETE` et rouvrir une séance (connu, différé). Une prévisualisation
/admin n'appelle jamais le serveur. Côté serveur (`app/api/cast-sessions/route.ts`, `lib/cast-sessions.ts`, la
logique dans `lib/cast-session-store.ts`, testée sur une base en mémoire) :

- la **durée est facultative** : absente, le serveur prend `films.duration_sec` ; 400 seulement si aucune durée n'existe
  nulle part (sans location active : 200 avec `session: null`, rien à suivre) ;
- **pas de doublon** : un `POST` sur une location qui a déjà une séance ouverte met cette séance à jour ; un `PATCH`
  sans séance ouverte en rouvre une ;
- **le téléphone corrige** : `POST` et `PATCH` acceptent la durée réelle annoncée par la TV, qui prime sur la durée déjà
  notée, elle-même prioritaire sur `films.duration_sec` (dans la base de seed la durée du film et celle de la vidéo de
  test diffèrent : ~110 min contre 10 min) ;
- **le vérificateur** (`lib/cast-session-checker.ts`, toutes les 60 s) examine les séances dont la fin estimée est
  passée ; `completeCastRental` (`lib/cast-completion.ts`) note la location vue (100 %, position 0, même expirée)
  **avant** et **sans dépendre** de la notification, et il **clôt** (`ended = 1`) la séance qu'il vient de compléter —
  sinon elle serait réécrite en boucle. La fin vue par le téléphone donne le même résultat ;
- **une séance échue vaut une fin**, sans attendre le vérificateur (qui ne passe que toutes les 60 s) : une clôture
  sans `finished` d'une séance dont la fin estimée est passée note la location vue, et `GET /api/me` complète les
  séances échues du visiteur (`completeDueCastSessions`) AVANT de lire ses locations. Le téléphone qui revient juste
  après la fin du film lit 100 % et propose « BE KIND REWIND » au lieu de conclure à un arrêt ;
- **la déconnexion** clôt toutes les séances ouvertes du visiteur, locations intactes (voir plus haut).

**Estimation par l'horloge, et ses limites acceptées** (17/11/2026) : sans le téléphone, le serveur ne voit pas la TV.
La fin estimée est « maintenant + ce qui reste du film » ; pause, avance rapide ou arrêt sur la TV ne sont pas vus, et
le téléphone corrige quand il est là. **Jamais de récepteur Chromecast maison** (décision de Rusmir du 17/11/2026,
reprise par la spec du 18/11) : le récepteur est le récepteur média par défaut de Google
(`DEFAULT_MEDIA_RECEIVER_APP_ID` ; `NEXT_PUBLIC_GOOGLE_CAST_APP_ID`, si elle est posée, le remplace), donc rien ne
remonte de la TV au serveur et le suivi reste estimé. ⚠️ `estimated_end_at` est en ISO (« T ») : toute comparaison
avec `datetime('now')` passe par `datetime()`, sinon une séance finie le jour même n'est trouvée qu'après minuit UTC
(corrigé le 17/11/2026).

**Non couvert par la refonte** (à savoir avant de promettre quoi que ce soit) :

- **AirPlay** : le chemin du lecteur (`handleAirPlayPicker`, `appleAirPlay`) est resté tel quel ; il sera repris avec le
  chantier de l'iPad.
- **Abonnement aux notifications** : toujours pas branché côté client (`handleEnablePushNotifications` n'a aucun
  appelant, donc `push_subscriptions` ne se remplit pas) ; la notification « film terminé » n'a personne à qui parler. Le
  serveur note quand même la location vue : il ne dépend pas d'elle.
- **Safari sur Mac** : « Sur ma télé » à la borne ouvre le lecteur (`openPlayer(filmId, { from: 'kiosk', ask: true })`),
  dont l'invite « Regarder sur TV ? » n'existe que sur mobile : le film part sur l'ordinateur, et le bouton AIRPLAY de
  l'en-tête reste le chemin. Comportement d'avant la refonte, à traiter avec l'iPad.
- **Sous-titres en Cast** : le seed pose des adresses relatives (`/seed-media/…`), que la TV ne peut pas joindre. Pour
  les essayer en local : servir `public/seed-media` sur le réseau avec l'en-tête CORS « * » (`serveur-vtt.py`, voir la
  recette) et donner à un film des adresses absolues dans `zone.db` (`subtitle_fr_vtt`, `subtitle_en_vtt`), puis les
  remettre. Fait le 21/11/2026 : pistes chargées et basculées. En production, jamais vu.

#### Recette du Cast sur appareil

⚠️ **État de la vérification au 21/11/2026** : la recette a eu lieu sur le Pixel 9a et le vidéoprojecteur, build de
production, état relu sur la TV à chaque pas. Les points 1 à 10 de la spec (§ 6) sont **vus bons**, après trois
corrections trouvées sur place (F4, F5, F6 ci-dessus) : résultats dans la spec, § « Résultats de la recette ».
**Restent, jamais vus** : le point 11 (arrêt et extinction depuis la TV, Wi-Fi coupé, téléphone verrouillé jusqu'après
la fin, déconnexion du compte pendant un Cast — à faire avec Rusmir), le point 12 (Chrome sur le Mac), l'image des
sous-titres à l'écran (pistes actives constatées, affichage non regardé), et tout ce qui touche la production. Une
suite de tests verte n'avait vu aucun des trois défauts : le faux SDK ne rejoue que ce qu'on a mesuré. Après toute
retouche du service, rejouer au moins : premier lancement sur une TV sans application, « Sur ma télé » depuis la
borne, 80 s d'arrière-plan.

Les outils et les journaux sont dans `.superpowers/sdd/2026-11-18-audit-cast/` (ignoré par git) : `drv.cjs` pilote
l'onglet du téléphone par CDP ; `probe.js` et `sampler.js` journalisent le SDK, le serveur et l'écran (`sampler.js` lit
l'écran par des classes CSS : à adapter à celles de `CastPanels.module.css`) ; `picker.cjs` lit et touche les fenêtres
natives de Chrome ; `tv.py` lit l'**état réel de la TV** par pychromecast (dans un venv à part) ; `customdata.py`
vérifie que le récepteur renvoie `customData` ; `trace.cjs` affiche la **trace du service** ; `serveur-vtt.py` et
`soustitres_cors.py` servent les sous-titres du seed à la TV ; `sonde-liaison.js` mesure la reconnexion après un
arrière-plan. Ce qui ne se devine pas :

- **La trace du service** : poser `window.__castTrace = []` dans la page (c'est ce que fait `trace.cjs`) ; le service
  y écrit chaque pas de la machine (événement, phase avant et après, effets) et l'état du média au règlement d'un
  chargement. Inerte sans cette variable, ni adresse ni contenu. C'est elle qui a montré F5 et F6 : la lire AVANT de
  supposer.

- **Les appuis injectés par CDP restent sans réponse sur Chrome Android** : utiliser `adb shell input tap`. Sur le
  Pixel 9a, écran = x × 2,625 ; 2424 − hauteur × 2,625 + y × 2,625 (x et y : position de l'élément dans la page ;
  hauteur : celle de la fenêtre de la page).
- **Un onglet créé par CDP naît en arrière-plan** : ouvrir la page par
  `adb shell am start -a android.intent.action.VIEW -d http://localhost:3002/ com.android.chrome`.
- **Jamais `adb screencap`** : il montre les notifications du propriétaire du téléphone. Capturer l'onglet par CDP.
- **Le sélecteur du Cast exige un contexte sécurisé** : `adb reverse tcp:3002 tcp:3002` donne `localhost`. Pour CDP :
  `adb forward tcp:9334 localabstract:chrome_devtools_remote` (vérifier `Android-Package` = `com.android.chrome`). Si
  `curl http://127.0.0.1:9334/json/version` reste sans réponse, une autre application tient ce nom : viser la socket
  de Chrome, `chrome_devtools_remote_<pid>` (`adb shell pidof com.android.chrome`, liste dans `/proc/net/unix`).
- **La cible est « Téléviseur Pièce à vivre »** ; « Salle TV » est un Chromecast Audio, pas une cible. Garder l'écran
  allumé pendant la recette (`adb shell svc power stayon usb`, puis `stayon false`).
- **Voir les panneaux sans TV** : injecter un faux SDK dans la page. `tests/helpers/fake-cast-sdk.mjs` sert aux tests ;
  une version pour la page existe dans `.superpowers/sdd/2026-11-18-cast-refonte/task-6-verification/fake-cast-page.js`.

### Tutorial

7 étapes, `TUTORIAL_WAYPOINTS` dans le store, lerp caméra dans `Controls`. Étape 2 ouvre une K7
aléatoire, étape 3 la garde ouverte avec annotations et glow cyclique, étape 4+ la ferme. Fin :
téléportation au waypoint d'entrée + modale d'inscription si non authentifié.

## Borne de location (`src/components/kiosk/`)

Troisième scène de l'application (`currentScene === 'kiosk'`, à côté de `'exterior'` et
`'interior'`) : une seconde façon de louer, en **DOM pur**, pour tout appareil — WebGPU ou non.
Rayons, recherche par titre, fiche, connexion / inscription / récupération, location, puis le
**même lecteur** (`VHSPlayer`) et le même suivi de Cast que le vidéoclub. Document de conception :
`docs/superpowers/specs/2026-11-16-borne-location-design.md` (trois lots). On y accède par **la borne de la devanture** — sur mobile la borne elle-même ou le bouton
« BORNE 24/7 », sur le bureau la borne de la devanture animée —, après le film d'approche vers son
écran (voir « Devanture mobile »).

Règles à ne pas casser — chacune a son test dans `tests/domain/kiosk-*.test.mjs` :

- **Rien de 3D sous `kiosk/`** : ni `three`, ni `<canvas>`, ni `backdrop-filter`, ni filtre CSS. Tout ce
  qui est dans l'écran se mesure en `cqw`. La logique décidable vit dans `kiosk-logic.ts` (pur, testé).
- **Objectif photoréaliste : une dalle LCD de 2007 derrière sa vitre, pas une page web.** Référence
  de Rusmir : la photographie « 01_iMOZI_interface_2007 ». Facture : onglets collés dans un cadre,
  boutons plats à trame et fine bordure claire, satiné légèrement métallique, angles à peine
  arrondis. **Casse des libellés** (décision de Rusmir du 17/11) : l'action principale en
  CAPITALES (« LOUER », « SE CONNECTER »), les autres boutons et les onglets avec une majuscule
  initiale (« Recherche », « Suite », « Compte ») ; les capitales sont posées par la feuille de
  style, le texte reste écrit normalement pour les lecteurs d'écran. « Compte » et « Quitter »
  sont de vrais boutons : en texte nu, comme la barre du haut de la référence, on ne voyait pas
  qu'ils s'actionnent. Deux couches recouvrent le contenu de l'écran
  (`KioskView.module.css`) : la **dalle** (`.screen::before` — grille des pixels, rétroéclairage
  inégal, noirs relevés ; `.screen::after` — sa bande noire et l'ombre du cadre) et la **vitre**
  (`.ks::after` — le reflet de la rue). Ce qui fait « verre » et non « plastique » : un reflet
  **net**, qui **n'ajoute que de la lumière**, et rien d'autre — ni grain, ni voile, ni liseré, ni
  assombrissement en dôme (tous essayés le 16/11, tous lus comme un film plastique). Le reflet est
  une **photo** (`public/kiosk/glass-reflection.webp`, tirée de `public/exterior.jpeg` : recadrée,
  inversée, réduite à ses sources vives, flou d'objectif court, sur fond noir), composée en
  `mix-blend-mode: screen` — le **seul** mode de fusion de la borne ; ni filtre, ni flou
  d'arrière-plan. `.screen` a son propre contexte d'empilement (`z-index: 0`) : sans lui les
  calques numérotés de l'écran passent par-dessus le reflet. Les trames (dalle, boutons, hachure
  de la fiche) sont dessinées en **pixels physiques** (`--k-dpx`, posée par `KioskView` d'après
  `lcdDevicePixel()`) : un pas fixe en px CSS fait du moirage à densité fractionnaire (2,625 sur
  le Pixel 9a). La **grille de la dalle** est la matrice noire entre les pixels, dans les deux
  sens : un trait d'un pixel physique tous les `--k-lcd-n` (`lcdPitchInDevicePixels()` : deux
  sur un écran non dense), à peine marqué — ni interligne appuyé, ni bandes de couleur. **Elle se
  juge sur un écran NON dense** (le 60 Hz de Rusmir) : le 16/11 une trame à trois pixels y donnait
  des stries horizontales et un quadrillage des boutons — un rendu de tube cathodique, pas de
  LCD — que les captures Retina ne montraient pas. **Colorimétrie d'une dalle TN de 2007** (demande de Rusmir : contraste et couleurs
  limités, 6 bits + FRC, noirs délavés) — tout ce que l'écran affiche, jaquettes comprises, passe
  par `.screen::before` : un voile gris bleuté (noirs relevés et bleutés, blancs froids, couleurs
  moins pures), le haut plus dense et le bas plus pâle (dérive du gamma avec l'angle vertical), la
  fuite du tube du bas. Le fond de l'écran est celui de la référence — un bleu vif derrière la
  fiche qui tombe au **noir** vers les bords, pas un aplat bleu ; les cadres ne sont pas remplis
  de bleu. Ce dégradé est quantifié sur 6 bits (`--k-bg-stops`, liste produite par script) et
  `.kFrc` fait fourmiller l'image : un semis (`public/kiosk/lcd-frc.png`, une cellule par pixel
  de la DALLE SIMULÉE — un pas de la grille, `--k-lcd-n` pixels physiques —, amplitude d'un cran
  de 6 bits) qui saute de place trente fois par seconde — seule une translation est animée, en
  pourcentages d'un porteur de 96 cellules pour retomber sur des cellules entières. Validé par
  Rusmir le 17/11 (« le bon compromis ») : avec une cellule par pixel physique et un demi-cran, il
  était devenu invisible sur le Pixel (4 niveaux d'écart au plus entre deux instants). C'est une
  simulation des défauts VISIBLES : quantifier réellement les jaquettes demanderait un filtre ou
  un canvas, exclus ici. **Typographie, mesurée sur la photo de référence** (passe de design demandée par Rusmir le
  16/11) : Big Shoulders Display pour les libellés (onglets, boutons, titres ;
  choisie par Rusmir le 17/11 sur une comparaison côte à côte avec Sofia Sans Extra Condensed),
  Sofia Sans Condensed pour ce qui se lit, Inter pour les petites étiquettes
  de la fiche, Marker Felt puis Caveat Brush pour les valeurs au feutre ; toutes chargées par
  l'import de `src/index.css`. Sur la photo les libellés sont dans une DIN très étroite : à
  hauteur d'x égale, Barlow Condensed (utilisée avant) était 40 % trop large, d'où des libellés
  qui touchaient les bords de leurs cases. Règles à tenir : un libellé garde de la marge dans sa
  case (les corps sont calculés sur la largeur réelle des mots) ; le titre prend le plus grand
  corps qui tient (`titleScale()`, largeur estimée par `titleWidthEm()`) ; ni abréviation ni
  point médian dans un libellé — le bouton d'action dit l'action, le prix est à part
  (`actionLabel()`) ; ombre de texte courte et nette, jamais de halo ; l'onglet actif ne déborde
  pas sur ses voisins ; aucun glyphe tiré d'une police de secours (les triangles sont dessinés).
  Big Shoulders Display est une police HAUTE aux traits fins (hauteur d'x 0,60 em, capitale
  0,80 em) : ses corps sont plus petits et ses graisses d'un cran plus fortes qu'avec une police
  ordinaire, et la table de largeurs de `titleWidthEm()` est relevée sur elle — à refaire si la
  police du titre change. Pour grossir les libellés des onglets on change leur corps
  (`--k-tab-size`) ; leur hauteur, elle, vient de `phoneLayout` (voir plus bas). L'enseigne « LOCATION 24/7 » est un
  néon **rendu** (`public/kiosk/neon-location-247.webp`), sur le modèle de l'enseigne VIDEOCLUB
  de la devanture telle qu'elle est sur `public/exterior.jpeg` : lettres **en contour** d'une
  grotesque géométrique grasse, tube fin au cœur rose presque blanc, halo violet — pas Orbitron,
  et pas un texte avec des ombres portées, qui ne passe pas pour un néon. Trois feuilles — `KioskView`
  (corps, écran, dalle, vitre), `KioskBrowse` (rayons, fiche, bande), `KioskPanels` (connexion,
  recherche, messages) — partagent les variables `--k-*` posées sur l'écran. L'écran est en
  **5:9 sur téléphone** et en **2:3 sur PC** : les hauteurs passent par ces variables. Le texte du
  cadre « En bref » a 2 px de plus que sa proportion sur téléphone (Rusmir : « on a du mal à lire »).
  Le corps de la borne (fente, vitrines) reste schématique jusqu'au lot 3 (rendu Blender).
- **Ergonomie sur téléphone : les zones d'appui se MESURENT** (audit du 17/11/2026). On les
  relève dans la page par `document.elementFromPoint` sur tout le pourtour de chaque bouton, à
  360×780, 393×852 et 412×915 : c'est la zone réellement touchable, prolongements invisibles
  compris. Cible : 44 px au moins (WCAG 2.5.5), 24 px au strict minimum (WCAG 2.5.8). Les
  flèches de la bande ont une zone d'appui qui va jusqu'au bord de l'écran ; « Compte » et
  « Quitter » sont écartés de 12 px. **« LOUER » ne loue jamais en un seul appui** : la
  location se confirme (`confirmRentText`), y compris juste après une connexion qu'il a demandée.
  Gestes parasites coupés sur
  la borne : double-tap qui zoome (`touch-action: manipulation`), tirer-pour-rafraîchir
  (`overscroll-behavior-y: none` sur html et body, posé par `KioskView` le temps de la borne —
  une page rechargée a quitté la borne), menu de l'appui long (sauf champs et phrase de
  récupération).
- **Après « LOUER » confirmé, la borne distribue la K7** (`KioskDistribution`, document
  `docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md`, validé par Rusmir le
  17/11/2026). La location est enregistrée **avant** tout : « Veuillez patienter » pendant l'appel au
  serveur (sans bouton, le geste retour n'y fait rien), puis le panneau « Votre K7 est prête » —
  « Sur ce téléphone » (ou « Sur cette tablette », « Sur cet ordinateur » : `watchHereLabel`), « Sur ma télé »,
  « Plus tard », « Mon compte ». Un refus du serveur garde son message d'avant, sans panneau. Les deux choix
  sont décrits dans la règle qui suit (l'ancien `openPlayerOnTv` et son drapeau `castOnOpen` n'existent plus). La
  livraison 2 — robot, carter, afficheur et vidéo de 8 s, avec le lot 3 — viendra s'insérer entre l'attente et le
  panneau.
- **Chaque reprise d'un film déjà loué repasse par le même panneau** (refonte du Cast,
  `docs/superpowers/specs/2026-11-18-cast-refonte-design.md`, § 5.4 ; validé par Rusmir le 18/11/2026). « REGARDER » de
  la fiche (`KioskAction`) et « Regarder » de « Mon compte » n'ouvrent jamais le lecteur eux-mêmes : elles appellent
  `watch` de `KioskView`, qui lit `watchEntry({ view })` (`castView` de CE film). La TV a déjà le film (`remote`,
  `lost` ou `ended`) : le lecteur s'ouvre tout de suite, sur sa télécommande ou sur « BE KIND REWIND ». Sinon
  `KioskReady` s'ouvre avec `fresh` faux : « Où voulez-vous regarder ? » en titre, sans « Votre K7 est prête » ni la
  question répétée. « Sur ce téléphone » (`watchHere`) ouvre le lecteur sans invite (`ask: false`) : le visiteur a
  déjà répondu, le film démarre ici — même si la TV joue un autre film ; seule exception, une page rechargée dont la
  machine ne sait pas encore si la TV joue CE film (`castPending`) : il attend, en pause. « Sur ma télé » (`watchOnTv`,
  d'après `tvEntry`) fait partir le
  Cast **dans l'appui même** — `castFilm(filmId, { version })` avant tout `await`, dans la version décidée par le panneau
  (voir la règle suivante), à la position de la location par la règle de reprise de l'appareil (`castStartAt`, sans
  durée de fichier connue ici : voir « La vidéo remontée » dans « Player + Cast ») ; le sélecteur d'appareils exige
  l'activation —,
  puis ouvre le lecteur (`ask: false`), qui montre l'attente ; le panneau a démarré le service du Cast à son
  ouverture pour que le SDK soit prêt. **Branche AirPlay** : sur un appareil Apple qui sait faire AirPlay
  (`appleAirPlay`, lu sur l'élément vidéo), le Cast de Google n'existe pas : le lecteur s'ouvre avec son invite
  (`ask: true`), dont le sélecteur AirPlay exige un appui direct. Quand la TV joue un AUTRE film, la seconde ligne du
  bouton « Sur ma télé » le dit **avant** l'appui — « remplace {titre} sur {nom} » à la place de « via Chromecast »
  (`tvChoiceLine`) : l'appui remplace sans demander, parce qu'une confirmation en deux temps ferait perdre
  l'activation dont le sélecteur a besoin.
- **La ligne « Version » du panneau** (spec `docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md`,
  § 4.1, 4.3 a et 4.4). Entre l'échéance et les deux boutons, « Version » et le nom de la version qui jouera
  (`readyVersionRow` : la décision unique `decideVersion`, la même que celle du lecteur et du Cast). Elle montre et se
  change, sans rien demander : un appui remplace le contenu du panneau par la liste partagée (`VersionList`, VF ·
  VOSTFR · VO, « Autres versions », « Retour » ; une version absente est une ligne de texte avec sa raison), et un choix
  vaut **pour ce film** (`chooseFilmVersion`, retenu sur l'appareil tant qu'il est loué — la déconnexion l'efface aussi). Un film qui n'offre qu'un
  couple n'a rien à ouvrir : « VO · seule version de ce film », sans chevron ; une substitution s'écrit dessous
  (« VOSTFR · VF indisponible pour ce film ») ; sans aucune version lisible, « Ce film n'a aucune version lisible pour
  le moment. » et le lancement est refusé (`NO_PLAYABLE_VERSION`). **La question des sous-titres** : version préférée
  VOSTFR sur un film sans sous-titres français qui a la VF — « Sur ce téléphone » ou « Sur ma télé » demande d'abord
  « Ce film n'a pas de sous-titres français / La VO existe avec des sous-titres anglais. » (ou « Ce film n'a pas de
  sous-titres. ») avec « Continuer en … » et « Passer en VF » ; la réponse devient le choix de ce film et le film part
  vers la cible retenue **dans le même appui**. Le lecteur ouvert par la borne n'a donc plus rien à demander ; ouvert par
  le vidéoclub, il pose la même question lui-même (voir « Pistes » dans « Player + Cast »). Sous les deux réponses, une
  troisième ligne plus discrète, **« Retour »** (le retour de la liste, `.kAuthBack` + `.kVersionBack`, 44 px au moins ;
  décision de Rusmir du 20/11/2026), ramène au panneau sans lancer le film ni rien retenir — comme le geste retour, qui
  referme la question ou la liste avant le panneau (`kioskBackAction`).
- **La barre du Cast** (`KioskCastBar`) remplace la puce flottante dans la borne, qui recouvrait la rangée de K7.
  Lecteur fermé, quand la TV a un film à signaler (`castOwnsFilm` : elle le joue, ne répond plus, ou vient de le
  finir), un bouton dessiné dans le langage de la borne — l'aplat et le filet de « Recherche », sa police et sa casse
  (`kioskLabelCase`) — prend sa place entre « LOUER » et la bande, celle que `phoneLayout(pxPerCqw, castBar)` lui
  réserve : le cadre « En bref » cède d'abord, la rangée de jaquettes reste entière. Titre du film, état
  (« Télécommande », « La télé ne répond plus », « Film terminé ») et point (vert quand la TV joue, orange quand elle ne
  répond plus, aucun pour un film terminé). L'appui rouvre le lecteur (`openPlayer(filmId, { from: 'kiosk', ask:
  false })`) : sa télécommande ramène à la borne (« ← Retour à la borne »). **Visuel PROVISOIRE, Rusmir ne l'a pas
  encore vu** : vu à la taille d'écran d'un Pixel 9a (pas sur le téléphone), la page se recompose à l'apparition et à
  la disparition de la barre, et en « La télé ne répond plus » le titre est tronqué.
- **« Location terminée »** : la location du film qui est sur la TV disparaît (échéance, retour, déconnexion du
  compte), le service a arrêté la TV et laissé ce message. Le lecteur ne peut pas le dire (il ne dessine rien sans
  location) : c'est la borne qui le dit, après ses propres messages (`rentalOverStep`). Un lecteur resté ouvert sans
  location est fermé d'abord — il se ferme d'ailleurs de lui-même une fois ses données relues (voir « Lecteur sans
  location » dans « Player + Cast ») ; `rentalOverStep` le fait aussi, sans attendre cette relecture. Un lecteur qui
  joue un autre film n'est pas interrompu, le message attend : sa fermeture ne l'efface pas (`PLAYER_CLOSED` garde
  « Location terminée »). Le fermer (« Fermer », ou le geste retour) appelle `castDismiss`.
- **« Mon compte » et les critiques** (`KioskAccount`, `KioskReview`, spec
  `docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md`). « Compte » ouvre l'écran à tout moment, sans avoir à
  louer : crédits, locations en cours, **tout l'historique** (rendu / expiré / terminée, rembobiné, rendu en avance,
  critique). Une ligne **« Version préférée »** et sa valeur (« Automatique » quand rien n'est réglé) ouvre la même
  liste, précédée d'« Automatique » (« VF quand elle existe, sinon VOSTFR ») : c'est le **seul** chemin qui écrit la
  préférence du compte (`setVersionPref` → `PATCH /api/me/version`, colonnes `users.pref_audio` / `pref_subtitle`, nulles
  = « Automatique ») — l'application ne la déduit jamais de ce qui a été regardé, et ni un choix fait sur un film, ni
  « Essayer en … », ni une réponse à la question des sous-titres ne la changent. Le magasin ne l'écrit qu'après le oui
  du serveur : la ligne dit alors « Enregistré », un refus laisse la liste ouverte avec « L'enregistrement n'a pas
  abouti. Réessayez. ». La règle des critiques est **au serveur** (`lib/review-eligibility.ts`, renvoyée par `/api/me` →
  `reviewEligibility`) : une location suffit si elle est vue à 80 % **et** si 80 % de la durée se sont écoulés depuis son
  lancement (`rentals.watch_started_at`, posé par `lib/rental-marks.ts` sur une location sans progression) ; une seule
  critique par film et par visiteur, modifiable. Minimum **144 caractères** et intitulés **Réalisation / Scénario / Jeu
  d'acteurs** définis une seule fois (`src/utils/review-rules.ts`) et utilisés partout (serveur, lecteur, terminal,
  vidéoclub, Michel, borne). Le panneau d'après location demande « Où voulez-vous regarder ? » (`watchHereLabel`,
  `tvMeansLabel`).
- **Sur téléphone, la hauteur de l'écran se répartit d'après sa taille réelle** (`phoneLayout`,
  validé par Rusmir le 17/11/2026 sur son Pixel 9a). `KioskView` mesure l'écran de la borne
  (`ResizeObserver`) et pose les variables (`phoneLayoutVars`) ; l'écran 2:3 du PC garde sa
  mise en page fixe. Les commandes ne descendent jamais sous `KIOSK_MIN_PX` (« Compte » et
  « Quitter » 40 px, onglets des rayons 44, « LOUER » et « Recherche » 48) ; la fiche suit la
  colonne des rayons — **six par page**, « Suite » pour les autres ; la place qui reste va d'abord
  à la description (jusqu'à quatre lignes), tant que la bande garde des jaquettes confortables,
  puis au générique seul. **Sous « LOUER », seulement la bande** : trois K7 à la fois, sans
  intitulé de rayon ni boutons de tri — une flèche passe aux trois suivantes. Le format en
  hauteur (5:9) ne change pas : il garde de la marge pour la barre du navigateur. En largeur, en
  revanche, la borne prend tout (cadre de 6 px) ; la fente et la vitrine du dessous ne prennent
  que la hauteur qui reste.
- **Fiche détaillée d'un film** (`KioskDetail`, validée par Rusmir le 17/11/2026). Elle s'ouvre par
  le bouton « (i) Fiche » à droite du titre — un bandeau posé sur la jaquette ne se lisait pas comme
  un bouton — et par la jaquette. La colonne de gauche y porte six rubriques (`DETAIL_TABS` :
  Résumé, Distribution, Équipe, Avis, Bande-annonce, À voir aussi), l'ardoise reste en haut
  (`KioskSlate`, commune au parcours ; PUBLIC à la place de RAYON quand TMDB donne la
  classification), la rubrique prend tout le cadre du dessous, la disponibilité y reste en tête, un
  triangle signale un texte plus long que le cadre ; « Retour » et « LOUER » sont au pied de l'écran.
  Données : la base (rôles, stock), `/api/films/[tmdbId]/extras` (TMDB, gardé 30 jours en mémoire
  puis sur disque dans `TMDB_CACHE_DIR`, rien en base), `/related` (nos rayons ; les suggestions de
  TMDB ne tombaient sur aucun de nos films), `/api/reviews`. Geste retour : la bande-annonce
  s'arrête et revient au résumé, puis la fiche se ferme (`close-trailer`, `close-detail`). Sur le
  parcours, le bouton « (i) Fiche » fait 12,7cqw et le corps du titre suit la place qu'il lui laisse
  (`titleScale(title, TITLE_W_WITH_INFO)`) ; la jaquette de l'ardoise est 10 % plus grande dans la
  limite des valeurs au feutre de gauche (`POSTER_MAX_W`), son filet « TITRE » s'arrêtant avant elle.
- **Aucune publicité, donc aucun lecteur vidéo tiers dans la borne** (Rusmir, 17/11/2026 : « on ne
  veut absolument pas de pub […] hors de question de faire ça aux utilisateurs »). Le lecteur intégré
  de YouTube peut diffuser des publicités, et c'est la chaîne qui en décide ; un test refuse tout
  `<iframe>`, YouTube ou Dailymotion sous `kiosk/`. Les bandes-annonces viennent d'**Allociné**
  (VF le plus souvent), qui les héberge sur Dailymotion : le serveur (`lib/trailers.ts`) trouve la
  fiche Allociné par Wikidata (TMDB P4947 → AlloCiné P1265), choisit VF > VOST > VO, prend le flux
  « 480 » de la playlist HLS et le copie en MP4 par ffmpeg, déjà dans l'image — à la première
  ouverture de la fiche, une récupération à la fois, échec retenu 24 h. Gardées dans
  `TRAILER_CACHE_DIR`, sinon `MEDIA_FILMS_PATH/.bandes-annonces` (pas sous `.next`, que le
  déploiement efface), et jouées par un `<video>` dans l'écran. YouTube refuse tout téléchargement
  depuis ce réseau (« Sign in to confirm you're not a bot », 17/11/2026, même avec yt-dlp à jour).
  Estimation pour le catalogue : environ 3,6 Go (11,4 Mo en moyenne sur 20 films, 11 en VF).
- **Défauts d'une dalle de 2007, simulés** (validés par Rusmir le 17/11/2026) : allumage des tubes du
  rétroéclairage à l'ouverture (`.kWarm`, 2,8 s, retiré ensuite) ; fuites de lumière aux coins et
  nuages, visibles sur le sombre seulement (`.screen::before`) ; rémanence de 90 ms sur ce qui change
  à l'écran (`.kRise`) ; bande tournée par les flèches à 25 images par seconde
  (`steppedScroll`, calage suspendu le temps du mouvement) ; angle de vue piloté par l'inclinaison
  du téléphone (`viewingAngle`, `followBaseline` : délavée vue d'en dessus, assombrie d'en
  dessous, teinte de côté, reflet qui glisse ; zone morte 4°, plein effet à 60°, retour « de face »
  en 8 s) — rien sur PC ni sur iPhone (autorisation), ni pour qui demande moins de mouvement.
- **La garde du geste retour est testée, et son retrait d'entrée est différé.** `useBackGuard`
  délègue à `src/hooks/back-guard-stack.ts` (sans React ni `window` ; tests
  `tests/domain/back-guard.test.mjs`). Une garde refermée par l'interface laisse une entrée
  d'historique « orpheline », retirée à la tâche suivante ; une garde ouverte entre-temps la
  reprend au lieu d'en poser une. Ne pas revenir à un `history.back()` immédiat dans le nettoyage
  d'un effet : il est asynchrone, et suivi d'un `pushState` dans la même tâche il décale
  l'historique d'une entrée. C'est ce que provoque React en développement, qui rejoue l'effet d'un
  composant à son montage : après la fermeture du lecteur ouvert depuis la borne, le geste retour
  suivant sortait du site (tracé et corrigé le 17/11/2026 ; le build de production n'était pas
  touché, mais c'est en développement que la borne se regarde).
- **L'appui sur la borne libère le vidéoclub 3D.** La scène intérieure est démontée, prête ou non
  (`shouldMountInterior`), son renderer libéré (`interior/release-renderer.ts` — R3F ne libère pas un
  `WebGPURenderer`), et la vanne des préchargements se referme : les `fetch` inscrits par
  `whileStorefront` sont coupés, puis relancés quand la devanture est de nouveau affichée. La scène
  ne se remonte qu'à ce moment-là (0,8 s après), jamais dans le même rendu que la devanture.
  La libération part **au choix de la borne, avant le film d'approche** (`onKioskIntent`), alors
  que la devanture reste montée trois secondes : le minuteur de 0,8 s relit donc la vanne à son
  échéance (`isInteriorPreloadOpen`) et ne monte pas la scène pendant le film.
  ⚠️ Reste hors d'atteinte : les chargements déjà lancés par les loaders de three, qui vont à leur
  terme (`LoadingManager.abort()` existe en r187 mais oblige à purger les caches de drei).
- **Le code de la borne est demandé dès que la devanture est affichée** (`preloadKiosk`), avant les
  fichiers 3D : demandé à l'appui, il attendait derrière eux (14,3 s d'écran noir à 20 Mbit/s).
  Une fois arrivé, la borne est **montée directement** (`KioskMount` dans `App.tsx`), pas par
  `React.lazy` : même chargée, une composante paresseuse passe par le repli du `Suspense`, et React
  ne remplace pas avant ~300 ms un repli qu'il vient d'afficher — 320 ms de carton « Ouverture de
  la borne… » mesurées entre la fin de l'animation et l'écran de la borne. Le repli ne sert plus qu'à un
  code pas encore arrivé.
- **Le geste retour ne quitte jamais la borne.** Une seule garde (`useBackGuard`), reposée dès
  qu'elle a servi, qui ferme ce qui est ouvert selon `kioskBackAction` ; à la racine elle ne fait
  rien. On ne sort que par « quitter ». La garde n'est jamais posée dès le montage (StrictMode).
- **Téléphone en paysage = film seulement** : la borne s'efface devant une invitation à redresser
  l'appareil (`hidesKioskInLandscape`, lu sur l'écran et non sur la fenêtre, à cause du clavier).
- **Jamais de bouton `disabled` muet ni d'écran vide** : chaque refus est dit, le catalogue absent
  est demandé par la borne elle-même puis déclaré indisponible.

Les **règles d'un compte** (pseudo, mot de passe) n'ont qu'une définition,
`src/utils/account-rules.ts`, utilisée par les routes d'inscription et de récupération, la fenêtre
du vidéoclub et la borne. Le **tarif** d'une location aussi : `src/utils/rental-tier.ts`, auquel
`lib/films.ts` délègue. Les **dates du serveur** (UTC sans fuseau) se lisent par
`src/utils/server-date.ts`, jamais par `new Date()`.

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

`SEED_MOCK=1 npm run seed` lit `src/data/mock/films.json` (`{ "action": [tmdb_id, ...], ... }`).
Premier rayon gagne en cas de doublon, `nouveautes` positionne `is_nouveaute`, 250 ms entre chaque
appel TMDB. Ne lance **pas** les téléchargements. Les rayons sont les clés du JSON elles-mêmes : pas
de seconde liste à tenir à jour, et `tests/domain/consistency.test.mjs` vérifie qu'elles existent
toutes dans `AisleType`.

Le fichier contient **380 IDs sur les 12 rayons**, calqué sur le catalogue réel. C'est délibéré : le
nombre de cassettes affichées ne dépend pas de la taille du catalogue (`buildDisplaySequence` répète
les films pour remplir une capacité d'étagère fixe), mais **l'atlas de jaquettes est dimensionné sur
le nombre de posters uniques**. À 135 films il pèse 34,6 Mo, à 314 il en pèse 77,8 — mesurer le
premier affichage sur un catalogue tronqué donne des chiffres faux d'un facteur 2.

#### État média synthétique

Le seed pose aussi de quoi rendre le catalogue **jouable sans pipeline média** : `is_available`,
`transcode_status`, `media_dir`, `original_language` (TMDB), `duration_sec` (`runtime × 60`), les
chemins VO/VF et les sous-titres.

- **Vidéo** : la même pour tous les films — Big Buck Bunny sur archive.org (CC BY 3.0), ~10 min,
  `accept-ranges: bytes` + `access-control-allow-origin: *`.
- **Sous-titres** : un jeu unique dans `public/seed-media/` (`sub.{fr,en}.{vtt,srt}`), servi en
  same-origin — un `<track>` cross-origin exigerait du CORS *et* l'attribut `crossorigin`.
- **Passe-plat** : `lib/symlinks.ts` expose `isDirectMediaUrl()`, qui reconnaît ces valeurs à leur
  forme (`http(s)://` ou `/`). `buildStreamingUrls()` dans `lib/rentals.ts` les renvoie telles
  quelles et `createRentalSymlinks()` ne crée aucun lien pour elles. Un chemin de pipeline reste
  relatif à `MEDIA_FILMS_PATH` et continue de passer par les symlinks : les deux cohabitent.

La répartition VO/VF/sous-titres **reproduit celle de la prod** (constante `SEED_DISTRIBUTION`), parce
que les cas qui cassent le player sont les buckets minoritaires : un film sans VF fait remplacer la
version demandée (et l'écrire), un film sans sous-titre FR fait poser la question des sous-titres à qui
préfère la VOSTFR. Le tirage est déterministe (haché sur
le `tmdb_id`), donc reproductible d'une machine à l'autre et stable d'un run au suivant.

Relancer le seed sur une base existante **ne réécrit que les états média de seed** : un chemin de
pipeline réel n'est jamais écrasé.

## Mesures de terrain

Un Mac de développement ne dit rien des téléphones : sur un Pixel 9a, l'entrée dans la boutique
prend le même temps à chaque visite (le cache de shaders n'y joue presque pas), là où le Mac
passe de ~18 s à ~5 s en visite de retour. `src/utils/perf-beacon.ts` chronomètre donc chaque
entrée chez le visiteur et tient à jour **une ligne par chargement de page** via `POST /api/perf`
(table `client_perf_runs`) : temps jusqu'à la devanture, du clic à « scène prête », durée du
préchauffage, gels dans les 10 s qui suivent, GPU, modèle d'appareil quand le navigateur le
donne, et le dernier état atteint (`no_entry` → `abandoned` → `ready` ; `warmup_max`, `no_webgpu`).

- **Par étapes, page vivante** : la ligne est envoyée à la devanture, au clic, à « scène prête »
  puis 10 s plus tard, et le serveur la met à jour (`ON CONFLICT(run_key)`). Un visiteur qui part
  en route laisse sa ligne à la dernière étape atteinte. ⚠️ Ne pas « simplifier » en un envoi
  unique au départ de la page (`pagehide`) : sous le contrôle du service worker, Chrome accepte
  le `sendBeacon` et ne l'émet jamais (mesuré : 0 arrivé sur 5, contre 5 sur 5 sans service worker).

- **Anonyme** : ni compte, ni IP, ni identifiant de visiteur. L'IP ne sert qu'au limiteur de
  débit en mémoire ; `run_key` est tirée au hasard à chaque chargement de page et n'est stockée
  nulle part côté navigateur.
- **Découplé** : le module observe le DOM, le store et les messages `[WARMUP…]` du préchauffage
  au lieu d'être appelé par l'application — il donne les mêmes chiffres sur toutes les versions.
  Renommer ces messages ou l'`aria-label` du bouton d'entrée casse la mesure en silence.
- `NEXT_PUBLIC_BUILD_ID` (posé par `next.config.ts` depuis `git rev-parse --short HEAD`)
  étiquette chaque ligne : c'est ce qui permet de comparer deux déploiements.
- Les passes pilotées (`navigator.webdriver`) sont marquées `automated = 1` et écartées des
  agrégats par défaut. En développement, le module ne s'active qu'avec `?perf=1`.
- Lecture : `GET /api/admin/perf` (médiane et 75e centile par appareil, build, mobile/desktop,
  première visite/retour).

## Tests

Runner **natif Node** (`node --test`), pas de Jest/Vitest.

| Dossier | Contenu |
|---|---|
| `tests/architecture/` | Imports morts, budget de taille (≤ 1000 lignes, exceptions listées), assets référencés existants |
| `tests/domain/` | Audits figés en régressions (sécurité, performance, UX/compat) + cohérence des types + borne de location (`kiosk-logic`, `kiosk-wiring`), règles de compte, tarif, dates du serveur + le Cast (`cast-*.test.mjs`, voir plus bas) |
| `tests/helpers/` | `repo.mjs` (lire et parcourir le dépôt), `fake-cast-sdk.mjs` (faux Web Sender SDK de Google Cast) |
| `tests/media/` | Pipeline : `identify-tracks`, `iso639`, `quality-control`, `video-plan`, `media-dir` (`.test.ts`, type-strip natif Node 22) |
| `tests/cache/` | LRU des textures VHS, cache TMDB, en-têtes HTTP |
| `tests/performance/` | Rejoue la logique de collision de `Controls.tsx` |

La plupart des tests `domain`/`architecture` sont de l'**analyse statique du code source** (regex et
assertions sur le texte des fichiers) — pattern « audit as test », pour empêcher le retour de
régressions constatées lors des audits.

**Le Cast se teste à trois niveaux.** La machine et le fil sont purs et se testent tels quels
(`cast-machine`, `cast-wire`, `cast-labels`) : `cast-machine.ts` et `cast-wire.ts` n'ont aucun import de valeur, et
`cast-service.ts` importe ses voisins avec l'extension `.ts`, ce qui permet à Node de le charger. **Le service se teste
devant un faux SDK** (`cast-service` + `tests/helpers/fake-cast-sdk.mjs`, qui rejoue ce qui a été mesuré sur le
Pixel : séance reprise sans média, réponse brute à `GET_STATUS`, envoi qui lève sur une liaison morte, fin de film où
`RemotePlayer` est remis à zéro ; et, non mesuré mais conforme à la documentation, une fin de séance qui passe par
`SESSION_ENDING` puis `SESSION_ENDED`). Le texte des composants se garde par analyse statique (`cast-service-wiring` —
dont « un seul `setOptions(` dans `src/` » et « chaque effet a son cas dans `runEffect` » —, `cast-store`,
`cast-player`, `cast-panels`). Côté serveur, `cast-session-store` et `cast-completion` tournent sur une base en
mémoire ; `cast-on-open` couvre la règle AirPlay, la lecture automatique (`localAutoPlay`), le lecteur sans location
et la proposition de rembobinage, `cast-subtitles` les pistes de sous-titres ; la relecture des locations
(`rentalsRefreshOutcome`) est testée dans `cast-store`.

## Variables d'environnement

| Variable | Usage |
|---|---|
| `DOMAIN` / `SUBDOMAIN` / `STORAGE_SUBDOMAIN` | Domaines Traefik |
| `TMDB_API_KEY` / `NEXT_PUBLIC_TMDB_API_KEY` | TMDB serveur / client |
| `TMDB_CACHE_DIR` | Cache disque des données TMDB de la fiche détaillée (défaut `.tmdb-cache/`) |
| `TRAILER_CACHE_DIR` | Bandes-annonces de la borne (défaut `MEDIA_FILMS_PATH/.bandes-annonces`, sinon `.trailer-cache/`) |
| `HMAC_SECRET` | Signature des cookies |
| `API_SECRET` | Clé API pour tests automatisés (`x-api-key`) |
| `DATABASE_PATH` | Chemin SQLite (`/data/zone.db`) |
| `RADARR_URL` / `RADARR_API_KEY` | Instance Radarr unique |
| `RADARR_QUALITY_PROFILE_ID` / `_FR` | Profils MULTi / TrueFrench |
| `RADARR_ROOT_FOLDER` | Racine Radarr côté container |
| `MEDIA_LIBRARY_PATH` / `MEDIA_FILMS_PATH` / `MEDIA_BACKUP_PATH` / `SYMLINKS_PATH` | Chemins média |
| `DELETE_MKV_AFTER_BACKUP` | Suppression de la source après backup |
| `FORCED_RENTAL_VIDEO_URL` / `FORCED_RENTAL_FILE_PATH` | **Dev/staging** : sert la même vidéo pour toute location, VF **et** VO, sans sous-titres. Court-circuite les symlinks — donc rend la dispo VF/VO/ST intestable en local. Préférer le seed, qui pose une dispo par film (voir « État média synthétique ») |
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

**Dispo VF/VO = le fichier TRANSCODÉ, non marqué** — la version réellement jouable est
`file_path_v{f,o}_transcoded` (c'est ce dont `streaming_urls` et les symlinks se servent), jamais
`file_path_v*` ni `radarr_v*_id` (colonnes mortes). Une version marquée illisible (`v{f,o}_unplayable = 1`,
posé par `npm run media:check -- --mark`) compte comme **absente** : un chemin rempli ne suffit pas. Toujours
passer par `playableVersions` (`lib/media/file-check.ts`), qu'utilisent la fiche, `buildStreamingUrls`,
`rentFilm` et `getRentalDownloadSource` ; ne jamais retester le chemin à la main. Ça se teste désormais en local : le seed pose une
dispo VF/VO/ST **par film**, aux proportions de la prod. `FORCED_RENTAL_VIDEO_URL`, lui, force
toujours les deux versions sans sous-titres — s'il est défini, il gagne sur le seed et on ne teste
plus rien de tout ça.

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

**Un seul `setOptions`** — le SDK de Google Cast se laisse initialiser deux fois sans une erreur : le second
`context.setOptions(` coupe sans bruit le canal des commandes sur Chrome Android, alors que le SDK dit toujours
« connecté » et que le temps estimé avance. Vu sur le Pixel : pause et arrêt n'atteignent plus la TV après fermeture et
réouverture du lecteur. Un seul appel, dans `src/cast/cast-service.ts` ; un test compte les `setOptions(` de `src/`.
Ne pas replacer l'initialisation dans un composant ou un effet : un composant se remonte, le service non.

**Un état, un écrivain** — cinq effets React et deux gestionnaires du lecteur écrivaient le même état du Cast et se
contredisaient : attente sans fin à la réouverture, délai qui courait pendant le choix de l'appareil, fin de film lue
comme un arrêt manuel. Des rustines effet par effet auraient corrigé le premier défaut et laissé les autres : ils
viennent du chevauchement lui-même. Ce qui le règle : un réducteur pur, `castReduce`, seul à décider, que le service
alimente et que l'interface ne fait que lire. Un `useEffect` qui écrit l'état du Cast est un défaut, quelle que soit
son intention : le cas manquant s'ajoute à la machine.

**Le statut de la TV se demande** — après un rechargement de page, la séance Cast est reprise en quelques millisecondes
mais **sans média** : le SDK ne sait plus ce qui joue. Il faut envoyer `GET_STATUS` sur `urn:x-cast:com.google.cast.media`
et lire la réponse brute. Même piège à la fin du film : `RemotePlayer` remet durée et position à 0 dans le même lot que
`IDLE`, donc un lecteur qui le lit conclut à un arrêt manuel. Le signal est `idleReason: FINISHED`, lu sur l'objet média
de la séance (`Media.addUpdateListener`), dont la durée reste lisible.

**L'état réel de la TV se lit sur la TV** — le SDK du téléphone extrapole le temps et continue de dire « connecté » sur
une liaison morte : ce qu'il affiche ne prouve pas que la TV obéit. L'audit du 18/11/2026 a lu la TV elle-même
(`tv.py`, pychromecast), et c'est ce qui a montré que la télécommande n'avait plus de prise. Une recette du Cast qui ne
regarde que l'écran du téléphone ne prouve rien.

**Un faux SDK attrape ce que les gardes statiques ne voient pas** — le pattern « audit as test » (lire le texte du
code) ne voit pas une échéance de statut levée trop tôt, ni le statut tardif d'une séance qui n'est plus la courante :
la relecture du service a trouvé deux défauts importants que des gardes statiques laissaient passer, et les premiers cas
devant le faux SDK en ont trouvé un de plus. `tests/helpers/fake-cast-sdk.mjs` fait tourner le vrai
`src/cast/cast-service.ts` sous Node, avec les comportements mesurés sur l'appareil ; les cas du service s'écrivent
contre lui, les gardes statiques ne tiennent que le texte des composants.

## Skills

- `threejs-webgpu-architect` — architecture Three.js/R3F, performance, photoréalisme, assets
- `webgpu-pure` — WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- `webgpu-canvas-text` — texte dans une scène WebGPU via `CanvasTexture` (Troika est incompatible WebGPU)
