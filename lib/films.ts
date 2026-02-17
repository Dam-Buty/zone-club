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
    radarr_vo_id: number | null;
    radarr_vf_id: number | null;
    aisle: string | null;
    is_nouveaute: boolean;
    is_available: boolean;
    transcode_status: string | null;
    transcode_progress: number;
    transcode_error: string | null;
    file_path_vo_transcoded: string | null;
    file_path_vf_transcoded: string | null;
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
        is_nouveaute: !!row.is_nouveaute,
        is_available: !!row.is_available
    };
}

export async function addFilmFromTmdb(tmdbId: number): Promise<Film> {
    const existing = db.prepare('SELECT * FROM films WHERE tmdb_id = ?').get(tmdbId);
    if (existing) {
        throw new Error('Ce film est déjà dans le catalogue');
    }

    const tmdbData = await fetchFullMovieData(tmdbId);

    for (const genre of tmdbData.genres) {
        db.prepare(`
            INSERT OR IGNORE INTO genres (name, slug, tmdb_id)
            VALUES (?, ?, ?)
        `).run(genre.name, slugify(genre.name), genre.id);
    }

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

    for (const genre of tmdbData.genres) {
        const genreRow = db.prepare('SELECT id FROM genres WHERE tmdb_id = ?').get(genre.id) as { id: number };
        db.prepare('INSERT INTO film_genres (film_id, genre_id) VALUES (?, ?)').run(filmId, genreRow.id);
    }

    return getFilmById(filmId)!;
}

export async function triggerDownload(filmId: number): Promise<Film> {
    const film = getFilmById(filmId);
    if (!film) {
        throw new Error('Film introuvable');
    }

    const { vo, vf } = await addToRadarr(film.tmdb_id, film.title);
    db.prepare('UPDATE films SET radarr_vo_id = ?, radarr_vf_id = ? WHERE id = ?').run(vo.id, vf.id, filmId);

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

export function getFilmsByAisle(aisle: string): Film[] {
    return db.prepare(
        'SELECT * FROM films WHERE aisle = ? AND is_available = 1 ORDER BY title'
    ).all(aisle).map(parseFilm);
}

export function getNouveautes(): Film[] {
    return db.prepare(
        'SELECT * FROM films WHERE is_nouveaute = 1 AND is_available = 1 ORDER BY created_at DESC'
    ).all().map(parseFilm);
}

export function setFilmAvailability(filmId: number, available: boolean): void {
    db.prepare('UPDATE films SET is_available = ? WHERE id = ?').run(available ? 1 : 0, filmId);
}

export function setFilmAisle(filmId: number, aisle: string | null): void {
    db.prepare('UPDATE films SET aisle = ? WHERE id = ?').run(aisle, filmId);
}

export function setFilmNouveaute(filmId: number, isNouveaute: boolean): void {
    db.prepare('UPDATE films SET is_nouveaute = ? WHERE id = ?').run(isNouveaute ? 1 : 0, filmId);
}

export function deleteFilm(filmId: number): void {
    db.prepare('DELETE FROM films WHERE id = ?').run(filmId);
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

export interface TranscodeStatusInfo {
  id: number;
  title: string;
  transcode_status: string | null;
  transcode_progress: number;
  transcode_error: string | null;
  radarr_vo_id: number | null;
  radarr_vf_id: number | null;
  file_path_vo: string | null;
  file_path_vf: string | null;
  file_path_vo_transcoded: string | null;
  file_path_vf_transcoded: string | null;
  is_available: boolean;
}

export function getTranscodeStatuses(): TranscodeStatusInfo[] {
  return db.prepare(`
    SELECT id, title, transcode_status, transcode_progress, transcode_error,
           radarr_vo_id, radarr_vf_id, file_path_vo, file_path_vf,
           file_path_vo_transcoded, file_path_vf_transcoded, is_available
    FROM films
    WHERE radarr_vo_id IS NOT NULL OR radarr_vf_id IS NOT NULL
    ORDER BY created_at DESC
  `).all().map(row => ({
    ...(row as any),
    is_available: !!(row as any).is_available
  })) as TranscodeStatusInfo[];
}
