const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface TmdbMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    release_date: string;
    poster_path: string | null;
    backdrop_path: string | null;
    runtime: number;
    genres: { id: number; name: string }[];
}

export interface TmdbCredits {
    cast: {
        id: number;
        name: string;
        character: string;
        profile_path: string | null;
        order: number;
    }[];
    crew: {
        id: number;
        name: string;
        job: string;
        department: string;
    }[];
}

export interface TmdbImages {
    posters: {
        file_path: string;
        iso_639_1: string | null;
    }[];
}

export interface TmdbSearchResult {
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    poster_path: string | null;
    overview: string;
}

async function tmdbFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
    url.searchParams.set('api_key', TMDB_API_KEY || '');
    url.searchParams.set('language', 'fr-FR');

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status}`);
    }

    return response.json();
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
    const data = await tmdbFetch<{ results: TmdbSearchResult[] }>('/search/movie', { query });
    return data.results;
}

export async function getMovie(tmdbId: number): Promise<TmdbMovie> {
    return tmdbFetch<TmdbMovie>(`/movie/${tmdbId}`);
}

export async function getMovieCredits(tmdbId: number): Promise<TmdbCredits> {
    return tmdbFetch<TmdbCredits>(`/movie/${tmdbId}/credits`);
}

export async function getMovieImages(tmdbId: number): Promise<TmdbImages> {
    return tmdbFetch<TmdbImages>(`/movie/${tmdbId}/images`, {
        include_image_language: 'fr,null'
    });
}

export function getPosterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'original' = 'w500'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getBackdropUrl(path: string | null, size: 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export async function fetchFullMovieData(tmdbId: number) {
    const [movie, credits, images] = await Promise.all([
        getMovie(tmdbId),
        getMovieCredits(tmdbId),
        getMovieImages(tmdbId)
    ]);

    // Try to find French poster first
    const frenchPoster = images.posters.find(p => p.iso_639_1 === 'fr');
    const posterPath = frenchPoster?.file_path || movie.poster_path;

    // Get top 10 actors
    const actors = credits.cast
        .sort((a, b) => a.order - b.order)
        .slice(0, 10)
        .map(a => ({
            tmdb_id: a.id,
            name: a.name,
            character: a.character
        }));

    // Get directors
    const directors = credits.crew
        .filter(c => c.job === 'Director')
        .map(d => ({
            tmdb_id: d.id,
            name: d.name
        }));

    return {
        tmdb_id: movie.id,
        title: movie.title,
        title_original: movie.original_title,
        synopsis: movie.overview,
        release_year: movie.release_date ? parseInt(movie.release_date.split('-')[0]) : null,
        poster_url: getPosterUrl(posterPath),
        backdrop_url: getBackdropUrl(movie.backdrop_path),
        runtime: movie.runtime,
        genres: movie.genres,
        actors,
        directors
    };
}
