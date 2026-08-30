/**
 * Peuple la base avec le catalogue mock de src/data/mock/films.json.
 *
 * ⚠️  DÉVELOPPEMENT / TEST UNIQUEMENT — exige SEED_MOCK=1.
 *
 * Usage :
 *   SEED_MOCK=1 npm run seed
 *
 * Ce que fait le script :
 *   - lit les IDs TMDB de src/data/mock/films.json (groupés par rayon)
 *   - récupère les métadonnées complètes depuis TMDB (dont `original_language`)
 *   - insère en base avec rayon, is_nouveaute et stock
 *   - pose un ÉTAT MÉDIA SYNTHÉTIQUE (voir plus bas) pour qu'un poste de dev ait
 *     un catalogue jouable, de taille et de distribution comparables à la prod
 *   - ne déclenche AUCUN téléchargement Radarr
 *
 * En production, les films s'ajoutent exclusivement via le panel admin :
 *   POST /api/admin/films { tmdb_id }
 *   PATCH /api/admin/films/{id}/aisle { aisle, is_nouveaute }
 *
 * ── ÉTAT MÉDIA SYNTHÉTIQUE ─────────────────────────────────────────────────
 *
 * Sans ça, un seed ne pose ni `is_available` (défaut FALSE) ni le moindre chemin
 * média : toutes les routes de liste filtrent `WHERE is_available = 1`, donc le
 * magasin est vide, et `has_vf` / `has_vo` (= `!!file_path_v*_transcoded`) sont
 * faux pour tout le monde. On écrit donc :
 *
 *   - `file_path_v{o,f}_transcoded` → SEED_VIDEO_URL (la même vidéo pour tous)
 *   - `subtitle_{fr,en}_{vtt,srt}`  → le jeu unique de public/seed-media/
 *   - `duration_sec`                → runtime TMDB × 60 (lu par la chaîne 24/7)
 *   - `transcode_status`, `is_available`, `media_dir`, `original_language`
 *
 * `lib/rentals.ts` reconnaît ces valeurs à leur forme (`http(s)://` ou `/`) et
 * les renvoie telles quelles dans `streaming_urls`, sans passer par les symlinks
 * lighttpd — c'est ce qui rend le player utilisable sans pipeline média local.
 *
 * La répartition VO/VF/sous-titres n'est pas uniforme : elle reproduit celle
 * mesurée sur le catalogue réel (380 films, dont 313 `done`), parce que les cas
 * intéressants du player sont justement les buckets minoritaires — un film sans
 * VF force le snap de piste audio, un film sans sous-titre FR force celui des
 * sous-titres. Cf. SEED_DISTRIBUTION plus bas.
 *
 * Le tirage est déterministe (haché sur le tmdb_id) : deux machines seedées avec
 * le même films.json obtiennent exactement le même catalogue, et un film garde
 * ses caractéristiques d'un run à l'autre.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Guard: only run with explicit SEED_MOCK=1
if (process.env.SEED_MOCK !== '1') {
    console.error('⚠️  Ce script peuple la DB avec les films mock (src/data/mock/films.json).');
    console.error('   Pour l\'exécuter, utilisez : SEED_MOCK=1 npm run seed');
    console.error('   En production, ajoutez les films via le panel admin.');
    process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- Média synthétique ---

/**
 * Vidéo unique servie pour TOUS les films : Big Buck Bunny (Blender Foundation,
 * CC BY 3.0), ~10 min, H.264/AAC. Vérifié : HTTP 206 sur requête Range,
 * `accept-ranges: bytes` et `access-control-allow-origin: *`, donc le <video> du
 * player la lit et la scrube sans qu'on héberge quoi que ce soit localement.
 */
const SEED_VIDEO_URL = 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';

/**
 * Jeu de sous-titres unique, servi en same-origin depuis public/. Contrairement
 * à la vidéo, un <track> cross-origin exigerait des en-têtes CORS ET l'attribut
 * `crossorigin` sur le <video> — d'où le choix du statique local.
 */
