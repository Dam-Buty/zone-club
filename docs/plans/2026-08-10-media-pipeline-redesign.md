# Refonte chaîne download → transcode → catalogue — Plan d'implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Passer d'un modèle 2× Radarr (VF/VO séparées) à un modèle Radarr unique qui télécharge des MKV combinés (VF+VO+subs), traités localement en une VO.mp4 + une VF.mp4 + subs EN/FR synchro, servis par le vidéoclub.

**Architecture:** Radarr unique (`radarr.lazone.at`) télécharge un MKV → le `radarr-poller` détecte `hasFile` → `processFilm` (in-process, container `app`) : ffprobe local pour identifier pistes VF/VO + subs EN/FR → backup MKV vers `/mnt/backup/zone-club` → 1 job vidéo GPU sur `transcode.agi-so.fr` (audio=VO) → mux VF local (ffmpeg CPU) → extraction subs local (VTT+SRT) → écrit la DB → supprime le MKV → passe le film `monitored:false` dans Radarr ("verrou"). Sortie unique : `/data/big-boi/zone-club/films/<dossier-radarr>/`.

**Tech Stack:** Next.js 15 / Node 22 / better-sqlite3 / fluent-ffmpeg (local) / API HTTP `transcode.agi-so.fr` (Basic auth) / Radarr API v3 / Docker Compose / NixOS.

