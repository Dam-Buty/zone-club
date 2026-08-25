import { db } from './db';
import { fetchFullMovieData } from './tmdb';
import { addMovie as addToRadarr } from './radarr';
import { RENTAL_COSTS, RENTAL_DURATIONS, type RentalTier } from '../src/types';

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
    // file_path_vf / file_path_vo / subtitle_path : colonnes de l'ère 2×Radarr.
    // Vidées par la migration, plus aucun writer depuis la suppression de
    // updateFilmPaths — retirées de l'interface, conservées en base le temps que
    // la fenêtre de rollback se ferme (comme radarr_vo_id / radarr_vf_id).
    radarr_vo_id: number | null;
    radarr_vf_id: number | null;
    radarr_id: number | null;
    original_language: string | null;
    media_dir: string | null;
    subtitle_fr_vtt: string | null;
    subtitle_fr_srt: string | null;
    subtitle_en_vtt: string | null;
    subtitle_en_srt: string | null;
    qc_attempts: number;
    /** Laissez-passer manuel : 1 = le contrôle qualité est ignoré pour ce film. */
    qc_force: number;
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

export function parseFilm(row: any): Film {
    return {
        ...row,
        genres: JSON.parse(row.genres || '[]'),
        directors: JSON.parse(row.directors || '[]'),
        actors: JSON.parse(row.actors || '[]'),
        is_nouveaute: !!row.is_nouveaute,
        is_available: !!row.is_available
    };
}

// TMDB genre ID → aisle mapping (first matching genre wins)
const TMDB_GENRE_TO_AISLE: Record<number, string> = {
    28: 'action',       // Action
    12: 'aventure',     // Adventure
    16: 'animation',    // Animation
    35: 'comedie',      // Comedy
    80: 'policier',     // Crime
    18: 'drame',        // Drama
    14: 'aventure',     // Fantasy → aventure
    36: 'drame',        // History → drame
    27: 'horreur',      // Horror
    10402: 'bizarre',   // Music → bizarre
    9648: 'policier',   // Mystery → policier
    10749: 'romance',   // Romance
    878: 'sf',          // Science Fiction
    53: 'thriller',     // Thriller
    10752: 'action',    // War → action
    37: 'bizarre',      // Western → bizarre
}

/**
 * Auto-assign aisle based on TMDB genres.
 * Uses first matching genre (TMDB orders by relevance).
 * Films released before 1980 go to 'classiques'.
 * Returns null if no genre matches.
 */
export function autoAssignAisle(genres: { id: number }[], releaseYear?: number | null): string | null {
    if (releaseYear && releaseYear < 1980) return 'classiques'
    for (const genre of genres) {
        const aisle = TMDB_GENRE_TO_AISLE[genre.id]
        if (aisle) return aisle
    }
    return null
}

export function getFilmTier(film: Film): RentalTier {
    if (film.is_nouveaute) return 'nouveaute';
    if (film.aisle === 'classiques') return 'classique';
    return 'standard';
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

    const aisle = autoAssignAisle(tmdbData.genres, tmdbData.release_year);
    const isNouveaute = tmdbData.release_year ? tmdbData.release_year >= 2015 : false;

    const stmt = db.prepare(`
        INSERT INTO films (
            tmdb_id, title, title_original, original_language, synopsis, release_year,
            poster_url, backdrop_url, genres, directors, actors, runtime,
            aisle, is_nouveaute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        tmdbData.tmdb_id,
        tmdbData.title,
        tmdbData.title_original,
        tmdbData.original_language,
        tmdbData.synopsis,
        tmdbData.release_year,
        tmdbData.poster_url,
        tmdbData.backdrop_url,
        JSON.stringify(tmdbData.genres),
        JSON.stringify(tmdbData.directors),
        JSON.stringify(tmdbData.actors),
        tmdbData.runtime,
        aisle,
        isNouveaute ? 1 : 0
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

    // Films FR → profil TrueFrench, sinon → profil MultiAudio (release combinée VF+VO)
    const isFrench = film.original_language === 'fr';
    const profileId = isFrench
        ? parseInt(process.env.RADARR_QUALITY_PROFILE_ID_FR || '', 10) || parseInt(process.env.RADARR_QUALITY_PROFILE_ID || '7', 10)
        : parseInt(process.env.RADARR_QUALITY_PROFILE_ID || '7', 10);
    const { id } = await addToRadarr(film.tmdb_id, film.title, profileId);
    db.prepare('UPDATE films SET radarr_id = ? WHERE id = ?').run(id, filmId);

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

export function getAllAvailableFilmsGroupedByAisle(): Map<string, Film[]> {
    const films = db.prepare(
        'SELECT * FROM films WHERE is_available = 1 ORDER BY title'
    ).all().map(parseFilm);
    const grouped = new Map<string, Film[]>();
    for (const film of films) {
        if (film.aisle) {
            const list = grouped.get(film.aisle) || [];
            list.push(film);
            grouped.set(film.aisle, list);
        }
        if (film.is_nouveaute) {
            const list = grouped.get('nouveautes') || [];
            list.push(film);
            grouped.set('nouveautes', list);
        }
    }
    return grouped;
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

export function setFilmStock(filmId: number, stock: number): void {
    const clamped = Math.max(1, Math.min(10, Math.round(stock)));
    db.prepare('UPDATE films SET stock = ? WHERE id = ?').run(clamped, filmId);
}

export function deleteFilm(filmId: number): void {
    db.prepare('DELETE FROM films WHERE id = ?').run(filmId);
}

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

export interface TranscodeStatusInfo {
  id: number;
  title: string;
  transcode_status: string | null;
  transcode_progress: number;
  transcode_error: string | null;
  radarr_id: number | null;
  file_path_vo_transcoded: string | null;
  file_path_vf_transcoded: string | null;
  is_available: boolean;
}

export function getTranscodeStatuses(): TranscodeStatusInfo[] {
  return db.prepare(`
    SELECT id, title, transcode_status, transcode_progress, transcode_error,
           radarr_id, file_path_vo_transcoded, file_path_vf_transcoded, is_available
    FROM films
    WHERE radarr_id IS NOT NULL
    ORDER BY created_at DESC
  `).all().map(row => ({
    ...(row as any),
    is_available: !!(row as any).is_available
  })) as TranscodeStatusInfo[];
}
