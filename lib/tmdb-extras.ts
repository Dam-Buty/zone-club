// Ce que la fiche détaillée d'un film (borne de location) retient d'une réponse de TMDB :
// accroche, classification et sortie en France, pays, équipe, note des spectateurs. Pas la
// bande-annonce : TMDB ne pointe que vers YouTube, dont le lecteur peut diffuser des publicités ;
// elle vient d'Allociné (lib/trailers.ts).
// Module pur, sans import, pour être testé tel quel (tests/domain/film-extras.test.mjs). La route
// /api/films/[tmdbId]/extras s'en sert et garde le résultat en cache.

export interface FilmExtras {
  tagline: string | null;
  /** Classification de la sortie en France (« 12 », « 16 », « U »…), telle que TMDB la donne. */
  certification: string | null;
  /** Sortie en salles en France, AAAA-MM-JJ. */
  releaseDate: string | null;
  /** Pays de production, en français. */
  countries: string[];
  crew: { screenplay: string[]; music: string[]; photography: string[]; editing: string[] };
  vote: { average: number; count: number } | null;
}

export interface TmdbMovieAppended {
  tagline?: string | null;
  vote_average?: number;
  vote_count?: number;
  production_countries?: { iso_3166_1: string; name?: string }[];
  credits?: { crew?: { name: string; job: string }[] };
  release_dates?: {
    results?: { iso_3166_1: string; release_dates?: { certification?: string; type?: number; release_date?: string }[] }[];
  };
}

const CREW_JOBS = {
  screenplay: ['Screenplay', 'Writer'],
  music: ['Original Music Composer', 'Music'],
  photography: ['Director of Photography'],
  editing: ['Editor'],
} as const;
const MAX_PER_JOB = 3;

function crewNames(crew: { name: string; job: string }[], jobs: readonly string[]): string[] {
  const out: string[] = [];
  for (const job of jobs) {
    for (const member of crew) {
      if (member.job === job && member.name && !out.includes(member.name)) out.push(member.name);
    }
  }
  return out.slice(0, MAX_PER_JOB);
}

function frenchCountry(code: string, fallback?: string): string {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

/** Extrait de la réponse de TMDB (langue fr-FR, append_to_response=credits,release_dates). */
export function parseMovieExtras(movie: TmdbMovieAppended): FilmExtras {
  const france = (movie.release_dates?.results ?? []).find((r) => r.iso_3166_1 === 'FR')?.release_dates ?? [];
  const withCertification = france.filter((d) => (d.certification ?? '').trim() !== '');
  const certification = (withCertification.find((d) => d.type === 3) ?? withCertification[0])?.certification?.trim() ?? null;
  const theatrical = france.find((d) => d.type === 3) ?? france.find((d) => d.type === 2);
  const releaseDate = theatrical?.release_date ? theatrical.release_date.slice(0, 10) : null;
  const crew = movie.credits?.crew ?? [];
  const tagline = (movie.tagline ?? '').trim();
  return {
    tagline: tagline || null,
    certification,
    releaseDate,
    countries: (movie.production_countries ?? []).map((c) => frenchCountry(c.iso_3166_1, c.name)),
    crew: {
      screenplay: crewNames(crew, CREW_JOBS.screenplay),
      music: crewNames(crew, CREW_JOBS.music),
      photography: crewNames(crew, CREW_JOBS.photography),
      editing: crewNames(crew, CREW_JOBS.editing),
    },
    vote: movie.vote_count && movie.vote_count > 0 ? { average: Math.round((movie.vote_average ?? 0) * 10) / 10, count: movie.vote_count } : null,
  };
}
