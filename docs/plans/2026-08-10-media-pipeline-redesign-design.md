# Refonte de la chaîne download → transcode → catalogue

**Date** : 2026-08-10
**Statut** : design validé (décisions ci-dessous), plan d'implémentation à suivre

## Problème

Le modèle actuel télécharge des releases **VF et VO séparées** via **deux instances Radarr** (`radarr-vo`, `radarr-vf`). Défauts :
- Chasse aux VF difficiles à trouver.
- Aucune garantie de synchro entre une VF et la VO correspondante.
- Sous-titres censés être gérés par Bazarr, jamais setup → **`subtitle_path` toujours NULL**, aucun sous-titre servi aujourd'hui (`lib/radarr-poller.ts:42,50` ne passe jamais `subtitle_path`).

## Cible

Récupérer des **releases MKV uniques** contenant VF + VO + subs EN/FR (plus faciles à trouver), et **produire localement** : une VF, une VO, des subs — tout synchro, tout propre. Une **seule instance Radarr** (`radarr.lazone.at`) reste le gestionnaire de téléchargement.

Nouveau flux :

```
Radarr (unique) télécharge un MKV
        │
        ▼  poller détecte hasFile
[processFilm] (in-process, container app)
  1. ffprobe local           → identifie pistes audio VF/VO + subs EN/FR
  2. backup MKV              → /mnt/backup/zone-club/<dossier-radarr>/original.mkv
  3. transcode vidéo (GPU)    → upload MKV au service de Pablo (audio = VO) → vo.mp4
  4. mux VF local (CPU)       → vidéo(copy de vo.mp4) + audio VF ré-encodée AAC → vf.mp4
  5. extraction subs (local)  → sub.fr.vtt/.srt, sub.en.vtt/.srt (subs image → flag)
  6. écrit DB (paths + subs), is_available=1
  7. supprime le MKV de la library Radarr
  8. Radarr API: monitored=false  ← "verrou" : reste catalogué, plus de re-recherche
```

Sortie unique : `/data/big-boi/zone-club/films/<dossier-radarr>/` contenant `vo.mp4`, `vf.mp4`, `sub.fr.vtt`, `sub.fr.srt`, `sub.en.vtt`, `sub.en.srt`.

## Décisions validées

| # | Décision | Choix |
|---|---|---|
| 1 | Produire VF + VO à partir d'un job GPU unique | **1 job GPU (vidéo) + mux audio VF en local** (upload MKV ×1, pas ×2) |
| 2 | Déclencheur post-download | **Polling** (on garde le `radarr-poller` existant, adapté) |
| 3 | Périmètre subs | **Texte → WebVTT ET SRT** ; subs image (PGS/VOBSUB) = flag/log, pas d'OCR |
| 4 | Détection VO | **`original_language` TMDB + tags de langue** (un film japonais a une VO `jpn`) |
| 5 | Migration | **Vider tout de suite** ; un script/endpoint `refresh` permet de tester sur 1-2 films avant le bulk |
| 6 | Où tourne le traitement | **In-process dans le container `app`** + binds (library Radarr, `/films`, `/mnt/backup` en `rshared`) |
| 7 | Identité Radarr en DB | **Nouvelle colonne `radarr_id`** ; `radarr_vo_id`/`radarr_vf_id` dépréciées (rollback) |

## Le service de transcode de Pablo — contraintes

Source : `https://transcode.agi-so.fr/agents.md`.

