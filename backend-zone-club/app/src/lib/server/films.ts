import { db } from './db';
import { fetchFullMovieData } from './tmdb';
import { addMovie as addToRadarr } from './radarr';

export interface Film {
    id: number;
    tmdb_id: number;
    title: string;
    title_original: string | null;
    synopsis: string | null;
    release_year: number | null;
    poster_url: string | null;
    backdrop_url: string | null;
    genres: { id: number; name: string }[];
    directors: { tmdb_id: number; name: string }[];
    actors: { tmdb_id: number; name: string; character: string }[];
    runtime: number | null;
    file_path_vf: string | null;
    file_path_vo: string | null;
    subtitle_path: string | null;
    radarr_id: number | null;
    is_available: boolean;
    created_at: string;
}

export interface Genre {
    id: number;
    name: string;
    slug: string;
    tmdb_id: number | null;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function parseFilm(row: any): Film {
    return {
        ...row,
        genres: JSON.parse(row.genres || '[]'),
        directors: JSON.parse(row.directors || '[]'),
        actors: JSON.parse(row.actors || '[]'),
        is_available: !!row.is_available
    };
}

export async function addFilmFromTmdb(tmdbId: number): Promise<Film> {
    // Check if film already exists
    const existing = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
    if (existing) {
        throw new Error('Ce film est déjà dans le catalogue');
    }

    // Fetch data from TMDB
    const tmdbData = await fetchFullMovieData(tmdbId);

    // Ensure genres exist
    for (const genre of tmdbData.genres) {
        db.prepare(`
            INSERT OR IGNORE INTO genres (name, slug, tmdb_id)
            VALUES (?, ?, ?)
        `).run(genre.name, slugify(genre.name), genre.id);
    }

    // Insert film
    const stmt = db.prepare(`
        INSERT INTO films (
            tmdb_id, title, title_original, synopsis, release_year,
            poster_url, backdrop_url, genres, directors, actors, runtime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        tmdbData.tmdb_id,
        tmdbData.title,
        tmdbData.title_original,
        tmdbData.synopsis,
        tmdbData.release_year,
        tmdbData.poster_url,
        tmdbData.backdrop_url,
        JSON.stringify(tmdbData.genres),
        JSON.stringify(tmdbData.directors),
        JSON.stringify(tmdbData.actors),
        tmdbData.runtime
    );

    const filmId = result.lastInsertRowid as number;

    // Link genres
    for (const genre of tmdbData.genres) {
        const genreRow = db.prepare('SELECT id FROM genres WHERE tmdb_id = ?').get(genre.id) as { id: number };
        db.prepare('INSERT INTO film_genres (film_id, genre_id) VALUES (?, ?)').run(filmId, genreRow.id);
    }

    // Try to add to Radarr
    try {
        const radarrMovie = await addToRadarr(tmdbId, tmdbData.title);
        db.prepare('UPDATE films SET radarr_id = ? WHERE id = ?').run(radarrMovie.id, filmId);
    } catch (error) {
        console.error('Failed to add to Radarr:', error);
        // Continue anyway, can be added later
    }

    return getFilmById(filmId)!;
}

export function getFilmById(id: number): Film | null {
    const row = db.prepare('SELECT * FROM films WHERE id = ?').get(id);
    return row ? parseFilm(row) : null;
}

export function getFilmByTmdbId(tmdbId: number): Film | null {
    const row = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
    return row ? parseFilm(row) : null;
}

export function getAllFilms(availableOnly = true): Film[] {
    const query = availableOnly
        ? 'SELECT * FROM films WHERE is_available = 1 ORDER BY created_at DESC'
        : 'SELECT * FROM films ORDER BY created_at DESC';

    return db.prepare(query).all().map(parseFilm);
}

export function getFilmsByGenre(genreSlug: string): Film[] {
    const rows = db.prepare(`
        SELECT f.* FROM films f
        JOIN film_genres fg ON f.id = fg.film_id
        JOIN genres g ON fg.genre_id = g.id
        WHERE g.slug = ? AND f.is_available = 1
        ORDER BY f.release_year DESC
    `).all(genreSlug);

    return rows.map(parseFilm);
}

export function getAllGenres(): Genre[] {
    return db.prepare('SELECT * FROM genres ORDER BY name').all() as Genre[];
}

export function getGenresWithFilmCount(): (Genre & { film_count: number })[] {
    return db.prepare(`
        SELECT g.*, COUNT(fg.film_id) as film_count
        FROM genres g
        LEFT JOIN film_genres fg ON g.id = fg.genre_id
        LEFT JOIN films f ON fg.film_id = f.id AND f.is_available = 1
        GROUP BY g.id
        HAVING film_count > 0
        ORDER BY g.name
    `).all() as (Genre & { film_count: number })[];
}

export function setFilmAvailability(filmId: number, available: boolean): void {
    db.prepare('UPDATE films SET is_available = ? WHERE id = ?').run(available ? 1 : 0, filmId);
}

export function updateFilmPaths(filmId: number, paths: {
    file_path_vf?: string;
    file_path_vo?: string;
    subtitle_path?: string;
}): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (paths.file_path_vf !== undefined) {
        updates.push('file_path_vf = ?');
        values.push(paths.file_path_vf);
    }
    if (paths.file_path_vo !== undefined) {
        updates.push('file_path_vo = ?');
        values.push(paths.file_path_vo);
    }
    if (paths.subtitle_path !== undefined) {
        updates.push('subtitle_path = ?');
        values.push(paths.subtitle_path);
    }

    if (updates.length > 0) {
        values.push(filmId);
        db.prepare(`UPDATE films SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
}
