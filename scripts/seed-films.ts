/**
 * Seed the database with mock films from src/data/mock/films.json
 *
 * ⚠️  DEVELOPMENT/TEST ONLY — requires SEED_MOCK=1 environment variable.
 *
 * Usage:
 *   SEED_MOCK=1 npm run seed          # Populate DB with mock film catalog
 *
 * What it does:
 *   - Reads TMDB IDs from src/data/mock/films.json (grouped by aisle)
 *   - Fetches full metadata from TMDB API for each film
 *   - Inserts into SQLite DB with aisle + is_nouveaute assignments
 *   - Skips films that already exist (only updates aisle/nouveaute)
 *   - Does NOT trigger Radarr downloads
 *
 * In production, films should be added exclusively via the admin panel:
 *   POST /api/admin/films { tmdb_id }
 *   PATCH /api/admin/films/{id}/aisle { aisle, is_nouveaute }
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

async function fetchFullMovie(tmdbId: number) {
    const [movie, credits, images] = await Promise.all([
        tmdbFetch<any>(`/movie/${tmdbId}`),
        tmdbFetch<any>(`/movie/${tmdbId}/credits`),
        tmdbFetch<any>(`/movie/${tmdbId}/images`, { include_image_language: 'fr,null' }),
    ]);

    const frPoster = images.posters?.find((p: any) => p.iso_639_1 === 'fr');
    const posterPath = frPoster?.file_path || movie.poster_path;

    const actors = (credits.cast || [])
        .sort((a: any, b: any) => a.order - b.order)
        .slice(0, 10)
        .map((a: any) => ({ tmdb_id: a.id, name: a.name, character: a.character }));

    const directors = (credits.crew || [])
        .filter((c: any) => c.job === 'Director')
        .map((d: any) => ({ tmdb_id: d.id, name: d.name }));

    return {
        tmdb_id: movie.id,
        title: movie.title,
        title_original: movie.original_title,
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

// --- Main ---
async function main() {
    const filmsJson = JSON.parse(readFileSync(join(ROOT, 'src/data/mock/films.json'), 'utf-8')) as Record<string, number[]>;

    // Build mapping: tmdb_id → { aisle, is_nouveaute }
    // A film can appear in multiple aisles in the JSON; pick the first non-nouveautes one
    const aisleMap = new Map<number, { aisle: string | null; is_nouveaute: boolean }>();
    const AISLES = ['action', 'horreur', 'sf', 'comedie', 'classiques', 'bizarre'];

    for (const [aisleKey, ids] of Object.entries(filmsJson)) {
        for (const id of ids) {
            const existing = aisleMap.get(id) || { aisle: null, is_nouveaute: false };

            if (aisleKey === 'nouveautes') {
                existing.is_nouveaute = true;
            } else if (AISLES.includes(aisleKey) && !existing.aisle) {
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
        INSERT INTO films (tmdb_id, title, title_original, synopsis, release_year, poster_url, backdrop_url, genres, directors, actors, runtime, aisle, is_nouveaute)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGenre = db.prepare(`INSERT OR IGNORE INTO genres (name, slug, tmdb_id) VALUES (?, ?, ?)`);
    const getGenre = db.prepare(`SELECT id FROM genres WHERE tmdb_id = ?`);
    const insertFilmGenre = db.prepare(`INSERT OR IGNORE INTO film_genres (film_id, genre_id) VALUES (?, ?)`);
    const checkExists = db.prepare(`SELECT id FROM films WHERE tmdb_id = ?`);
    const updateAisle = db.prepare(`UPDATE films SET aisle = ?, is_nouveaute = ? WHERE tmdb_id = ?`);

    let added = 0;
    let skipped = 0;
    let updated = 0;
    let errors = 0;

    for (const tmdbId of allIds) {
        const mapping = aisleMap.get(tmdbId)!;

        // If already in DB, just update aisle/nouveaute
        const existingRow = checkExists.get(tmdbId) as { id: number } | undefined;
        if (existingRow) {
            updateAisle.run(mapping.aisle, mapping.is_nouveaute ? 1 : 0, tmdbId);
            updated++;
            continue;
        }

        try {
            const data = await fetchFullMovie(tmdbId);

            // Insert TMDB genres
            for (const genre of data.genres) {
                insertGenre.run(genre.name, slugify(genre.name), genre.id);
            }

            // Insert film with aisle and is_nouveaute
            const result = insertFilm.run(
                data.tmdb_id, data.title, data.title_original, data.synopsis, data.release_year,
                data.poster_url, data.backdrop_url,
                JSON.stringify(data.genres), JSON.stringify(data.directors), JSON.stringify(data.actors),
                data.runtime, mapping.aisle, mapping.is_nouveaute ? 1 : 0
            );

            const filmId = result.lastInsertRowid as number;

            // Link film <-> TMDB genres
            for (const genre of data.genres) {
                const row = getGenre.get(genre.id) as { id: number } | undefined;
                if (row) insertFilmGenre.run(filmId, row.id);
            }

            added++;
            const aisleLabel = mapping.aisle || 'no-aisle';
            const nouveauteLabel = mapping.is_nouveaute ? ' [NEW]' : '';
            console.log(`  [${added + skipped + updated + errors}/${allIds.length}] + ${data.title} (${data.tmdb_id}) → ${aisleLabel}${nouveauteLabel}`);
        } catch (err) {
            errors++;
            console.error(`  [${added + skipped + updated + errors}/${allIds.length}] x TMDB ${tmdbId}: ${(err as Error).message}`);
        }

        // Small delay to avoid TMDB rate limits
        await new Promise(r => setTimeout(r, 250));
    }

    console.log(`\nDone: ${added} added, ${updated} updated (aisle/nouveaute), ${errors} errors`);
    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