- **Entrée** : fichier **uploadé** (multipart `file`), pas d'URL/chemin. Max **12 Go**. → on upload le MKV entier.
- **Sortie** : **UNE piste vidéo + UNE piste audio** → un seul **MP4/AAC**. Sélection audio via `audio_stream` (index numérique).
- **N'extrait PAS les sous-titres.** → extraction subs = **local (ffmpeg)**.
- **Auth** : **HTTP Basic** confirmé (`curl -u "$TRANSCODE_API_AUTH"`). Env `TRANSCODE_API_AUTH=user:password` → header `Authorization: Basic base64(user:password)`. (Clé pas encore reçue de Pablo.)
- **API** : `POST /jobs` (form-data : `file`, `target_codec=h264_nvenc`, `target_height=1080`, `preset`, `cq`/`target_bitrate`, `audio_stream`) → `{id,status}` ; `GET /jobs/{id}` (poll 2-5s, `status: queued→running→done|failed`) ; `GET /jobs/{id}/output` (télécharge le MP4, 409 si pas prêt) ; `DELETE /jobs/{id}`.
- Cold start ~1s après 30 min d'idle ; 3 jobs concurrents serveur ; retry sur 502/503.

**Conséquence architecturale** : le service ne fait que le **gros de la vidéo (GPU)**. Toute l'intelligence (identification pistes/langues, extraction subs, mux VF, backup, nommage) est **locale**.

## Identification des pistes (ffprobe local)

`ffprobe -show_streams` sur le MKV. Pour chaque stream : `codec_type`, `codec_name`, `tags.language` (ISO 639-2), `index`.

- **Audio VF** = piste audio avec `language ∈ {fre, fra, fr}`.
- **Audio VO** = piste audio avec `language == map639_1to2(original_language)` (ex : `en→eng`, `ja→jpn`, `ko→kor`…). Fallbacks : première audio non-française, sinon première audio.
- **Subs texte** = `codec_name ∈ {subrip, ass, ssa, mov_text, webvtt}` avec `language ∈ {fre/fra/fr}` et `{eng/en}`.
- **Subs image** = `codec_name ∈ {hdmv_pgs_subtitle, dvd_subtitle, dvb_subtitle}` → **flag** (log + `transcode_error`-like warning), pas d'extraction.

Table de mapping ISO 639-1 → 639-2 nécessaire (petit dict couvrant les langues courantes ; fallback : garder la valeur telle quelle).

## Étape transcode + mux (décision #1)

1. **Job GPU** : `POST /jobs` avec `file=<mkv>`, `target_codec=h264_nvenc`, `target_height=1080`, `preset=p4` (qualité) ou `p1`+`target_bitrate` (batch rapide), `audio_stream=<index VO>`. Poll → download → `films/<dir>/vo.mp4` (vidéo H.264 + audio VO AAC).
2. **Mux VF local** (ffmpeg CPU, léger) :
   ```
   ffmpeg -i films/<dir>/vo.mp4 -i <mkv> \
     -map 0:v:0 -map 1:a:<index VF> \
     -c:v copy -c:a aac -b:a 192k -movflags +faststart \
     films/<dir>/vf.mp4
   ```
   La vidéo est **copiée** (identique à la VO), seule l'audio VF est ré-encodée → **synchro garantie**.
3. **Subs local** : par piste texte,
   ```
   ffmpeg -i <mkv> -map 0:s:<index> films/<dir>/sub.<lang>.srt
   ffmpeg -i <mkv> -map 0:s:<index> films/<dir>/sub.<lang>.vtt
   ```

Si le film n'a **pas** de VF dans le MKV → `vf.mp4` absent, seule la VO servie (le player choisira). Si pas de VO distincte (film déjà en français) → VO = VF.

## "Verrou" Radarr

Pas de verrou natif. Pattern retenu : après succès complet, `PUT /api/v3/movie/{radarr_id}` avec `monitored:false`.
- Film **traité** = unmonitored → reste catalogué/visible, Radarr ne relance **plus** de recherche.
- Film **jamais téléchargé / échec** = reste monitored + missing → visible dans la liste "Missing" de Radarr, re-déclenchable à la main. **C'est la file d'attente des films à chasser.**
- En cas d'**échec** de traitement : on ne supprime pas le MKV et on ne unmonitor pas (retriable via `refresh`).

## Modèle de données (migrations additives, mécanisme `db.ts` ALTER idempotent)