const SEED_SUBS = {
    frVtt: '/seed-media/sub.fr.vtt',
    frSrt: '/seed-media/sub.fr.srt',
    enVtt: '/seed-media/sub.en.vtt',
    enSrt: '/seed-media/sub.en.srt',
} as const;

/**
 * Proportions relevées sur le catalogue réel (380 films) le 2026-08-29 :
 *
 *   transcode_status : 313 done · 64 pending · 3 qc_failed
 *   parmi les `done` : VO présente sur 313/313, VF sur 312/313
 *   sous-titres, films NON francophones (293) : FR 292/293, EN 164/293
 *   sous-titres, films francophones      (20) : FR   8/20,  EN   6/20
 *
 * Ces deux derniers chiffres ne sont pas une anomalie : sur un film dont la VO
 * est déjà française, le pipeline n'a le plus souvent aucune piste FR à extraire.
 * Appliquées telles quelles, ces proportions reconstituent les combinaisons
 * observées en prod à l'unité près (166 FR+EN, 133 FR seul, 9 aucun, 4 EN seul).
 */
const SEED_DISTRIBUTION = {
    doneRatio: 313 / 380,
    qcFailedRatio: 3 / 380,
    vfRatio: 312 / 313,
    nonFrancophone: { subFr: 292 / 293, subEn: 164 / 293 },
    francophone: { subFr: 8 / 20, subEn: 6 / 20 },
} as const;

/**
 * Hachage FNV-1a + avalanche → flottant dans [0, 1). Déterministe et stable
 * entre machines. Le `salt` sépare les tirages : ajuster un seuil ne rebat pas
 * les cartes sur les autres caractéristiques du même film.
 */