**Design de référence:** `docs/plans/2026-08-10-media-pipeline-redesign-design.md` (à lire d'abord).

**Conventions test:** unités pures via `node --test` sur `tests/**/*.test.mjs` déjà câblé (`npm run test:phase`). Les nouveaux helpers pures sont écrits en TS mais testés via des `.test.mjs` qui importent des fonctions exportées **sans dépendance runtime** (pas de `better-sqlite3`/ffmpeg) — on isole la logique pure dans des modules importables par `tsx`. Commande unité: `npx tsx --test tests/media/*.test.ts`. Vérifier d'abord que `npx tsx --test` fonctionne (Task 0).

**Règle Git projet:** commits fréquents, un par step logique. Brancher depuis `main` à jour.

---

## Phase 0 — Préparation

### Task 0: Branche + vérif tooling test

**Steps:**
1. `git checkout main && git pull --rebase` (vérifier à jour).
2. `git checkout -b media-pipeline-redesign`.
3. Vérifier que le runner de test TS marche : créer `tests/media/smoke.test.ts` :
   ```ts
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   test('smoke', () => assert.equal(1 + 1, 2));
   ```
4. Run: `npx tsx --test tests/media/smoke.test.ts` → Expected: `pass 1`.
   - Si échec (`--test` non supporté par la version de tsx) : fallback `node --import tsx --test tests/media/smoke.test.ts`. Noter la commande qui marche et l'utiliser partout ensuite.
5. Supprimer `tests/media/smoke.test.ts`.
6. Commit: `chore: branche media-pipeline-redesign`.

---

## Phase 1 — Helpers purs (TDD)

### Task 1: Mapping ISO 639-1 → 639-2 (détection VO)

**Files:**
- Create: `lib/media/iso639.ts`
- Test: `tests/media/iso639.test.ts`

**Step 1 — test qui échoue** (`tests/media/iso639.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iso639_1to2, isFrench } from '../../lib/media/iso639.ts';

test('mappe les langues courantes 639-1 → 639-2/B', () => {
  assert.equal(iso639_1to2('en'), 'eng');
  assert.equal(iso639_1to2('ja'), 'jpn');
  assert.equal(iso639_1to2('ko'), 'kor');
  assert.equal(iso639_1to2('fr'), 'fre');
  assert.equal(iso639_1to2('it'), 'ita');
  assert.equal(iso639_1to2('es'), 'spa');
  assert.equal(iso639_1to2('de'), 'ger');
});

test('inconnu → renvoie la valeur telle quelle', () => {
  assert.equal(iso639_1to2('xx'), 'xx');
  assert.equal(iso639_1to2(''), '');
});

test('isFrench reconnaît fre/fra/fr', () => {
  for (const c of ['fre', 'fra', 'fr', 'FRE', 'French']) assert.equal(isFrench(c), true);
  for (const c of ['eng', 'en', '']) assert.equal(isFrench(c), false);
});
```

**Step 2 — run, doit échouer:** `npx tsx --test tests/media/iso639.test.ts` → FAIL (module introuvable).

**Step 3 — implémentation** (`lib/media/iso639.ts`):
```ts
// ISO 639-1 (2 lettres, TMDB) → ISO 639-2/B (3 lettres, tags MKV/ffprobe).
// Couvre les langues de films courantes ; fallback = valeur inchangée.
const MAP_1_TO_2: Record<string, string> = {
  en: 'eng', fr: 'fre', ja: 'jpn', ko: 'kor', zh: 'chi', it: 'ita',
  es: 'spa', de: 'ger', ru: 'rus', pt: 'por', sv: 'swe', da: 'dan',
  no: 'nor', fi: 'fin', nl: 'dut', pl: 'pol', tr: 'tur', ar: 'ara',
  hi: 'hin', th: 'tha', cs: 'cze', hu: 'hun', el: 'gre', he: 'heb',
  uk: 'ukr', ro: 'rum', is: 'isl',
};

export function iso639_1to2(code: string): string {
  if (!code) return code;
  return MAP_1_TO_2[code.toLowerCase()] ?? code;
}

const FRENCH = new Set(['fre', 'fra', 'fr', 'french', 'français', 'francais']);
export function isFrench(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return FRENCH.has(lang.toLowerCase());
}

const ENGLISH = new Set(['eng', 'en', 'english', 'anglais']);
export function isEnglish(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return ENGLISH.has(lang.toLowerCase());
}
```

**Step 4 — run, doit passer:** `npx tsx --test tests/media/iso639.test.ts` → PASS.

**Step 5 — commit:** `feat(media): mapping ISO 639-1→639-2 + helpers langue`.

---

### Task 2: Identification des pistes depuis ffprobe

**Files:**
- Create: `lib/media/identify-tracks.ts`
- Test: `tests/media/identify-tracks.test.ts`

Type d'entrée = tableau de streams ffprobe (forme `{ index, codec_type, codec_name, tags?: { language?, title? } }`). Fonction pure, aucune I/O.

**Step 1 — test** (`tests/media/identify-tracks.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyTracks } from '../../lib/media/identify-tracks.ts';

const streams = [
  { index: 0, codec_type: 'video', codec_name: 'hevc' },
  { index: 1, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'fre' } },
  { index: 2, codec_type: 'audio', codec_name: 'ac3',  tags: { language: 'eng' } },
  { index: 3, codec_type: 'subtitle', codec_name: 'subrip',            tags: { language: 'fre' } },
  { index: 4, codec_type: 'subtitle', codec_name: 'subrip',            tags: { language: 'eng' } },
  { index: 5, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } },
];

test('film anglophone: VO=eng, VF=fre, subs texte fr+en, flag PGS', () => {
  const r = identifyTracks(streams, 'en');
  assert.equal(r.voAudioIndex, 2);
  assert.equal(r.vfAudioIndex, 1);
  assert.deepEqual(r.textSubs.map(s => [s.lang, s.streamIndex]), [['fr', 3], ['en', 4]]);
  assert.equal(r.imageSubsFlagged, true);
});

test('film japonais: VO=jpn même si eng présent', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
    { index: 3, codec_type: 'audio', codec_name: 'aac', tags: { language: 'fre' } },
  ];
  const r = identifyTracks(s, 'ja');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, 3);
});

test('pas de VF: vfAudioIndex null, VO fallback première audio', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
  ];
  const r = identifyTracks(s, 'en');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, null);
});

test('audio sans tags: VO=première audio, pas de VF', () => {
  const s = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'audio', codec_name: 'aac' },
  ];
  const r = identifyTracks(s, 'en');
  assert.equal(r.voAudioIndex, 1);
  assert.equal(r.vfAudioIndex, null);
});
```

**Step 2 — run:** FAIL.

**Step 3 — implémentation** (`lib/media/identify-tracks.ts`):
```ts
import { iso639_1to2, isFrench, isEnglish } from './iso639';

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  tags?: { language?: string; title?: string };
}

export interface SubTrack { lang: 'fr' | 'en'; streamIndex: number; codec: string; }

export interface TrackIdentification {
  voAudioIndex: number | null;
  vfAudioIndex: number | null;
  textSubs: SubTrack[];        // ordre: fr d'abord, puis en
  imageSubsFlagged: boolean;   // au moins une piste sub image détectée
}

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const IMAGE_SUB_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'pgssub']);

export function identifyTracks(streams: ProbeStream[], originalLanguage: string | null): TrackIdentification {
  const audio = streams.filter(s => s.codec_type === 'audio');
  const subs = streams.filter(s => s.codec_type === 'subtitle');

  const voTag = iso639_1to2(originalLanguage || '');

  // VF = première audio taggée français
  const vf = audio.find(s => isFrench(s.tags?.language));
  // VO = première audio dans la langue originale ; fallback = première audio non-française ; fallback = première audio
  const voByLang = voTag ? audio.find(s => (s.tags?.language || '').toLowerCase() === voTag.toLowerCase()) : undefined;
  const voNonFr = audio.find(s => !isFrench(s.tags?.language));
  const vo = voByLang ?? voNonFr ?? audio[0];

  const textSubs: SubTrack[] = [];
  let imageSubsFlagged = false;
  for (const s of subs) {
    const codec = (s.codec_name || '').toLowerCase();
    const lang = s.tags?.language;
    if (IMAGE_SUB_CODECS.has(codec)) { imageSubsFlagged = true; continue; }
    if (!TEXT_SUB_CODECS.has(codec)) continue;
    if (isFrench(lang)) textSubs.push({ lang: 'fr', streamIndex: s.index, codec });
    else if (isEnglish(lang)) textSubs.push({ lang: 'en', streamIndex: s.index, codec });
  }
  // Dédup par langue (garde la première), ordre fr puis en
  const seen = new Set<string>();
  const dedup = textSubs.filter(s => (seen.has(s.lang) ? false : (seen.add(s.lang), true)));
  dedup.sort((a, b) => (a.lang === b.lang ? 0 : a.lang === 'fr' ? -1 : 1));

  return {
    voAudioIndex: vo ? vo.index : null,
    vfAudioIndex: vf ? vf.index : null,
    textSubs: dedup,
    imageSubsFlagged,
  };
}
```

**Step 4 — run:** PASS.

**Step 5 — commit:** `feat(media): identification pistes audio VF/VO + subs EN/FR depuis ffprobe`.

> ⚠️ Note d'implémentation pour plus tard: `audio_stream` du service et le `-map 0:a:N` de ffmpeg utilisent des index **relatifs au type** (Nième audio), alors que `stream.index` de ffprobe est **absolu**. `identifyTracks` renvoie l'index **absolu** (`stream.index`). Le module qui appelle devra convertir en index-relatif-audio quand nécessaire (position dans la liste `audio`). Ajouter dans `identifyTracks` aussi `voAudioOrdinal`/`vfAudioOrdinal` (position 0-based dans les pistes audio) pour éviter toute ambiguïté — étendre le test en conséquence.

---

### Task 3: Nom du dossier média depuis le chemin Radarr

**Files:**
- Create: `lib/media/media-dir.ts`
- Test: `tests/media/media-dir.test.ts`

**Step 1 — test:**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaDirFromMoviePath, sanitizeDirName } from '../../lib/media/media-dir.ts';

test('extrait le dossier Radarr du chemin du fichier film', () => {
  assert.equal(mediaDirFromMoviePath('/movies/Interstellar (2014)/Interstellar.2014.mkv'), 'Interstellar (2014)');
  assert.equal(mediaDirFromMoviePath('Blade Runner (1982)/br.mkv'), 'Blade Runner (1982)');
});

test('sanitize retire les caractères hostiles au FS mais garde () espaces', () => {
  assert.equal(sanitizeDirName('Amélie (2001)'), 'Amélie (2001)');
  assert.equal(sanitizeDirName('A/B:C*?'), 'A_B_C__');
});
```

**Step 2 — run:** FAIL.

**Step 3 — implémentation** (`lib/media/media-dir.ts`):
```ts
import { dirname, basename } from 'path';

// Radarr range chaque film dans un dossier "Titre (Année)". On réutilise ce nom
// comme sous-dossier commun sous /media/films.
export function mediaDirFromMoviePath(moviePath: string): string {
  return basename(dirname(moviePath));
}

export function sanitizeDirName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}
```

**Step 4 — run:** PASS.

**Step 5 — commit:** `feat(media): dérivation du dossier média depuis le chemin Radarr`.

---

## Phase 2 — Radarr instance unique

### Task 4: Migrations DB (colonnes additives)

**Files:**
- Modify: `lib/db.ts` (ajouter un bloc ALTER idempotent près des autres, cf. `lib/db.ts:52-64`)
- Modify: `lib/schema.sql:13-43` (documenter les nouvelles colonnes dans le CREATE — cohérence pour DB neuve)

**Step 1 — écrire la migration** dans `lib/db.ts` (nouveau bloc, style try/catch existant):
```ts
// --- Media pipeline redesign (2026-08) ---
const mediaCols: [string, string][] = [
  ['radarr_id', 'INTEGER'],
  ['original_language', 'TEXT'],
  ['media_dir', 'TEXT'],
  ['subtitle_fr_vtt', 'TEXT'],
  ['subtitle_fr_srt', 'TEXT'],
  ['subtitle_en_vtt', 'TEXT'],
  ['subtitle_en_srt', 'TEXT'],
];
for (const [col, type] of mediaCols) {
  try { db.exec(`ALTER TABLE films ADD COLUMN ${col} ${type} DEFAULT NULL`); } catch { /* existe déjà */ }
}
```

**Step 2 — mettre à jour `schema.sql`** : ajouter ces colonnes dans le `CREATE TABLE films` (avec commentaires) pour que les DB neuves les aient dès la création.

**Step 3 — vérifier** : `npx tsx -e "import('./lib/db.ts').then(()=>{const {db}=require('./lib/db');})"` n'est pas trivial (ESM). À la place, lancer un mini-script :
```
npx tsx -e "import('./lib/db.js').catch(()=>import('./lib/db.ts')).then(async m => { const info = m.db.prepare('PRAGMA table_info(films)').all(); console.log(info.map(c=>c.name).join(',')); })"
```
Expected: la sortie contient `radarr_id,original_language,media_dir,subtitle_fr_vtt,...`.
   - Simplification si l'inline pose souci: créer temporairement `scripts/_check-cols.ts` qui importe `db` et print `PRAGMA table_info`, `npx tsx scripts/_check-cols.ts`, puis le supprimer.

**Step 4 — commit:** `feat(db): colonnes radarr_id, original_language, media_dir, subtitles fr/en`.

---

### Task 5: Client Radarr unique + setMonitored + quality profile configurable

**Files:**
- Modify: `lib/radarr.ts` (réécriture ciblée)

**Contexte actuel** (`lib/radarr.ts`): 2 clients `radarrVO`/`radarrVF`, `addMovie` ajoute aux deux (retourne `{vo, vf}`), `qualityProfileId` hardcodé `6` (ligne 90), `getMovieStatus(id, 'vo'|'vf')`, `searchMovie(id, 'vo'|'vf')`.

**Changements:**
1. Un seul client `radarr = new RadarrClient(requireEnv('RADARR_URL','http://radarr:7878'), requireEnv('RADARR_API_KEY'))`.
2. `qualityProfileId` : lire `parseInt(process.env.RADARR_QUALITY_PROFILE_ID || '6', 10)` au lieu du littéral `6` (ligne 90).
3. Nouvelle méthode `setMonitored(radarrId, monitored)` :
   ```ts
   async setMonitored(radarrId: number, monitored: boolean): Promise<void> {
     const movie = await this.request(`/movie/${radarrId}`);           // GET
     await this.request(`/movie/${radarrId}`, {
       method: 'PUT',
       body: JSON.stringify({ ...movie, monitored }),
     });
   }
   ```
   (Radarr v3: `PUT /movie/{id}` attend l'objet movie complet.)
4. Exports module-level simplifiés (signatures **sans** le param `'vo'|'vf'`):
   - `addMovie(tmdbId, title): Promise<{ id: number }>` → ajoute une fois, retourne `{ id }`.
   - `getMovieStatus(radarrId): Promise<{ hasFile: boolean; movieFile?: { path: string } }>`.
   - `searchMovie(radarrId): Promise<void>`.
   - `setMonitored(radarrId, monitored): Promise<void>`.
   - Exporter aussi `radarr` (le client).
5. Retirer `radarrVO`, `radarrVF`, `RADARR_VO_*`, `RADARR_VF_*`.

**Step — vérif compile:** `npx tsc --noEmit` sur les fichiers touchés échouera là où les anciennes signatures sont appelées (`films.ts:161-162`, `radarr-poller.ts`) — c'est attendu, corrigé aux Tasks 6/8. Committer quand même ce module isolément.

**Commit:** `refactor(radarr): client unique + setMonitored + quality profile via env`.

---

### Task 6: `films.ts` — download unique + original_language + updateFilmMedia

**Files:**
- Modify: `lib/tmdb.ts` (exposer `original_language`)
- Modify: `lib/films.ts` (`triggerDownload`, `addFilmFromTmdb`, nouveau `updateFilmMedia`, `Film` interface)

**Step 1 — TMDB `original_language`:**
- `lib/tmdb.ts:5` interface `TmdbMovie` : ajouter `original_language: string;`.
- `fetchFullMovieData` (`lib/tmdb.ts:128-140`) : ajouter `original_language: movie.original_language` au retour.

**Step 2 — `addFilmFromTmdb`** (`lib/films.ts:121-143`) : ajouter `original_language` à la liste des colonnes INSERT et à `stmt.run(...)`.

**Step 3 — `triggerDownload`** (`lib/films.ts:155-165`) : remplacer le double-radarr par :
```ts
export async function triggerDownload(filmId: number): Promise<Film> {
  const film = getFilmById(filmId);
  if (!film) throw new Error('Film introuvable');
  const { id } = await addToRadarr(film.tmdb_id, film.title);
  db.prepare('UPDATE films SET radarr_id = ? WHERE id = ?').run(id, filmId);
  return getFilmById(filmId)!;
}
```

**Step 4 — nouveau `updateFilmMedia`** (remplace l'usage de `updateFilmPaths` par le pipeline) :
```ts
export function updateFilmMedia(filmId: number, media: {
  media_dir?: string;
  file_path_vo_transcoded?: string | null;
  file_path_vf_transcoded?: string | null;
  subtitle_fr_vtt?: string | null;
  subtitle_fr_srt?: string | null;
  subtitle_en_vtt?: string | null;
  subtitle_en_srt?: string | null;
}): void {
  const cols = Object.keys(media);
  if (cols.length === 0) return;
  const sets = cols.map(c => `${c} = ?`).join(', ');
  db.prepare(`UPDATE films SET ${sets} WHERE id = ?`).run(...cols.map(c => (media as any)[c]), filmId);
}
```

**Step 5 — `Film` interface + `parseFilm`** : ajouter `radarr_id`, `original_language`, `media_dir`, et les 4 colonnes subs.

**Step 6 — vérif:** `npx tsc --noEmit` (les erreurs restantes seront dans radarr-poller/instrumentation, corrigées ensuite).

**Commit:** `feat(films): download radarr unique, original_language, updateFilmMedia`.

---

## Phase 3 — Service de transcode (client Pablo)

### Task 7: Client HTTP `transcode.agi-so.fr`

**Files:**
- Create: `lib/media/transcode-service.ts`

Basic auth via `TRANSCODE_API_AUTH` (`user:password`). Le client upload un fichier (stream), poll, download le résultat vers un chemin local.

**Implémentation** (`lib/media/transcode-service.ts`):
```ts
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const BASE = process.env.TRANSCODE_API_URL || 'https://transcode.agi-so.fr';
function authHeader(): string {
  const raw = process.env.TRANSCODE_API_AUTH || '';
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

export interface TranscodeParams {
  targetHeight?: number;     // 1080 par défaut
  targetCodec?: string;      // h264_nvenc
  preset?: string;           // p4
  targetBitrate?: string;    // ex '4M' ; si absent → cq
  cq?: number;
  audioOrdinal?: number;     // Nième piste audio (0-based) = param `audio_stream`
}

export interface TranscodeJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress?: { percent?: number };
  error?: string;
}

export async function createJob(filePath: string, params: TranscodeParams): Promise<TranscodeJob> {
  const size = (await stat(filePath)).size;
  const form = new FormData();
  // Node 20+: on peut passer un Blob-like ; pour un gros fichier, streamer via undici
  const stream = createReadStream(filePath);
  // @ts-expect-error - undici FormData accepte un stream avec taille via Blob; sinon fallback fetch body stream
  form.append('file', await blobFromStream(stream, size), 'input.mkv');
  form.append('target_codec', params.targetCodec ?? 'h264_nvenc');
  form.append('target_height', String(params.targetHeight ?? 1080));
  form.append('preset', params.preset ?? 'p4');
  if (params.targetBitrate) form.append('target_bitrate', params.targetBitrate);
  else if (params.cq != null) form.append('cq', String(params.cq));
  if (params.audioOrdinal != null) form.append('audio_stream', String(params.audioOrdinal));

  const res = await fetch(`${BASE}/jobs`, { method: 'POST', headers: { Authorization: authHeader() }, body: form });
  if (!res.ok) throw new Error(`transcode createJob ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getJob(id: string): Promise<TranscodeJob> {
  const res = await fetch(`${BASE}/jobs/${id}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`transcode getJob ${res.status}`);
  return res.json();
}

export async function downloadOutput(id: string, destPath: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}/output`, { headers: { Authorization: authHeader() } });
  if (res.status === 409) throw new Error('output_not_ready');
  if (!res.ok) throw new Error(`transcode download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destPath));
}