Nouvelles colonnes `films` :
- `radarr_id INTEGER` — instance unique.
- `original_language TEXT` — code ISO 639-1 depuis TMDB (pour détection VO).
- `media_dir TEXT` — nom du dossier Radarr (sous-dossier commun sous `/films`).
- `subtitle_fr_vtt TEXT`, `subtitle_fr_srt TEXT`, `subtitle_en_vtt TEXT`, `subtitle_en_srt TEXT` — chemins relatifs (sous `/films`).
- (réutilise) `file_path_vo_transcoded` / `file_path_vf_transcoded` — repointés vers `<media_dir>/vo.mp4` et `<media_dir>/vf.mp4`, résolus contre le **nouveau** mount unique `/media/films`.
- (réutilise) `transcode_status` / `transcode_progress` / `transcode_error` — machine à états étendue : `probing → backing_up → transcoding_remote → muxing → subtitles → done | error | image_subs_flagged`.

`subtitle_path` (legacy, jamais peuplé) : conservé, plus utilisé ; le player exposera `subtitle_fr_vtt`/`subtitle_en_vtt`.

`original_language` : ajouter à `TmdbMovie` (`lib/tmdb.ts:5`), `fetchFullMovieData` (retour), et à l'INSERT de `addFilmFromTmdb` (`lib/films.ts:121-143`). Backfill des films existants via `refresh`/one-off.

## Infrastructure (docker-compose + NixOS)

### Arborescence disque
- `/data/big-boi/zone-club/library/` — **root folder Radarr unique** (MKV bruts, supprimés après traitement).
- `/data/big-boi/zone-club/films/<dossier-radarr>/` — sorties transcodées (vo.mp4, vf.mp4, subs). App **rw**, storage **ro**.
- `/mnt/backup/zone-club/<dossier-radarr>/original.mkv` — backup MKV (SSHFS Hetzner).

