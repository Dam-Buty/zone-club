import type { ApiFilm } from '../../src/api';

/**
 * Ligne renvoyée par `/api/films?all=true` pour un admin : `getAllFilms` sert la
 * ligne SQLite entière, donc les colonnes média sont présentes même si le type
 * `ApiFilm` public ne les déclare pas.
 */
export interface AdminFilmRow extends ApiFilm {
    title_original: string | null;
    original_language: string | null;
    transcode_status: string | null;
    transcode_progress: number | null;
    transcode_error: string | null;
    file_path_vf_transcoded: string | null;
    file_path_vo_transcoded: string | null;
    subtitle_fr_vtt: string | null;
    subtitle_en_vtt: string | null;
}

export type AudioFilter = 'all' | 'both' | 'vf-only' | 'vo-only' | 'none';
export type SubtitleFilter = 'all' | 'both' | 'fr-only' | 'en-only' | 'none' | 'no-fr' | 'no-en';
export type AvailabilityFilter = 'all' | 'available' | 'hidden';

export interface AdminFilmFilters {
    search: string;
    aisle: string;
    language: string;
    audio: AudioFilter;
    subtitles: SubtitleFilter;
    status: string;
    availability: AvailabilityFilter;
    sortBy: 'title' | 'year' | 'language' | 'aisle' | 'status';
    sortDir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: AdminFilmFilters = {
    search: '',
    aisle: 'all',
    language: 'all',
    audio: 'all',
    subtitles: 'all',
    status: 'all',
    availability: 'all',
    sortBy: 'title',
    sortDir: 'asc',
};

export const hasVf = (film: AdminFilmRow): boolean => !!film.file_path_vf_transcoded;
export const hasVo = (film: AdminFilmRow): boolean => !!film.file_path_vo_transcoded;
export const hasFr = (film: AdminFilmRow): boolean => !!film.subtitle_fr_vtt;
export const hasEn = (film: AdminFilmRow): boolean => !!film.subtitle_en_vtt;

function matchesAudio(film: AdminFilmRow, filter: AudioFilter): boolean {
    const vf = hasVf(film);
    const vo = hasVo(film);
    switch (filter) {
        case 'both': return vf && vo;
        case 'vf-only': return vf && !vo;
        case 'vo-only': return !vf && vo;
        case 'none': return !vf && !vo;
        default: return true;
    }
}

function matchesSubtitles(film: AdminFilmRow, filter: SubtitleFilter): boolean {
    const fr = hasFr(film);
    const en = hasEn(film);
    switch (filter) {
        case 'both': return fr && en;
        case 'fr-only': return fr && !en;
        case 'en-only': return !fr && en;
        case 'none': return !fr && !en;
        case 'no-fr': return !fr;
        case 'no-en': return !en;
        default: return true;
    }
}

export function filterAdminFilms(
    films: AdminFilmRow[],
    filters: AdminFilmFilters,
): AdminFilmRow[] {
    const query = filters.search.trim().toLowerCase();

    return films
        .filter(film => {
            if (query) {
                const haystack = `${film.title} ${film.title_original ?? ''} ${film.tmdb_id}`.toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            if (filters.aisle !== 'all' && (film.aisle ?? 'none') !== filters.aisle) return false;
            if (filters.language !== 'all' && (film.original_language ?? 'none') !== filters.language) return false;
            if (filters.status !== 'all' && (film.transcode_status ?? 'none') !== filters.status) return false;
            if (filters.availability === 'available' && !film.is_available) return false;
            if (filters.availability === 'hidden' && film.is_available) return false;
            return matchesAudio(film, filters.audio) && matchesSubtitles(film, filters.subtitles);
        })
        .sort((a, b) => {
            let cmp = 0;
            switch (filters.sortBy) {
                case 'year':
                    cmp = (a.release_year ?? 0) - (b.release_year ?? 0);
                    break;
                case 'language':
                    cmp = (a.original_language ?? 'zzz').localeCompare(b.original_language ?? 'zzz');
                    break;
                case 'aisle':
                    cmp = (a.aisle ?? 'zzz').localeCompare(b.aisle ?? 'zzz');
                    break;
                case 'status':
                    cmp = (a.transcode_status ?? 'zzz').localeCompare(b.transcode_status ?? 'zzz');
                    break;
                default:
                    cmp = a.title.localeCompare(b.title, 'fr');
            }
            return filters.sortDir === 'desc' ? -cmp : cmp;
        });
}

export function coverageOf(films: AdminFilmRow[]) {
    const total = films.length;
    const fr = films.filter(hasFr).length;
    const en = films.filter(hasEn).length;
    return {
        total,
        fr,
        en,
        frPct: total ? Math.round((fr / total) * 100) : 0,
        enPct: total ? Math.round((en / total) * 100) : 0,
    };
}
