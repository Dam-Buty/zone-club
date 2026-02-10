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

export interface TMDBImage {
  file_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
}

export interface TMDBCast {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBCrew {
  id: number;
  name: string;
  job: string;
  department: string;
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

  async getImages(id: number): Promise<TMDBImage[]> {
    const res = await fetch(
      `${BASE_URL}/movie/${id}/images?api_key=${API_KEY}&include_image_language=null`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    const data = await res.json();
    return data.backdrops || [];
  },

  async getMovieLogo(id: number): Promise<string | null> {
    const res = await fetch(
      `${BASE_URL}/movie/${id}/images?api_key=${API_KEY}&include_image_language=en,fr,null`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const logos: TMDBImage[] = data.logos || [];
    if (logos.length === 0) return null;
    // Prefer French, then English, then any — pick widest for quality
    const frLogo = logos.find((l: TMDBImage & { iso_639_1?: string }) =>
      (l as TMDBImage & { iso_639_1?: string }).iso_639_1 === 'fr'
    );
    const best = frLogo || logos.sort((a, b) => b.width - a.width)[0];
    return best ? `${IMAGE_BASE}/w500${best.file_path}` : null;
  },

  async getCompanyLogo(companyId: number): Promise<string | null> {
    try {
      const res = await fetch(
        `${BASE_URL}/company/${companyId}?api_key=${API_KEY}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.logo_path ? `${IMAGE_BASE}/w200${data.logo_path}` : null;
    } catch {
      return null;
    }
  },

  async getCredits(id: number): Promise<{
    directors: string[]
    actors: string[]
    secondaryActors: string[]
    producers: string[]
    writers: string[]
    composer: string
  }> {
    const res = await fetch(
      `${BASE_URL}/movie/${id}/credits?api_key=${API_KEY}&language=fr-FR`
    );
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    const data = await res.json();
    const allCast = (data.cast || [])
      .sort((a: TMDBCast, b: TMDBCast) => a.order - b.order);
    const directors = (data.crew || [])
      .filter((c: TMDBCrew) => c.job === 'Director')
      .map((c: TMDBCrew) => c.name);
    const actors = allCast.slice(0, 5).map((c: TMDBCast) => c.name);
    const secondaryActors = allCast.slice(5, 12).map((c: TMDBCast) => c.name);
    const producers = (data.crew || [])
      .filter((c: TMDBCrew) => c.job === 'Producer')
      .slice(0, 3)
      .map((c: TMDBCrew) => c.name);
    const seenWriters = new Set<string>();
    const writers = (data.crew || [])
      .filter((c: TMDBCrew) => c.department === 'Writing')
      .filter((c: TMDBCrew) => { if (seenWriters.has(c.name)) return false; seenWriters.add(c.name); return true; })
      .slice(0, 2)
      .map((c: TMDBCrew) => c.name);
    const composerEntry = (data.crew || [])
      .find((c: TMDBCrew) => c.job === 'Original Music Composer');
    const composer = composerEntry?.name || '';
    return { directors, actors, secondaryActors, producers, writers, composer };
  },

  async getCertification(id: number): Promise<string> {
    try {
      const res = await fetch(
        `${BASE_URL}/movie/${id}/release_dates?api_key=${API_KEY}`
      );
      if (!res.ok) return '';
      const data = await res.json();
      const results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[] = data.results || [];
      // Prefer FR, then US, then any
      for (const country of ['FR', 'US', 'GB', 'DE']) {
        const entry = results.find(r => r.iso_3166_1 === country);
        if (entry) {
          // Prefer theatrical (3), then limited (2), then premiere (1), then any
          for (const type of [3, 4, 5, 6, 1, 2]) {
            const rd = entry.release_dates.find(d => d.type === type && d.certification?.trim());
            if (rd) return rd.certification.trim();
          }
          const any = entry.release_dates.find(d => d.certification?.trim());
          if (any) return any.certification.trim();
        }
      }
      // Fallback: first certification found
      for (const entry of results) {
        const any = entry.release_dates.find((d: { certification: string }) => d.certification?.trim());
        if (any) return any.certification.trim();
      }
      return '';
    } catch {
      return '';
    }
  },

  async getReviews(id: number): Promise<{ author: string; content: string }[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/movie/${id}/reviews?api_key=${API_KEY}&language=en-US&page=1`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || [])
        .filter((r: { author_details?: { rating?: number | null } }) => {
          const rating = r.author_details?.rating;
          return rating == null || rating >= 7;
        })
        .slice(0, 2)
        .map((r: { author?: string; content?: string }) => {
          let content = (r.content || '').replace(/[#*_~`\r\n]+/g, ' ').trim();
          const match = content.match(/^[^.!?]{10,}[.!?]/);
          if (match && match[0].length <= 150) {
            content = match[0];
          } else if (content.length > 120) {
            content = content.substring(0, 117) + '...';
          }
          return { author: r.author || 'Critique', content };
        });
    } catch {
      return [];
    }
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
