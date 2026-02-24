// Film types
export interface Film {
  id: number;
  tmdb_id?: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number | null;
  vote_average: number;
  vote_count?: number;
  genres: Genre[];
  tagline?: string;
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  is_available?: boolean;
  stock?: number;
  active_rentals?: number;
  directors?: string[];
  actors?: string[];
}

export interface Genre {
  id: number;
  name: string;
}

export type AisleType = 'nouveautes' | 'action' | 'horreur' | 'comedie' | 'drame' | 'thriller' | 'policier' | 'sf' | 'animation' | 'classiques';

// Streaming URLs from backend
export interface StreamingUrls {
  vf: string | null;
  vo: string | null;
  subtitles: string | null;
}

// Rental types
export type ViewingMode = 'sur_place' | 'emporter';

export interface Rental {
  filmId: number;
  rentedAt: number; // timestamp
  expiresAt: number; // timestamp
  videoUrl: string;
  streamingUrls?: StreamingUrls;
  // Gamification fields
  watchProgress: number;             // 0-100
  watchCompletedAt: number | null;   // timestamp when 80%+ reached
  extensionUsed: boolean;
  rewindClaimed: boolean;
  viewingMode: ViewingMode | null;
}

export type RentalTier = 'standard' | 'nouveaute' | 'classique';

export const RENTAL_COSTS: Record<RentalTier, number> = {
  standard: 1,
  nouveaute: 2,
  classique: 1,
};

export const RENTAL_DURATIONS: Record<RentalTier, number> = {
  standard: 72 * 60 * 60 * 1000,    // 72h
  nouveaute: 48 * 60 * 60 * 1000,   // 48h
  classique: 7 * 24 * 60 * 60 * 1000, // 1 week
};

// User types
export type MemberLevel = 'bronze' | 'argent' | 'or' | 'platine';

// User local (mode hors-ligne / non connecté)
export interface LocalUser {
  credits: number;
  totalRentals: number;
  level: MemberLevel;
  badges: string[];
}

// User authentifié (depuis le backend)
export interface AuthUser {
  id: number;
  username: string;
  credits: number;
  is_admin: boolean;
}

// Compatibilité avec l'ancien type User
export type User = LocalUser;

// Manager types
export type ManagerTrigger = 'HOVER_LONG' | 'HESITATION' | 'GENRE_RETURN' | 'POST_RENTAL' | 'BELL_CLICK';

export interface ManagerResponse {
  text: string;
  filmId?: number;
}

export interface FilmAnecdote {
  anecdotes: string[];
  suggestion?: {
    filmId: number;
    reason: string;
  };
}

// TMDB credit/person types
export interface CreditPerson {
  id: number;
  name: string;
  character?: string;
  job?: string;
  profile_path: string | null;
}

export interface DetailedCredits {
  directors: CreditPerson[];
  actors: CreditPerson[];
  writers: CreditPerson[];
  producers: CreditPerson[];
  composer: CreditPerson | null;
}

export interface PersonDetail {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
}

// Scene types
export type SceneType = 'exterior' | 'interior';

// Player types
export type PlayerState = 'playing' | 'paused' | 'seeking' | 'rewinding' | 'fastforwarding';