### docker-compose.yml
- **Supprimer** le service `radarr-vf` (+ `radarr-vf-config`).
- **Renommer** `radarr-vo` → `radarr` : host `radarr.${DOMAIN}` (= radarr.lazone.at), root folder `/movies` → `/data/big-boi/zone-club/library`. Réutiliser `radarr-vo-config` (les filtres seront reconfigurés par l'utilisateur).
- **Quality profile** : `addMovie` a le `qualityProfileId` **hardcodé à `6`** (`lib/radarr.ts:90`). → rendre configurable via `RADARR_QUALITY_PROFILE_ID` (l'utilisateur fournit l'id du profil "release MKV combinée").
- **`app`** : ajouter les binds
  - `/data/big-boi/zone-club/library:/media/library:rw`
  - `/data/big-boi/zone-club/films:/media/films:rw`
  - `/mnt/backup:/media/backup:rw` **avec propagation `rshared`** (voir risque SSHFS)
  - env : retirer `RADARR_VF_*`, renommer `RADARR_VO_*` → `RADARR_URL`/`RADARR_API_KEY` (`http://radarr:7878`), ajouter `TRANSCODE_API_URL`, `TRANSCODE_API_AUTH`, `MEDIA_FILMS_PATH=/media/films`, `MEDIA_LIBRARY_PATH=/media/library`, `MEDIA_BACKUP_PATH=/media/backup/zone-club`. `depends_on: [radarr]`.
- **`storage`** : monter `/data/big-boi/zone-club/films:/media/films:ro` (sert vo.mp4/vf.mp4/subs).
- **`cinema-stream`** et **`zone-discord-bot`** ⚠️ (TypeScript, logique dans `src/playlist.ts` de chacun) : les deux résolvent `join(FILMS_VF_ROOT, file_path_vf_transcoded ?? file_path_vf)` (`cinema-stream/src/playlist.ts:74-75`, `zone-discord-bot/src/playlist.ts:61-64`) et **filtrent sur `WHERE file_path_vf IS NOT NULL`** (`cinema-stream:60-63`, `discord:41-44`). Aucun filtre `is_available`, aucun ref radarr. `FILMS_VF_ROOT` default `/media/films-vf` (`config.ts:8` des deux).
  - **PIÈGE MIGRATION** : si on vide `file_path_vf`, leur `WHERE file_path_vf IS NOT NULL` → **0 film sélectionné** (cinema live + discord cassés silencieusement).
  - **Changement couplé requis** (les deux services) : (a) query → `WHERE file_path_vf_transcoded IS NOT NULL` ; (b) ajouter env `FILMS_ROOT=/media/films` et résoudre `file_path_vf_transcoded` contre lui ; (c) monter `/data/big-boi/zone-club/films` dans les deux containers. Le fallback `file_path_vf` (ancien root) devient mort après migration → on peut simplifier à `join(FILMS_ROOT, file_path_vf_transcoded)`.

### NixOS (`/etc/nixos/docker-services.nix`)
- `mkCompose` de zone-club : ajouter `/mnt/backup` (et `/data/big-boi`) à `mounts` → `RequiresMountsFor` déclenche l'automount SSHFS **avant** le démarrage du container.

## Script / endpoint `refresh`

But : (re)traiter des films dont les chemins sont vides, sans tout refaire à la main. Deux surfaces :
- **CLI** `npm run refresh -- --film <id|tmdb>` ou `--all-empty`.
- **Route admin** `POST /api/admin/films/[filmId]/refresh` (+ variante bulk).

Logique par film cible :
1. S'il existe déjà un MKV dans la library Radarr pour ce film → **enqueue `processFilm` direct**.
2. Sinon → s'assurer que le film est dans le Radarr unique (`addMovie` → `radarr_id`, `monitored:true`) + `MoviesSearch`. Le poller traitera quand le MKV atterrit.

`--all-empty` cible : `radarr_id`/à (re)télécharger, `file_path_vo_transcoded IS NULL`. C'est **le vecteur de migration** : on vide tout, puis on lance `--film X` pour valider 1-2 films, puis `--all-empty` pour le bulk.

## Migration (ordre d'exécution)

1. Migrations DB (nouvelles colonnes) via `db.ts`.
2. Backfill `original_language` (TMDB) pour les films existants.
3. **Vider** `file_path_vf`, `file_path_vo`, `file_path_vo_transcoded`, `file_path_vf_transcoded`, subs, `is_available=0` pour tous les films (anciens `radarr_vo_id/vf_id` deviennent obsolètes).
4. Déployer le nouveau docker-compose (radarr unique) + rebuild NixOS.
5. `refresh --film <un_film>` → valider bout-en-bout (add → search → download → process → lecture VF/VO/subs).
6. `refresh --all-empty` → bulk.

## Risques / points ouverts

- **SSHFS automount dans un container** : bind de `/mnt/backup` (fuse/automount) → nécessite propagation `rshared` + `RequiresMountsFor`. Si l'automount se démonte (idle) pendant que le container tourne, le bind peut devenir périmé. Mitigation : `rshared` + garder le mount chaud, ou fallback backup en 2 temps (staging local → rsync host). **À tester tôt.**
- **Auth service transcode** : le doc dit Basic ; confirmer avec la clé de Pablo (format `user:pass` vs token).
- **Upload 12 Go** : timeout/fiabilité de l'upload multipart depuis le container ; prévoir retry + timeout large.
- **cinema-stream / zone-discord-bot** : dépendances sur `file_path_vf_transcoded` + `FILMS_VF_ROOT` → casse si non repointés. Vérifier leur code de résolution.
- **Intégration player multi-subs** (EN/FR, sélection piste) : **hors périmètre pour l'instant** — on stocke les chemins, l'UI player viendra en dernier (le symlink `subs_fr.vtt` existant reste compatible).

## Hors périmètre (plus tard)

- UI du lecteur vidéo pour sélectionner/afficher les subs EN/FR.
- Retrait définitif des anciens dossiers `films-vo`/`films-vf` (après migration + mise à jour cinema-stream/discord).
- Suppression de Bazarr (devenu inutile) — à décider.
