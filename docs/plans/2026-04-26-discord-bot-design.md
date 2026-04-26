# Zone Club — Diffusion Discord 24/7

**Date** : 2026-04-26
**Statut** : design validé, implémentation en cours

## Concept

Une "chaîne TV" virtuelle qui diffuse en boucle continue tous les films de la DB ayant une VF. Comme si Zone Club Cinéma émettait depuis le `PLAYLIST_START` (ex: `1993-06-11`) à minuit Europe/Paris. À tout moment, on peut tomber sur ce qui passe en cours, en plein milieu si besoin. Quand un film se termine, le suivant s'enchaîne. Boucle infinie.

## Pivot d'architecture

**Première piste écartée** : un bot Discord qui streame la vidéo lui-même via `@dank074/discord-video-stream`. Recherche post-design : la lib nécessite un **selfbot** (user token), pas un vrai bot. Discord bloque côté serveur l'envoi vidéo depuis les bots officiels. Risque de ban du compte user. Abandon.

**Architecture retenue** : on scinde la responsabilité.

- Un **serveur HLS** (`cinema-stream`) sur la machine héberge le flux 24/7. Il calcule la position courante dans la playlist et expose un stream HLS via le lighttpd existant.
- Un **vrai bot Discord** (`zone-discord-bot`) maintient le statut du voice channel et l'activity du bot (le film qui passe), sans rien streamer. Cas d'usage standard, no ToS.
- Les **utilisateurs opérateurs** (Damien, Pablo) ingèrent le HLS sur leur machine via une caméra virtuelle (`v4l2loopback` sur Linux, OBS sur macOS), puis allument la "webcam" dans Discord. Pas de selfbot, c'est juste un humain qui partage sa caméra — ce que Discord supporte officiellement.

## Architecture

```
┌─────────────────────────── poweredge ───────────────────────────┐
│                                                                 │
│  cinema-stream/  (Node + ffmpeg)                                │
│   ├─ Lit la DB (films VF, ordre id)                             │
│   ├─ ffprobe au boot pour cache durées                          │
│   ├─ Calcule offset courant (now - PLAYLIST_START) % total      │
│   ├─ Génère playlist concat ffmpeg avec inpoint sur film 0      │
│   └─ ffmpeg long-running → HLS dans /media/public/symlinks/     │
│                                       cinema-live/*.{m3u8,ts}   │
│                                                                 │
│  zone-storage (lighttpd, déjà existant)                         │
│   └─ sert /cinema-live/live.m3u8 sur ${STORAGE_SUBDOMAIN}       │
│                                                                 │
│  zone-discord-bot/  (Node + discord.js)                         │
│   ├─ Vrai bot officiel                                          │
│   ├─ Lit la même DB                                             │
│   ├─ Calcule la position courante (même algo que cinema-stream) │
│   └─ Update toutes les 60s :                                    │
│       ├─ Voice Channel Status : "🎬 Robocop (1987) — 23:12/..." │
│       └─ Bot Activity : "Watching Robocop (1987)"               │
└─────────────────────────────────────────────────────────────────┘
                  │
                  │ HTTPS HLS
                  ▼
┌────────── machine cliente (Damien, Pablo, ou Raspi) ────────────┐
│                                                                 │
│  Linux : scripts/cinema-cam.sh                                  │
│   ├─ modprobe v4l2loopback video_nr=10                          │
│   └─ ffmpeg -i HLS_URL -f v4l2 /dev/video10                     │
│   → systemd user unit, headless                                 │
│                                                                 │
│  macOS : OBS Studio                                             │
│   ├─ Media Source = HLS URL                                     │
│   └─ Tools → Start Virtual Camera                               │
│                                                                 │
│  Discord                                                        │
│   ├─ Settings → Voice → Camera = "Zone Club Cinéma"             │
│   └─ Voice channel → Share Camera                               │
└─────────────────────────────────────────────────────────────────┘
```

## Algorithme de position

**Cache des durées en DB** : la table `films` reçoit une nouvelle colonne `duration_sec REAL`. Probing ffprobe lazy uniquement pour les films qui ne l'ont pas encore en DB :

- `cinema-stream` (DB :rw) : au boot, pour chaque film avec `duration_sec IS NULL`, ffprobe + UPDATE. Premier boot : long (~5min pour 250 films). Boots suivants : instant.
- `zone-discord-bot` (DB :ro) : au boot, ne lit que les films avec `duration_sec IS NOT NULL`. Si certains manquent (cinema-stream pas encore booté), il les ignore et continue avec ce qu'il a.

```ts
// PLAYLIST_START = "1993-06-11" → epoch UTC du 1993-06-11 00:00 Europe/Paris
const films = db
  .prepare(`SELECT id, title, release_year, file_path_vf,
                   file_path_vf_transcoded, duration_sec
            FROM films
            WHERE file_path_vf IS NOT NULL
            ORDER BY id`)
  .all();

// cinema-stream uniquement : probe + write si manquant
for (const f of films) {
  if (f.duration_sec == null) {
    f.duration_sec = await probeDuration(f.absolutePath);
    db.prepare("UPDATE films SET duration_sec = ? WHERE id = ?").run(f.duration_sec, f.id);
  }
}
const totalSec = films.reduce((acc, f) => acc + f.duration_sec, 0);

function currentPosition() {
  const elapsed = (Date.now() / 1000) - startEpoch;
  const positionInLoop = ((elapsed % totalSec) + totalSec) % totalSec;
  let acc = 0;
  for (const film of films) {
    if (positionInLoop < acc + film.durationSec) {
      return { film, offsetSec: positionInLoop - acc };
    }
    acc += film.durationSec;
  }
}
```

## Pipeline HLS (cinema-stream)