function hash01(tmdbId: number, salt: string): number {
    const input = `${salt}:${tmdbId}`;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

interface MediaState {
    transcodeStatus: 'done' | 'pending' | 'qc_failed';
    isAvailable: boolean;
    vo: string | null;
    vf: string | null;
    subFrVtt: string | null;
    subFrSrt: string | null;
    subEnVtt: string | null;
    subEnSrt: string | null;
}

function planMediaState(tmdbId: number, originalLanguage: string | null): MediaState {
    const { doneRatio, qcFailedRatio, vfRatio, nonFrancophone, francophone } = SEED_DISTRIBUTION;

    const statusDraw = hash01(tmdbId, 'status');
    if (statusDraw >= doneRatio) {
        // Ni fichier ni disponibilité : ces films existent en base et occupent un
        // rayon, mais restent invisibles côté client — comme en prod.
        return {
            transcodeStatus: statusDraw < doneRatio + qcFailedRatio ? 'qc_failed' : 'pending',
            isAvailable: false,
            vo: null, vf: null,
            subFrVtt: null, subFrSrt: null, subEnVtt: null, subEnSrt: null,
        };
    }

    const subs = originalLanguage === 'fr' ? francophone : nonFrancophone;
    const hasVf = hash01(tmdbId, 'vf') < vfRatio;
    const hasSubFr = hash01(tmdbId, 'sub-fr') < subs.subFr;
    const hasSubEn = hash01(tmdbId, 'sub-en') < subs.subEn;

    return {
        transcodeStatus: 'done',
        isAvailable: true,
        vo: SEED_VIDEO_URL,
        vf: hasVf ? SEED_VIDEO_URL : null,
        subFrVtt: hasSubFr ? SEED_SUBS.frVtt : null,
        subFrSrt: hasSubFr ? SEED_SUBS.frSrt : null,
        subEnVtt: hasSubEn ? SEED_SUBS.enVtt : null,
        subEnSrt: hasSubEn ? SEED_SUBS.enSrt : null,
    };
}

/** Nom de dossier à la Radarr : « Titre (Année) », sans caractère interdit. */
function mediaDirFor(title: string, year: number | null): string {
    const clean = title.replace(/[\\/:*?"<>|]/g, '').trim();
    return year ? `${clean} (${year})` : clean;
}

// --- DB setup (inline, no alias dependency) ---
const dbPath = process.env.DATABASE_PATH || join(ROOT, 'zone.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const schema = readFileSync(join(ROOT, 'lib', 'schema.sql'), 'utf-8');
db.exec(schema);

// Migration: add columns if missing
const columns = db.prepare("PRAGMA table_info(films)").all() as { name: string }[];
if (!columns.some(c => c.name === 'aisle')) {
    db.exec('ALTER TABLE films ADD COLUMN aisle TEXT');
}
if (!columns.some(c => c.name === 'is_nouveaute')) {
    db.exec('ALTER TABLE films ADD COLUMN is_nouveaute BOOLEAN DEFAULT FALSE');
}
// --- TMDB ---
const TMDB_API_KEY = process.env.TMDB_API_KEY;
if (!TMDB_API_KEY) {
    console.error('TMDB_API_KEY env var is required');
    process.exit(1);
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

async function tmdbFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY!);
    url.searchParams.set('language', 'fr-FR');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${endpoint}`);
    return res.json();
}

/** Sous-ensembles de la réponse TMDB effectivement lus ici. */
interface TmdbMovie {
    id: number;
    title: string;
    original_title: string | null;
    original_language: string | null;
    overview: string | null;
    release_date: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    runtime: number | null;
    genres?: { id: number; name: string }[];
}

interface TmdbCredits {
    cast?: { id: number; name: string; character: string; order: number }[];
    crew?: { id: number; name: string; job: string }[];
}

interface TmdbImages {
    posters?: { iso_639_1: string | null; file_path: string }[];
}

async function fetchFullMovie(tmdbId: number) {
    const [movie, credits, images] = await Promise.all([
        tmdbFetch<TmdbMovie>(`/movie/${tmdbId}`),
        tmdbFetch<TmdbCredits>(`/movie/${tmdbId}/credits`),
        tmdbFetch<TmdbImages>(`/movie/${tmdbId}/images`, { include_image_language: 'fr,null' }),
    ]);

    const frPoster = images.posters?.find(p => p.iso_639_1 === 'fr');
    const posterPath = frPoster?.file_path || movie.poster_path;

    const actors = (credits.cast || [])
        .sort((a, b) => a.order - b.order)
        .slice(0, 10)
        .map(a => ({ tmdb_id: a.id, name: a.name, character: a.character }));

    const directors = (credits.crew || [])
        .filter(c => c.job === 'Director')
        .map(d => ({ tmdb_id: d.id, name: d.name }));

    return {
        tmdb_id: movie.id,
        title: movie.title,
        title_original: movie.original_title,
        original_language: movie.original_language,
        synopsis: movie.overview,
        release_year: movie.release_date ? parseInt(movie.release_date.split('-')[0]) : null,
        poster_url: posterPath ? `${TMDB_IMG}/w500${posterPath}` : null,
        backdrop_url: movie.backdrop_path ? `${TMDB_IMG}/w1280${movie.backdrop_path}` : null,
        runtime: movie.runtime,
        genres: movie.genres || [],
        actors,
        directors,
    };
}

function slugify(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Un chemin déjà écrit par le vrai pipeline est relatif à MEDIA_FILMS_PATH
 * (« Titre (Année)/vo.mp4 ») ; un média de seed est une URL ou un chemin absolu.
 * Sert de garde-fou : le seed refuse d'écraser une sortie de pipeline réelle,
 * même lancé par erreur sur une base qui en contient.
 */
function isSeedMediaValue(value: string | null): boolean {
    return !!value && /^(https?:\/\/|\/)/.test(value);
}

// --- Main ---
async function main() {
    const filmsJson = JSON.parse(readFileSync(join(ROOT, 'src/data/mock/films.json'), 'utf-8')) as Record<string, number[]>;

    // Build mapping: tmdb_id → { aisle, is_nouveaute }
    // A film can appear in multiple aisles in the JSON; pick the first non-nouveautes one.
    // Les rayons sont les clés du JSON elles-mêmes, moins `nouveautes` qui est virtuel :
    // une liste codée en dur ici finirait par diverger de AisleType (elle avait déjà
    // perdu `aventure` et `romance`, qui étaient donc silencieusement seedés sans rayon).
    const aisleMap = new Map<number, { aisle: string | null; is_nouveaute: boolean }>();

    for (const [aisleKey, ids] of Object.entries(filmsJson)) {
        for (const id of ids) {
            const existing = aisleMap.get(id) || { aisle: null, is_nouveaute: false };

            if (aisleKey === 'nouveautes') {
                existing.is_nouveaute = true;
            } else if (!existing.aisle) {
                // First aisle wins (don't overwrite if already assigned)
                existing.aisle = aisleKey;
            }

            aisleMap.set(id, existing);
        }
    }

    // Collect unique TMDB IDs
    const allIds = [...aisleMap.keys()];
    console.log(`Found ${allIds.length} unique TMDB IDs across ${Object.keys(filmsJson).length} aisles`);

    const insertFilm = db.prepare(`
        INSERT INTO films (
            tmdb_id, title, title_original, synopsis, release_year, poster_url, backdrop_url,
            genres, directors, actors, runtime, aisle, is_nouveaute, stock,
            original_language, media_dir, duration_sec, transcode_status, is_available,
            file_path_vo_transcoded, file_path_vf_transcoded,
            subtitle_fr_vtt, subtitle_fr_srt, subtitle_en_vtt, subtitle_en_srt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGenre = db.prepare(`INSERT OR IGNORE INTO genres (name, slug, tmdb_id) VALUES (?, ?, ?)`);
    const getGenre = db.prepare(`SELECT id FROM genres WHERE tmdb_id = ?`);
    const insertFilmGenre = db.prepare(`INSERT OR IGNORE INTO film_genres (film_id, genre_id) VALUES (?, ?)`);
    const checkExists = db.prepare(`
        SELECT id, title, release_year, runtime, original_language, file_path_vo_transcoded
        FROM films WHERE tmdb_id = ?
    `);
    const updateAisle = db.prepare(`UPDATE films SET aisle = ?, is_nouveaute = ? WHERE tmdb_id = ?`);
    const updateMedia = db.prepare(`
        UPDATE films SET
            media_dir = ?, duration_sec = ?, transcode_status = ?, is_available = ?,
            file_path_vo_transcoded = ?, file_path_vf_transcoded = ?,
            subtitle_fr_vtt = ?, subtitle_fr_srt = ?, subtitle_en_vtt = ?, subtitle_en_srt = ?
        WHERE tmdb_id = ?
    `);

    let added = 0;
    const skipped = 0;
    let updated = 0;
    let backfilled = 0;
    let preserved = 0;
    let errors = 0;
    const tally = { done: 0, pending: 0, qc_failed: 0, vf: 0, subFr: 0, subEn: 0 };

    function countMedia(media: MediaState) {
        tally[media.transcodeStatus]++;
        if (media.vf) tally.vf++;
        if (media.subFrVtt) tally.subFr++;
        if (media.subEnVtt) tally.subEn++;
    }

    for (const tmdbId of allIds) {
        const mapping = aisleMap.get(tmdbId)!;

        // If already in DB, refresh aisle/nouveaute and backfill the seed media state.
        const existingRow = checkExists.get(tmdbId) as {
            id: number; title: string; release_year: number | null; runtime: number | null;
            original_language: string | null; file_path_vo_transcoded: string | null;
        } | undefined;
        if (existingRow) {
            updateAisle.run(mapping.aisle, mapping.is_nouveaute ? 1 : 0, tmdbId);
            updated++;

            // Une sortie de pipeline réelle (chemin relatif à MEDIA_FILMS_PATH) n'est
            // jamais écrasée : sur une base de prod, le seed ne touche que le rayon.
            if (existingRow.file_path_vo_transcoded && !isSeedMediaValue(existingRow.file_path_vo_transcoded)) {
                preserved++;
                continue;
            }

            const media = planMediaState(tmdbId, existingRow.original_language);
            updateMedia.run(
                mediaDirFor(existingRow.title, existingRow.release_year),
                existingRow.runtime ? existingRow.runtime * 60 : null,
                media.transcodeStatus, media.isAvailable ? 1 : 0,
                media.vo, media.vf,
                media.subFrVtt, media.subFrSrt, media.subEnVtt, media.subEnSrt,
                tmdbId
            );
            countMedia(media);
            backfilled++;
            continue;
        }

        try {
            const data = await fetchFullMovie(tmdbId);

            // Insert TMDB genres
            for (const genre of data.genres) {
                insertGenre.run(genre.name, slugify(genre.name), genre.id);
            }

            // Compute stock based on aisle/nouveaute
            let stock = 2; // default
            if (mapping.is_nouveaute) stock = 3;
            else if (mapping.aisle === 'classiques' || mapping.aisle === 'bizarre') stock = 1;

            const media = planMediaState(tmdbId, data.original_language);

            // Insert film with aisle, is_nouveaute, stock and synthetic media state
            const result = insertFilm.run(
                data.tmdb_id, data.title, data.title_original, data.synopsis, data.release_year,
                data.poster_url, data.backdrop_url,
                JSON.stringify(data.genres), JSON.stringify(data.directors), JSON.stringify(data.actors),
                data.runtime, mapping.aisle, mapping.is_nouveaute ? 1 : 0, stock,
                data.original_language,
                mediaDirFor(data.title, data.release_year),
                data.runtime ? data.runtime * 60 : null,
                media.transcodeStatus, media.isAvailable ? 1 : 0,
                media.vo, media.vf,
                media.subFrVtt, media.subFrSrt, media.subEnVtt, media.subEnSrt
            );

            const filmId = result.lastInsertRowid as number;

            // Link film <-> TMDB genres
            for (const genre of data.genres) {
                const row = getGenre.get(genre.id) as { id: number } | undefined;
                if (row) insertFilmGenre.run(filmId, row.id);
            }

            countMedia(media);
            added++;
            const aisleLabel = mapping.aisle || 'no-aisle';
            const nouveauteLabel = mapping.is_nouveaute ? ' [NEW]' : '';
            const mediaLabel = media.transcodeStatus === 'done'
                ? ` ${media.vf ? 'VF+VO' : 'VO'}${media.subFrVtt ? '+stFR' : ''}${media.subEnVtt ? '+stEN' : ''}`
                : ` [${media.transcodeStatus}]`;
            console.log(`  [${added + skipped + updated + errors}/${allIds.length}] + ${data.title} (${data.tmdb_id}) → ${aisleLabel}${nouveauteLabel}${mediaLabel}`);
        } catch (err) {
            errors++;
            console.error(`  [${added + skipped + updated + errors}/${allIds.length}] x TMDB ${tmdbId}: ${(err as Error).message}`);
        }

        // Small delay to avoid TMDB rate limits
        await new Promise(r => setTimeout(r, 250));
    }

    console.log(`\nDone: ${added} added, ${updated} updated (aisle/nouveaute), ${errors} errors`);
    if (backfilled) console.log(`      ${backfilled} état(s) média de seed (re)posé(s)`);
    if (preserved) console.log(`      ${preserved} film(s) avec un média réel — laissés intacts`);

    const withMedia = tally.done;
    if (withMedia > 0) {
        const pct = (n: number) => `${Math.round((n / withMedia) * 100)}%`;
        console.log(`\nÉtat média posé : ${tally.done} done · ${tally.pending} pending · ${tally.qc_failed} qc_failed`);
        console.log(`  parmi les done : VF ${tally.vf} (${pct(tally.vf)}) · st FR ${tally.subFr} (${pct(tally.subFr)}) · st EN ${tally.subEn} (${pct(tally.subEn)})`);
        console.log(`  vidéo : ${SEED_VIDEO_URL}`);
        console.log(`  sous-titres : public/seed-media/ (servis en /seed-media/)`);
    }
    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