export async function waitForJob(id: string, onProgress?: (p: number) => void, intervalMs = 3000): Promise<void> {
  for (;;) {
    const job = await getJob(id);
    if (job.progress?.percent != null) onProgress?.(job.progress.percent);
    if (job.status === 'done') return;
    if (job.status === 'failed') throw new Error(`transcode job failed: ${job.error || 'unknown'}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Helper d'upload streamé (gros fichiers). Impl. via undici si dispo, sinon lecture Blob.
async function blobFromStream(stream: NodeJS.ReadableStream, size: number): Promise<Blob> {
  // Impl. concrète à finaliser pendant l'implémentation (voir note ci-dessous).
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return new Blob([Buffer.concat(chunks)]);
}
```

> ⚠️ **Point à résoudre pendant l'implémentation** : uploader un fichier de 12 Go via `FormData` en **bufferisant tout en mémoire** (`blobFromStream` ci-dessus) est inacceptable. Utiliser l'upload **streamé** d'`undici` (déjà transitivement présent via Next/fetch) : `import { request, FormData, File } from 'undici'` et passer un stream, **ou** construire le corps multipart manuellement avec `fetch` + `duplex: 'half'` + un `ReadableStream` qui pipe le fichier. Écrire un test d'intégration réel dès que la clé de Pablo est dispo (Task 15). Tant que la clé n'est pas là, garder l'impl. streamée mais non validée derrière un TODO explicite.

**Vérif compile:** `npx tsc --noEmit lib/media/transcode-service.ts` (les erreurs `@ts-expect-error` doivent être maîtrisées).

**Commit:** `feat(media): client service de transcode (Basic auth, upload/poll/download)`.

---

## Phase 4 — Pipeline processFilm

### Task 8: ffprobe wrapper (I/O réelle)

**Files:**
- Create: `lib/media/probe.ts`

```ts
import ffmpeg from 'fluent-ffmpeg';
import type { ProbeStream } from './identify-tracks';

export function probeStreams(filePath: string): Promise<{ streams: ProbeStream[]; duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      resolve({
        streams: (meta.streams as any[]).map(s => ({
          index: s.index,
          codec_type: s.codec_type,
          codec_name: s.codec_name,
          tags: s.tags,
        })),
        duration: meta.format?.duration ?? 0,
      });
    });
  });
}
```

**Commit:** `feat(media): wrapper ffprobe → streams normalisés`.

---

### Task 9: Orchestration `processFilm` + mux VF + extraction subs

**Files:**
- Create: `lib/media/process-film.ts`
- Create: `lib/media/ffmpeg-ops.ts` (mux VF, extraction subs — appels ffmpeg locaux)

**`lib/media/ffmpeg-ops.ts`:**
```ts
import ffmpeg from 'fluent-ffmpeg';

// vf.mp4 = vidéo copiée de vo.mp4 + Nième piste audio VF du MKV ré-encodée AAC.
export function muxVf(voMp4: string, mkv: string, vfAudioOrdinal: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(voMp4)
      .input(mkv)
      .outputOptions([
        '-map', '0:v:0',
        '-map', `1:a:${vfAudioOrdinal}`,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

// Extrait une piste sous-titre texte (index absolu) vers srt puis vtt.
export function extractSub(mkv: string, subAbsoluteIndex: number, outSrt: string, outVtt: string): Promise<void> {
  const one = (out: string) => new Promise<void>((resolve, reject) => {
    ffmpeg(mkv)
      .outputOptions(['-map', `0:${subAbsoluteIndex}`])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
  return one(outSrt).then(() => one(outVtt));
}
```

**`lib/media/process-film.ts`** — orchestration (squelette complet à implémenter):
```ts
import { join } from 'path';
import { mkdir, copyFile, rm, access } from 'fs/promises';
import { db } from '../db';
import { getFilmById, updateFilmMedia } from '../films';
import { getMovieStatus, setMonitored } from '../radarr';
import { probeStreams } from './probe';
import { identifyTracks } from './identify-tracks';
import { mediaDirFromMoviePath } from './media-dir';
import { createJob, waitForJob, downloadOutput } from './transcode-service';
import { muxVf, extractSub } from './ffmpeg-ops';

const LIBRARY = process.env.MEDIA_LIBRARY_PATH || '/media/library';   // MKV bruts (mount raw Radarr)
const FILMS = process.env.MEDIA_FILMS_PATH || '/media/films';          // sorties transcodées
const BACKUP = process.env.MEDIA_BACKUP_PATH || '/media/backup/zone-club';

// index audio ffprobe absolu → ordinal (Nième piste audio, 0-based)
function audioOrdinal(streams: {index:number;codec_type?:string}[], absoluteIndex: number): number {
  return streams.filter(s => s.codec_type === 'audio').findIndex(s => s.index === absoluteIndex);
}

function setStatus(filmId: number, status: string, progress = 0, error: string | null = null) {
  db.prepare('UPDATE films SET transcode_status=?, transcode_progress=?, transcode_error=? WHERE id=?')
    .run(status, progress, error, filmId);
}

export async function processFilm(filmId: number): Promise<void> {
  const film = getFilmById(filmId);
  if (!film || !film.radarr_id) throw new Error(`processFilm: film ${filmId} sans radarr_id`);

  // 1. Localiser le MKV via Radarr
  const status = await getMovieStatus(film.radarr_id);
  if (!status.hasFile || !status.movieFile?.path) { setStatus(filmId, 'pending'); return; }
  const moviePath = status.movieFile.path;                 // ex /movies/Titre (Année)/x.mkv
  const relFromMovies = moviePath.replace(/^\/movies\//, '');
  const mkv = join(LIBRARY, relFromMovies);
  const mediaDir = mediaDirFromMoviePath(moviePath);
  const outDir = join(FILMS, mediaDir);

  try {
    // Idempotence: si vo.mp4 existe déjà, on considère fait
    try { await access(join(outDir, 'vo.mp4')); setStatus(filmId, 'done', 100);
      updateFilmMedia(filmId, { media_dir: mediaDir, file_path_vo_transcoded: `${mediaDir}/vo.mp4` });
      return; } catch {}

    setStatus(filmId, 'probing', 0);
    const { streams } = await probeStreams(mkv);
    const tracks = identifyTracks(streams, film.original_language);
    if (tracks.voAudioIndex == null) throw new Error('aucune piste audio détectée');

    await mkdir(outDir, { recursive: true });

    // 2. Backup MKV
    setStatus(filmId, 'backing_up', 0);
    const backupDir = join(BACKUP, mediaDir);
    await mkdir(backupDir, { recursive: true });
    await copyFile(mkv, join(backupDir, 'original.mkv'));

    // 3. Transcode vidéo GPU (audio = VO)
    setStatus(filmId, 'transcoding_remote', 0);
    const voOrdinal = audioOrdinal(streams, tracks.voAudioIndex);
    const job = await createJob(mkv, { targetHeight: 1080, preset: 'p4', targetBitrate: '4M', audioOrdinal: voOrdinal });
    await waitForJob(job.id, pct => setStatus(filmId, 'transcoding_remote', pct));
    await downloadOutput(job.id, join(outDir, 'vo.mp4'));

    // 4. Mux VF local si présent
    let vfRel: string | null = null;
    if (tracks.vfAudioIndex != null) {
      setStatus(filmId, 'muxing', 90);
      const vfOrdinal = audioOrdinal(streams, tracks.vfAudioIndex);
      await muxVf(join(outDir, 'vo.mp4'), mkv, vfOrdinal, join(outDir, 'vf.mp4'));
      vfRel = `${mediaDir}/vf.mp4`;
    }

    // 5. Subs
    setStatus(filmId, 'subtitles', 95);
    const subCols: Record<string, string> = {};
    for (const s of tracks.textSubs) {
      const srt = `sub.${s.lang}.srt`, vtt = `sub.${s.lang}.vtt`;
      await extractSub(mkv, s.streamIndex, join(outDir, srt), join(outDir, vtt));
      subCols[`subtitle_${s.lang}_srt`] = `${mediaDir}/${srt}`;
      subCols[`subtitle_${s.lang}_vtt`] = `${mediaDir}/${vtt}`;
    }
    if (tracks.imageSubsFlagged) console.warn(`[processFilm] "${film.title}" a des subs IMAGE non extraits (PGS/VOBSUB)`);

    // 6. DB
    updateFilmMedia(filmId, {
      media_dir: mediaDir,
      file_path_vo_transcoded: `${mediaDir}/vo.mp4`,
      file_path_vf_transcoded: vfRel,
      ...subCols,
    });
    db.prepare('UPDATE films SET is_available = 1 WHERE id = ?').run(filmId);
    setStatus(filmId, 'done', 100);

    // 7. Supprimer le MKV (dossier)
    await rm(join(LIBRARY, mediaDir), { recursive: true, force: true });

    // 8. "Verrou" Radarr
    await setMonitored(film.radarr_id, false);
    console.log(`[processFilm] OK "${film.title}" → ${mediaDir}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[processFilm] Erreur "${film.title}":`, msg);
    setStatus(filmId, 'error', 0, msg);
    // NB: on ne supprime PAS le MKV, on ne unmonitor PAS → retriable
    throw err;
  }
}

// File d'attente simple pour éviter N uploads 12Go simultanés
const queue: number[] = [];
let active = 0;
const MAX = Number(process.env.PROCESS_MAX_CONCURRENT || 1);
export function enqueueProcessFilm(filmId: number): void {
  if (queue.includes(filmId)) return;
  queue.push(filmId);
  drain();
}
function drain() {
  while (active < MAX && queue.length) {
    const id = queue.shift()!;
    active++;
    processFilm(id).catch(() => {}).finally(() => { active--; drain(); });
  }
}
```

**Vérif:** `npx tsc --noEmit` sur le module (corriger les types fluent-ffmpeg au besoin).

**Commit:** `feat(media): pipeline processFilm (probe→backup→GPU→mux VF→subs→DB→delete→unmonitor)`.

---

## Phase 5 — Poller

### Task 10: Adapter `radarr-poller.ts` au modèle unique + processFilm

**Files:**
- Modify: `lib/radarr-poller.ts` (réécriture)
- Modify: `instrumentation.ts` (recovery)
- Supprimer/retirer l'usage de `lib/transcoder.ts` (obsolète)

**Nouveau `radarr-poller.ts`:**
- `getPendingFilms()` → `SELECT id FROM films WHERE radarr_id IS NOT NULL AND file_path_vo_transcoded IS NULL AND (transcode_status IS NULL OR transcode_status NOT IN ('done'))`.
- Boucle: pour chaque, `getMovieStatus(radarr_id)` ; si `hasFile` et pas déjà en cours (`transcode_status` non actif) → `enqueueProcessFilm(id)`.
- Garder `POLL_INTERVAL = 2 min`.

**`instrumentation.ts`:** remplacer `recoverPendingTranscodes()` (obsolète) par une recovery qui `enqueueProcessFilm` pour les films `radarr_id` + `file_path_vo_transcoded IS NULL` dont le statut n'est pas `error` figé (optionnel: inclure `error` pour retry au boot — à décider). Retirer l'import de `lib/transcoder.ts`.

**Décommission `lib/transcoder.ts`:** vérifier qu'aucun autre import ne subsiste (`grep -rn "from '.*transcoder'" .`). Le supprimer, ou le vider en réexportant `enqueueProcessFilm` sous l'ancien nom si des call-sites traînent. Préférer suppression franche + fix des imports.

**Vérif:** `npx tsc --noEmit` doit maintenant **passer** (toute la chaîne cohérente). `grep -rn "radarr_vo_id\|radarr_vf_id\|radarrVO\|radarrVF\|enqueueTranscode" lib app` ne doit remonter que les colonnes DB dépréciées (lecture historique tolérée) — corriger les usages fonctionnels restants (ex. `getTranscodeStatuses` `films.ts:308-320` → filtrer sur `radarr_id`).

**Commit:** `refactor(poller): modèle radarr unique → processFilm, décommission transcoder`.

---

## Phase 6 — Refresh (migration + tests)

### Task 11: `lib/media/refresh.ts` + CLI + route admin

**Files:**
- Create: `lib/media/refresh.ts`
- Create: `scripts/refresh-films.ts` ; ajouter `"refresh": "npx tsx scripts/refresh-films.ts"` à `package.json`
- Create: `app/api/admin/films/[filmId]/refresh/route.ts`

**`lib/media/refresh.ts`:**
```ts
import { db } from '../db';
import { getFilmById, triggerDownload } from '../films';
import { getMovieStatus, searchMovie } from '../radarr';
import { enqueueProcessFilm } from './process-film';

export async function refreshFilm(filmId: number): Promise<'processing' | 'searching' | 'downloading'> {
  let film = getFilmById(filmId);
  if (!film) throw new Error('film introuvable');
  if (!film.radarr_id) { film = await triggerDownload(filmId); return 'searching'; }  // (re)add + search
  const status = await getMovieStatus(film.radarr_id);
  if (status.hasFile) { enqueueProcessFilm(filmId); return 'processing'; }
  await searchMovie(film.radarr_id);
  return 'downloading';
}

export function emptyFilmIds(): number[] {
  return (db.prepare(
    `SELECT id FROM films WHERE file_path_vo_transcoded IS NULL ORDER BY id`
  ).all() as { id: number }[]).map(r => r.id);
}
```

**`scripts/refresh-films.ts`:** parse `--film <idOrTmdb>` ou `--all-empty` ; pour `--all-empty`, itérer `emptyFilmIds()` avec un petit délai (rate-limit Radarr). Logguer résultat par film.

**Route admin** `POST /api/admin/films/[filmId]/refresh` : gate `is_admin`, `await refreshFilm(filmId)`, renvoyer `{ result }`. (Bulk optionnel: `POST /api/admin/films/refresh-all` → lance `emptyFilmIds()` en tâche de fond.)

**Commit:** `feat(media): refresh film unique / all-empty (CLI + route admin)`.

---

### Task 12: Migration data — backfill original_language + vider les paths

**Files:**
- Create: `scripts/migrate-media-reset.ts`

Script one-shot :
1. Backfill `original_language` : pour chaque film où c'est NULL, `getMovie(tmdb_id)` (rate-limit 250ms) → `UPDATE films SET original_language=?`.
2. **Vider** : `UPDATE films SET file_path_vf=NULL, file_path_vo=NULL, file_path_vo_transcoded=NULL, file_path_vf_transcoded=NULL, subtitle_path=NULL, subtitle_fr_vtt=NULL, subtitle_fr_srt=NULL, subtitle_en_vtt=NULL, subtitle_en_srt=NULL, media_dir=NULL, radarr_id=NULL, transcode_status=NULL, transcode_progress=0, transcode_error=NULL, is_available=0`.
   - ⚠️ Ne **pas** toucher `radarr_vo_id`/`radarr_vf_id` (historique/rollback).
3. Print un récap (nb films, nb original_language backfillés).

> Exécution **manuelle** par l'utilisateur au moment voulu (pas au build). Documenter la commande `npx tsx scripts/migrate-media-reset.ts`.

**Commit:** `feat(scripts): migration reset media + backfill original_language`.

---

## Phase 7 — Servir les nouveaux fichiers (symlinks / rentals)

### Task 13: Repointer symlinks + rentals sur `/media/films`

**Files:**
- Modify: `lib/symlinks.ts` (root unique + subs fr/en)
- Modify: `lib/rentals.ts` (`getRentalDownloadSource`, streaming_urls)

**Changements `symlinks.ts`:**
- Nouveau `MEDIA_FILMS_PATH = process.env.MEDIA_FILMS_PATH || '/media/films'`.
- `createRentalSymlinks(tmdbId, { vf, vo, subtitles })` : résoudre `vf`/`vo` contre `MEDIA_FILMS_PATH` (plus de VO/VF paths séparés). Étendre pour créer `subs_fr.vtt` et `subs_en.vtt` à partir des chemins subs (résolus contre `MEDIA_FILMS_PATH`).
- Conserver `film_vf.mp4` / `film_vo.mp4` comme noms de symlinks (compat lecteur/route download inchangée).

**Changements `rentals.ts`:**
- `rentFilm` (`lib/rentals.ts:249-255`) : passer `subtitles` = objet `{ fr: film.subtitle_fr_vtt, en: film.subtitle_en_vtt }` (adapter la signature symlinks) ; `vf`=`file_path_vf_transcoded`, `vo`=`file_path_vo_transcoded` (inchangé).
- Construire `streaming_urls.subtitles` pour fr **et** en si présents (l'UI player consommera plus tard ; garder la clé `subtitles` = fr pour compat immédiate).

> L'intégration **UI multi-subs** reste hors périmètre (design §"Hors périmètre"). Ici on ne fait que rendre les fichiers atteignables.

**Vérif:** `npx tsc --noEmit` OK.

**Commit:** `feat(rentals): symlinks + streaming sur dossier films unique + subs fr/en`.

---

### Task 14: Repointer cinema-stream + zone-discord-bot

**Files:**
- Modify: `cinema-stream/src/config.ts:8`, `cinema-stream/src/playlist.ts:60-75`
- Modify: `zone-discord-bot/src/config.ts:8`, `zone-discord-bot/src/playlist.ts:41-64`

**Changements (identiques aux deux):**
1. `config.ts` : ajouter `export const FILMS_ROOT = process.env.FILMS_ROOT ?? '/media/films';` (garder `FILMS_VF_ROOT` pour compat éventuelle, mais on ne s'en sert plus).
2. `playlist.ts` :
   - SQL : `WHERE file_path_vf IS NOT NULL` → `WHERE file_path_vf_transcoded IS NOT NULL` (les deux services). Pour discord, garder `AND duration_sec IS NOT NULL`.
   - Résolution chemin : `join(FILMS_ROOT, row.file_path_vf_transcoded)` (retirer le fallback `?? file_path_vf`, mort après migration).

**Vérif:** `npx tsc --noEmit` dans chaque sous-projet (ils ont leur propre tsconfig) : `(cd cinema-stream && npx tsc --noEmit)` etc.

**Commit:** `fix(cinema,discord): résolution sur file_path_vf_transcoded + FILMS_ROOT`.

---

## Phase 8 — Infra

### Task 15: docker-compose — radarr unique + binds + env transcode

**Files:**
- Modify: `docker-compose.yml`

**Changements:**
1. **Supprimer** le service `radarr-vf` (lignes 82-100).
2. **Renommer** `radarr-vo` → `radarr` : `container_name: zone-radarr`, host label `radarr.${DOMAIN}`, `router/service` renommés `radarr`, volume `/data/big-boi/zone-club/library:/movies`. (Config: réutiliser `./radarr-vo-config:/config`, ou renommer le dossier en `./radarr-config` — au choix, l'utilisateur reconfigure les filtres.)
3. **`app`** :
   - Retirer binds `films-vo`/`films-vf` (les garder temporairement si besoin de rollback — sinon retirer).
   - Ajouter :
     ```yaml
     - /data/big-boi/zone-club/library:/media/library:rw
     - /data/big-boi/zone-club/films:/media/films:rw
     - /mnt/backup:/media/backup:rw,rshared
     ```
   - Env : retirer `RADARR_VO_*`/`RADARR_VF_*` ; ajouter
     ```yaml
     - RADARR_URL=http://radarr:7878
     - RADARR_API_KEY=${RADARR_API_KEY}
     - RADARR_QUALITY_PROFILE_ID=${RADARR_QUALITY_PROFILE_ID}
     - TRANSCODE_API_URL=https://transcode.agi-so.fr
     - TRANSCODE_API_AUTH=${TRANSCODE_API_AUTH}
     - MEDIA_FILMS_PATH=/media/films
     - MEDIA_LIBRARY_PATH=/media/library
     - MEDIA_BACKUP_PATH=/media/backup/zone-club
     ```
   - `depends_on: [radarr]`.
4. **`storage`** : ajouter `- /data/big-boi/zone-club/films:/media/films:ro`.
5. **`cinema-stream`** et **`zone-discord-bot`** : ajouter `- /data/big-boi/zone-club/films:/media/films:ro` et env `- FILMS_ROOT=/media/films`.
6. Mettre à jour `.env.example` : retirer `RADARR_VO/VF_*`, ajouter `RADARR_API_KEY`, `RADARR_QUALITY_PROFILE_ID`, `TRANSCODE_API_AUTH`.

> **⚠️ SSHFS `rshared`** : pour que le bind `/mnt/backup` voie l'automount, le mount hôte doit être en propagation partagée. Tester tôt (Task 17) : `docker compose up -d app` puis dans le container `ls /media/backup` doit déclencher/voir l'automount. Si KO, fallback : monter `/mnt` (parent) en `rshared`, ou staging local + rsync côté hôte.

**Commit:** `chore(compose): radarr unique, binds library/films/backup, env transcode`.

---

### Task 16: NixOS — mounts requis + host radarr

**Files:**
- Modify: `/etc/nixos/docker-services.nix` (entrée zone-club `mkCompose`)

**Changements:**
- Ajouter `/mnt/backup` (et `/data/big-boi` s'il n'y est pas) à `mounts` → `RequiresMountsFor` déclenche l'automount SSHFS avant le start du container.
- (Traefik découvre `radarr.lazone.at` via labels Docker — rien à changer côté NixOS pour le host, hors ouverture éventuelle déjà en place.)
- `sudo nixos-rebuild switch` (exécuté par l'utilisateur).

**Commit (repo infra séparé si applicable, sinon noter):** `chore(nixos): RequiresMountsFor /mnt/backup pour zone-club`.

---

## Phase 9 — Bout-en-bout & migration

### Task 17: Test d'intégration transcode + SSHFS (dès clé Pablo reçue)

**Steps (manuels, documentés):**
1. Renseigner `TRANSCODE_API_AUTH` (format `user:pass`) et `RADARR_QUALITY_PROFILE_ID` dans `.env`.
2. Smoke API: `curl -u "$TRANSCODE_API_AUTH" https://transcode.agi-so.fr/codecs | jq .` → 200 + liste codecs.
3. Valider l'**upload streamé** (Task 7 TODO) sur un petit fichier réel : job créé → `done` → download → MP4 lisible. Corriger `blobFromStream`/undici jusqu'à obtenir un upload sans exploser la RAM (surveiller `docker stats`).
4. Valider le bind SSHFS : `docker compose exec app ls -la /media/backup` → déclenche l'automount, écriture OK (`touch /media/backup/zone-club/.probe && rm ...`).

### Task 18: Déploiement + validation 1 film

**Steps:**
1. `git rebase main` (règle projet), résoudre, `npm run build` local OK.
2. Déployer : `npm run deploy` (down app → build → up) + `docker compose up -d radarr storage cinema-stream zone-discord-bot` (recréer avec nouveaux mounts) + `sudo nixos-rebuild switch`.
3. Côté Radarr (`radarr.lazone.at`) : root folder `/movies`, quality profile / filtres configurés par l'utilisateur.
4. `npx tsx scripts/migrate-media-reset.ts` (backfill + vidage). Vérifier en DB.
5. `npm run refresh -- --film <un_tmdb_avec_release_MKV_dispo>`.
6. Observer : Radarr télécharge le MKV → poller détecte → `journalctl`/logs app montrent `processFilm` (probing→backing_up→transcoding_remote→muxing→subtitles→done).
7. Vérifier sur disque : `/data/big-boi/zone-club/films/<dir>/{vo.mp4,vf.mp4,sub.fr.vtt,sub.fr.srt,sub.en.*}`, backup dans `/mnt/backup/zone-club/<dir>/original.mkv`, MKV supprimé de `library`, film `monitored:false` dans Radarr.
8. Louer le film dans le vidéoclub → lecture VF **et** VO OK (subs: vérif fichier atteignable via storage, UI plus tard).
9. Vérifier cinema-stream/discord voient toujours des films (`docker compose logs cinema-stream`).

**REQUIRED SUB-SKILL au moment de valider "ça marche":** superpowers:verification-before-completion (exécuter les commandes, montrer la sortie, ne rien affirmer sans preuve).

### Task 19: Bulk

**Steps:**
1. `npm run refresh -- --all-empty`.
2. Surveiller la file (statuts `transcode_status`), les erreurs (`transcode_status='error'` → visibles pour retry).
3. Les films non trouvés restent `monitored + missing` dans Radarr = liste à chasser à la main.

### Task 20: Nettoyage & PR

**Steps:**
1. Retirer les binds `films-vo`/`films-vf` du compose s'ils étaient gardés en filet (une fois la migration validée).
2. Décider du sort de **Bazarr** (devenu inutile) — retirer le service si confirmé.
3. Mettre à jour `CLAUDE.md` (section Docker: 6 services, radarr unique ; flow d'ajout de film ; nouvelles colonnes DB ; nouveaux env).
4. Mémoire: écrire une note (`memory/`) sur les contraintes du service transcode (upload multipart 12Go, 1 audio, pas de subs) et le pattern "verrou = monitored:false".
5. `superpowers:finishing-a-development-branch` → PR ou merge.

---

## Risques suivis (rappel design)

- **Upload 12 Go** streamé (undici) — à valider Task 17, ne pas bufferiser en RAM.
- **SSHFS `rshared`** dans container — valider Task 17, fallback rsync host.
- **Auth transcode** — format `user:pass` confirmé (`curl -u`), clé en attente.
- **Index audio absolu vs ordinal** — `identifyTracks` renvoie l'absolu ; convertir en ordinal pour `audio_stream`/`-map 0:a:N` (helper `audioOrdinal`). Testé Task 2 (ajout ordinals).
- **cinema-stream/discord** — cassent si `file_path_vf` vidé sans changer leur query : couvert Task 14 (à déployer **avant/avec** la migration Task 18.4).
