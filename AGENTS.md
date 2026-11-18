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
├── cast-sessions.ts cast-session-checker.ts
├── cleanup.ts push.ts tmdb.ts

src/
├── App.tsx                  # Vrai point d'entrée : trois scènes (devanture, vidéoclub, borne), lazy loading, prefetch catalogue, PWA
├── api/index.ts             # Client API frontend
├── data/storefront-mobile.json  # Mise en page de la devanture mobile — FABRIQUÉE, ne pas retoucher à la main
├── store/index.ts + slices/ # Zustand (manager.ts, tutorial.ts externalisés)
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
│   ├── player/              # VHSPlayer + Google Cast / AirPlay
│   ├── manager/             # Chat du gérant + composants Generative UI
│   ├── videoclub/ tutorial/ mobile/ ui/ board/ auth/ review/ search/
├── hooks/                   # useGoogleCast, useKTX2Textures, useBackGuard…
├── utils/                   # CassetteTextureArray (atlas), VHSCoverGenerator, interior-preload-gate
│                            # (vanne des préchargements 3D), account-rules (règles d'un compte)…

cinema-stream/               # Service Node autonome — chaîne HLS 24/7
zone-discord-bot/            # Service Node autonome — présence Discord
scripts/                     # seed, migrate, configure-radarr, cinema-cam*, entrypoint…
tools/devanture-borne/       # Fabrique des images de la devanture mobile (Python + Blender) — voir « Extérieur »
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

Il n'y a **pas** de `DELETE /api/rentals/[filmId]` (utiliser `POST /return`), ni de
`DELETE /api/reviews/[filmId]` (`PUT` à la place), ni de `DELETE /api/requests`.

## Base de données

Tables : `users`, `films`, `genres`, `film_genres`, `rentals`, `reviews`, `film_requests`,
`weekly_bonuses`, `return_requests`, `user_facts`, `board_notes`, `film_processing_runs`,
`push_subscriptions`, `cast_sessions`, `client_perf_runs`.

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

**Sous-titres en Cast** — les `<track>` du `<video>` local ne traversent pas le réseau. Les WebVTT
sont donc **side-loadés** dans le `MediaInfo` (`mediaInfo.tracks`, `text/vtt`, IDs stables fr=1/en=2)
et la langue active part dans `request.activeTrackIds`. Pendant le cast, un changement de piste passe
par `media.editTracksInfo(...)` sans recharger le film (boutons STFR/STEN du panneau Now Playing +
touche `T`). `buildCastSubtitleTracks()` (`src/utils/cast-subtitles.ts`) n'accepte que les URLs
absolues : un chemin `/seed-media/...` n'est pas joignable par le Chromecast, et déclarer des tracks
impose le CORS sur le MP4 comme sur le VTT (le storage envoie `Access-Control-Allow-Origin: *` sur
les deux). Le receiver par défaut ne gère que les pistes **texte**, une seule active à la fois. AirPlay
n'est pas couvert : `webkitShowPlaybackTargetPicker` envoie l'URL seule.

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

**Suivi d'un film regardé sur la TV, téléphone éteint** (`docs/superpowers/specs/2026-11-17-cast-suivi-serveur-design.md`).
La sauvegarde ci-dessus n'existe que lecteur ouvert et page au premier plan ; une fois le film lancé sur la TV, on doit
pouvoir fermer l'application. Le serveur prend donc le relais : la séance de Cast (`cast_sessions`, créée au lancement,
fin estimée recalculée à chaque `updatePosition`) est examinée toutes les 60 s par `lib/cast-session-checker.ts` ; à sa
fin estimée, `completeCastRental` (`lib/cast-completion.ts`) note la location vue (100 %, position 0, même expirée)
**avant** et **sans dépendre** de la notification. À la réouverture, `shouldOfferRewindOnOpen` fait proposer « BE KIND
REWIND » au lecteur au lieu de relancer le film (« NON MERCI » laisse revoir le film). Estimation par l'horloge : pause,
avance rapide ou arrêt sur la TV ne sont pas vus. **Jamais de récepteur Chromecast maison** (décision de Rusmir du
17/11/2026). ⚠️ `estimated_end_at` est en ISO (« T ») : toute comparaison avec `datetime('now')` passe par `datetime()`,
sinon une séance finie le jour même n'est trouvée qu'après minuit UTC (corrigé le 17/11/2026).

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
  « Regarder », « Sur la TV », « Plus tard », « Mes locations » (`KioskRentals`). Un refus du serveur
  garde son message d'avant, sans panneau. « Sur la TV » passe par `openPlayerOnTv` : le drapeau
  `castOnOpen` (jamais persisté) demande au lecteur de lancer son propre parcours Cast à
  l'ouverture (`shouldStartCastOnOpen`) ; le panneau précharge le SDK pour que la demande de
  session tienne dans l'activation de l'appui ; sur Apple (AirPlay), le lecteur s'ouvre
  normalement. La livraison 2 — robot, carter, afficheur et vidéo de 8 s, avec le lot 3 — viendra
  s'insérer entre l'attente et le panneau.
- **« Mon compte » et les critiques** (`KioskAccount`, `KioskReview`, spec
  `docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md`). « Compte » ouvre l'écran à tout moment, sans avoir à
  louer : crédits, locations en cours, **tout l'historique** (rendu / expiré / terminée, rembobiné, rendu en avance,
  critique). La règle des critiques est **au serveur** (`lib/review-eligibility.ts`, renvoyée par `/api/me` →
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
que les cas qui cassent le player sont les buckets minoritaires : un film sans VF force le snap de
piste audio, un film sans sous-titre FR celui des sous-titres. Le tirage est déterministe (haché sur
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
| `tests/domain/` | Audits figés en régressions (sécurité, performance, UX/compat) + cohérence des types + borne de location (`kiosk-logic`, `kiosk-wiring`), règles de compte, tarif, dates du serveur |
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

**Dispo VF/VO = le fichier TRANSCODÉ** — la version réellement jouable est
`file_path_v{f,o}_transcoded` (c'est ce dont `streaming_urls` et les symlinks se servent), jamais
`file_path_v*` ni `radarr_v*_id` (colonnes mortes). Ça se teste désormais en local : le seed pose une
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

## Skills

- `threejs-webgpu-architect` — architecture Three.js/R3F, performance, photoréalisme, assets
- `webgpu-pure` — WebGPU pur (sans Three.js), WGSL, pipelines, post-processing
- `webgpu-canvas-text` — texte dans une scène WebGPU via `CanvasTexture` (Troika est incompatible WebGPU)