**Stratégie** : un seul ffmpeg long-running qui consomme un fichier de concat ffmpeg listant les films N fois (assez pour des semaines de programmation). Le premier film a `inpoint = offsetSec`. Quand la liste est consommée, on regénère et on relance.

```
# concat.txt (généré dynamiquement au boot)
ffconcat version 1.0
file '/media/films-vf/Robocop.fr.mkv'
inpoint 1234.5
file '/media/films-vf/Aliens.fr.mkv'
file '/media/films-vf/Predator.fr.mkv'
... (les mêmes films répétés N fois pour ~1 semaine de programmation)
```

```bash
ffmpeg -re \
  -f concat -safe 0 -i /tmp/concat.txt \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls \
  -hls_time 4 \
  -hls_list_size 6 \
  -hls_flags delete_segments+omit_endlist+independent_segments \
  /media/public/symlinks/cinema-live/live.m3u8
```

- Latence ~10-20s (4s par segment × 6 segments dans la fenêtre)
- `delete_segments` purge les vieux .ts → pas d'accumulation disque
- Quand ffmpeg termine la concat list (après des semaines), un watcher Node relance avec une nouvelle liste

## Status bot

`zone-discord-bot/` — process Node minimal :

- `discord.js` v14 (vrai bot)
- `better-sqlite3` (lecture DB)
- Au boot : login, fetch durations via ffprobe, connect au voice channel (présence permanente)
- Loop `setInterval(60_000)` :
  - Calcule `currentPosition()`
  - PATCH `/channels/{id}/voice-status` → `🎬 {title} ({year}) — {hh:mm:ss}/{hh:mm:ss}`
  - `client.user.setActivity({ type: ActivityType.Watching, name: "{title} ({year})" })`

Pas de gestion de présence / streaming. Le bot vit indépendamment du fait que des humains regardent ou pas — la chaîne "diffuse" en continu.

## Réutilisation lighttpd

Le service `zone-storage` existe déjà avec :
- `document-root = /media/public/symlinks`
- Volume named `media_public:/media/public:ro`
- CORS `*`
- mime types vidéo (mp4, webm, vtt, srt)

**Ajouts nécessaires** :
- 2 mime types HLS dans `lighttpd.conf` :
  - `.m3u8` → `application/vnd.apple.mpegurl`
  - `.ts` → `video/mp2t`
- `cinema-stream` monte `media_public:/media/public:rw` pour écrire les segments dans `/media/public/symlinks/cinema-live/`

URL finale : `https://${STORAGE_SUBDOMAIN}.${DOMAIN}/cinema-live/live.m3u8`

## Variables d'environnement

```
DISCORD_BOT_TOKEN       # token du vrai bot (status only)
DISCORD_GUILD_ID        # serveur Discord
DISCORD_VOICE_CHANNEL_ID # voice channel à statuser
PLAYLIST_START          # ex: 1993-06-11 (interprété 00:00 Europe/Paris)
```

## Layout fichiers

```
zone-club/
├── cinema-stream/
│   ├── package.json          # deps: better-sqlite3, fluent-ffmpeg
│   ├── tsconfig.json
│   ├── Dockerfile            # node:22-slim + ffmpeg
│   └── src/
│       ├── index.ts          # boot + supervisor loop
│       ├── config.ts         # parse env vars (PLAYLIST_START → epoch)
│       ├── playlist.ts       # load films, ffprobe, currentPosition()
│       └── ffmpeg-runner.ts  # gère la pipeline ffmpeg + concat list
├── zone-discord-bot/
│   ├── package.json          # deps: discord.js, better-sqlite3, fluent-ffmpeg
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── src/
│       ├── index.ts
│       ├── config.ts         # même parser que cinema-stream
│       ├── playlist.ts       # même algo que cinema-stream
│       └── status.ts         # update voice channel status + activity
├── scripts/
│   ├── cinema-cam.sh         # client Linux : v4l2loopback + ffmpeg
│   └── cinema-cam.service    # systemd user unit (template)
├── docker-compose.yml        # +2 services
├── lighttpd.conf             # +2 mime types HLS
├── package.json              # +npm scripts bot:*, cinema:*
├── DISCORD_SETUP.md          # setup du bot Discord
└── CINEMA_SETUP.md           # setup client (Linux/Mac/Raspi)
```

## Commandes npm

```json
"bot:up":          "docker compose up -d zone-discord-bot",
"bot:down":        "docker compose down zone-discord-bot",
"bot:restart":     "docker compose restart zone-discord-bot",
"bot:rebuild":     "docker compose up -d --build zone-discord-bot",
"bot:logs":        "docker compose logs -f zone-discord-bot",
"cinema:up":       "docker compose up -d cinema-stream",
"cinema:down":     "docker compose down cinema-stream",
"cinema:restart":  "docker compose restart cinema-stream",
"cinema:rebuild":  "docker compose up -d --build cinema-stream",
"cinema:logs":     "docker compose logs -f cinema-stream"
```

## Risques connus

- **Continuité HLS au redémarrage du concat** : quand ffmpeg termine la longue concat list (semaines), il s'arrête. Un watcher Node détecte la fin et relance avec une nouvelle list — il y aura un micro-gap (1-3s). Acceptable car ça arrive rarement.
- **Drift de position** : durations TMDB en minutes vs durations réelles fichiers. On utilise ffprobe (réel) pour éviter le drift. Cache persistant en DB (colonne `films.duration_sec`).
- **Films ajoutés à la DB** : si un film est ajouté en cours de route, la playlist ne le voit pas avant le prochain boot du `cinema-stream`. Acceptable pour V1 — on relance le service à chaque ajout important. Au prochain boot, seuls les nouveaux films sont probed.
- **Bandwidth client** : HLS 1080p ~5 Mbps download. Tous les contrats fibre français passent.
