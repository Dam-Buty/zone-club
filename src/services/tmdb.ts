import type { Film } from '../types';

const API_KEY = import.meta.env.VITE_TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface TMDBVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface TMDBSearchResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
}

export interface TMDBSearchResponse {
  page: number;
  results: TMDBSearchResult[];
  total_pages: number;
  total_results: number;
}

export const tmdb = {
  posterUrl: (path: string | null, size: 'w342' | 'w500' | 'original' = 'w500') =>
    path ? `${IMAGE_BASE}/${size}${path}` : '/placeholder-poster.jpg',

  backdropUrl: (path: string | null, size: 'w780' | 'w1280' | 'original' = 'w1280') =>
    path ? `${IMAGE_BASE}/${size}${path}` : null,

  async getFilm(id: number): Promise<Film> {
    const res = await fetch(
      `${BASE_URL}/movie/${id}?api_key=${API_KEY}&language=fr-FR`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    return res.json();
  },

  async getFilms(ids: number[]): Promise<Film[]> {
    const results = await Promise.all(
      ids.map((id) => this.getFilm(id).catch(() => null))
    );
    return results.filter((f): f is Film => f !== null);
  },

  async getVideos(id: number): Promise<TMDBVideo[]> {
    // Try French first, fallback to English for trailers
    const resFr = await fetch(
      `${BASE_URL}/movie/${id}/videos?api_key=${API_KEY}&language=fr-FR`
    );
    if (!resFr.ok) throw new Error(`TMDB error: ${resFr.status}`);
    const dataFr = await resFr.json();

    // If no French videos, try English
    if (dataFr.results.length === 0) {
      const resEn = await fetch(
        `${BASE_URL}/movie/${id}/videos?api_key=${API_KEY}&language=en-US`
      );
      if (!resEn.ok) throw new Error(`TMDB error: ${resEn.status}`);
      const dataEn = await resEn.json();
      return dataEn.results;
    }

    return dataFr.results;
  },

  getYouTubeUrl(videoKey: string): string {
    return `https://www.youtube.com/watch?v=${videoKey}`;
  },

  getYouTubeEmbedUrl(videoKey: string): string {
    return `https://www.youtube.com/embed/${videoKey}?autoplay=1`;
  },

  async search(query: string, page: number = 1): Promise<TMDBSearchResponse> {
    if (!query.trim()) {
      return { page: 1, results: [], total_pages: 0, total_results: 0 };
    }
    const res = await fetch(
      `${BASE_URL}/search/movie?api_key=${API_KEY}&language=fr-FR&query=${encodeURIComponent(query)}&page=${page}&include_adult=false`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    return res.json();
  },

  async getPopular(page: number = 1): Promise<TMDBSearchResponse> {
    const res = await fetch(
      `${BASE_URL}/movie/popular?api_key=${API_KEY}&language=fr-FR&page=${page}&region=FR`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    return res.json();
  },

  async getNowPlaying(page: number = 1): Promise<TMDBSearchResponse> {
    const res = await fetch(
      `${BASE_URL}/movie/now_playing?api_key=${API_KEY}&language=fr-FR&page=${page}&region=FR`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    return res.json();
  },

  /**
   * Récupère les meilleurs films des 10 dernières années par note TMDB
   * Utilise l'endpoint discover avec tri par vote_average
   * @param pages Nombre de pages à récupérer (20 films par page)
   */
  async getTopRatedRecent(pages: number = 2): Promise<TMDBSearchResult[]> {
    const currentYear = new Date().getFullYear();
    const tenYearsAgo = currentYear - 10;
    const dateFrom = `${tenYearsAgo}-01-01`;

    const allResults: TMDBSearchResult[] = [];

    for (let page = 1; page <= pages; page++) {
      const res = await fetch(
        `${BASE_URL}/discover/movie?api_key=${API_KEY}&language=fr-FR&sort_by=vote_average.desc&primary_release_date.gte=${dateFrom}&vote_count.gte=1000&page=${page}&include_adult=false`
      );
      if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
      const data: TMDBSearchResponse = await res.json();
      allResults.push(...data.results);
    }

    return allResults;
  },
};
