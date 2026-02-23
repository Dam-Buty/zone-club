/**
 * API Service pour communiquer avec le backend Zone Club
 */

const API_BASE = '';

// Types correspondant au backend
export interface ApiUser {
  id: number;
  username: string;
  credits: number;
  is_admin: boolean;
  created_at: string;
}

export interface ApiFilm {
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
  radarr_vo_id: number | null;
  radarr_vf_id: number | null;
  aisle: string | null;
  is_nouveaute: boolean;
  is_available: boolean;
  stock?: number;
  active_rentals?: number;
  created_at: string;
}

export interface ApiRental {
  id: number;
  user_id: number;
  film_id: number;
  symlink_uuid: string;
  rented_at: string;
  expires_at: string;
  is_active: boolean;
}

export interface ApiRentalWithFilm extends ApiRental {
  film: ApiFilm;
  streaming_urls: {
    vf: string | null;
    vo: string | null;
    subtitles: string | null;
  };
  time_remaining: number; // minutes
  // Gamification fields
  watch_progress: number;
  watch_completed_at: string | null;
  extension_used: boolean;
  rewind_claimed: boolean;
  viewing_mode: string | null;
}

export interface ApiReview {
  id: number;
  user_id: number;
  film_id: number;
  content: string;
  rating_direction: number;
  rating_screenplay: number;
  rating_acting: number;
  created_at: string;
}

export interface ApiGenre {
  id: number;
  name: string;
  slug: string;
  tmdb_id: number | null;
}

// Error handling
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Erreur inconnue' }));
    throw new ApiError(response.status, errorData.message || `Erreur ${response.status}`);
  }

  // Handle empty responses (204)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// ============ AUTH ============

export interface RegisterResponse {
  user: ApiUser;
  recoveryPhrase: string;
}

export interface LoginResponse {
  user: ApiUser;
}

export const auth = {
  async register(username: string, password: string): Promise<RegisterResponse> {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async login(username: string, password: string): Promise<LoginResponse> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' });
  },

  async recover(
    username: string,
    recoveryPhrase: string,
    newPassword: string
  ): Promise<{ user: ApiUser; newRecoveryPhrase: string }> {
    return request('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ username, recoveryPhrase, newPassword }),
    });
  },
};

// ============ RENTALS ============

export const rentals = {
  async rent(filmId: number): Promise<{ rental: ApiRentalWithFilm }> {
    // filmId ici est l'ID interne du film (pas tmdb_id)
    return request(`/api/rentals/${filmId}`, { method: 'POST' });
  },

  async updateProgress(filmId: number, progress: number): Promise<{ ok: boolean }> {
    return request(`/api/rentals/${filmId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progress }),
    });
  },

  async extend(filmId: number): Promise<{ rental: ApiRentalWithFilm }> {
    return request(`/api/rentals/${filmId}/extend`, { method: 'PATCH' });
  },

  async claimRewind(filmId: number): Promise<{ ok: boolean; credits: number }> {
    return request(`/api/rentals/${filmId}/rewind`, { method: 'POST' });
  },

  async setViewingMode(filmId: number, mode: 'sur_place' | 'emporter'): Promise<{ rental: ApiRentalWithFilm }> {
    return request(`/api/rentals/${filmId}/viewing-mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    });
  },

  async returnFilm(filmId: number): Promise<{ earlyReturnCredit: boolean }> {
    return request(`/api/rentals/${filmId}/return`, { method: 'POST' });
  },

  async requestReturn(filmId: number): Promise<{ ok: boolean }> {
    return request(`/api/rentals/${filmId}/request-return`, { method: 'POST' });
  },
};

// ============ REVIEWS ============

export interface CreateReviewData {
  content: string;
  rating_direction: number;
  rating_screenplay: number;
  rating_acting: number;
}

export interface ReviewWithUser extends ApiReview {
  username: string;
  average_rating: number;
}

export interface FilmRatings {
  direction: number;
  screenplay: number;
  acting: number;
  overall: number;
  count: number;
}

export interface ReviewsResponse {
  reviews: ReviewWithUser[];
  ratings: FilmRatings | null;
  canReview: {
    allowed: boolean;
    reason?: string;
  };
}

export const reviews = {
  async getByFilm(filmId: number): Promise<ReviewsResponse> {
    return request(`/api/reviews/${filmId}`);
  },

  async create(filmId: number, data: CreateReviewData): Promise<{ review: ApiReview }> {
    return request(`/api/reviews/${filmId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============ FILM REQUESTS ============

export interface FilmRequestData {
  tmdb_id: number;
  title: string;
  poster_url?: string | null;
}

export interface ApiFilmRequest {
  id: number;
  user_id: number;
  tmdb_id: number;
  title: string;
  poster_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'added';
  admin_note: string | null;
  created_at: string;
}

export const filmRequests = {
  async getAll(): Promise<ApiFilmRequest[]> {
    return request('/api/requests');
  },

  async create(data: FilmRequestData): Promise<{ request: ApiFilmRequest }> {
    return request('/api/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============ FILMS ============

export interface FilmWithRentalStatus extends ApiFilm {
  rental_status: {
    is_rented: boolean;
    rented_by_current_user: boolean;
    rental?: ApiRentalWithFilm;
    stock: number;
    active_rentals: number;
    available_copies: number;
    earliest_return?: string;
  };
}

export interface ApiReturnRequest {
  id: number;
  film_id: number;
  requester_id: number;
  rental_id: number;
  message: string | null;
  status: string;
  created_at: string;
  film_title?: string;
  requester_name?: string;
}

export const films = {
  async getByGenre(slug: string): Promise<{ genre: ApiGenre; films: ApiFilm[] }> {
    return request(`/api/films/genre/${slug}`);
  },

  async getByAisle(aisle: string): Promise<{ aisle: string; films: ApiFilm[] }> {
    return request(`/api/films/aisle/${aisle}`);
  },

  async getById(tmdbId: number): Promise<FilmWithRentalStatus> {
    return request(`/api/films/${tmdbId}`);
  },

  async getAll(): Promise<ApiFilm[]> {
    return request('/api/films');
  },
};

// ============ GENRES ============

export interface ApiGenreWithCount extends ApiGenre {
  film_count: number;
}

export const genres = {
  async getAll(): Promise<ApiGenreWithCount[]> {
    return request('/api/genres');
  },
};

// ============ USER / ME ============

export interface WeeklyBonusStatus {
  canClaim: boolean;
  amount: number;
  reason?: string;
}

export interface MeResponse {
  user: ApiUser;
  activeRentals: ApiRentalWithFilm[];
  rentalHistory: ApiRental[];
  reviews: ReviewWithUser[];
  weeklyBonus: WeeklyBonusStatus;
}

export const me = {
  async get(): Promise<MeResponse> {
    return request('/api/me');
  },

  async getNotifications(): Promise<{ notifications: ApiReturnRequest[] }> {
    return request('/api/me/notifications');
  },

  async getWeeklyBonusStatus(): Promise<WeeklyBonusStatus> {
    return request('/api/me/weekly-bonus');
  },

  async claimWeeklyBonus(): Promise<{ credits_awarded: number; new_balance: number }> {
    return request('/api/me/weekly-bonus', { method: 'POST' });
  },
};

// ============ ADMIN ============

export interface AdminStats {
  totalUsers: number;
  totalFilms: number;
  availableFilms: number;
  activeRentals: number;
  totalRentals: number;
  totalReviews: number;
  pendingRequests: number;
}

export interface TranscodeStatus {
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

export interface FilmRequestWithUser extends ApiFilmRequest {
  username: string;
}

export const admin = {
  async getStats(): Promise<AdminStats> {
    return request('/api/admin/stats');
  },

  async getAllFilms(): Promise<ApiFilm[]> {
    return request('/api/films?all=true');
  },

  async getRequests(status?: string): Promise<FilmRequestWithUser[]> {
    const url = status ? `/api/admin/requests?status=${status}` : '/api/admin/requests';
    return request(url);
  },

  async updateRequestStatus(requestId: number, status: 'approved' | 'rejected' | 'added', adminNote?: string): Promise<void> {
    await request(`/api/admin/requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, admin_note: adminNote }),
    });
  },

  async addFilm(tmdbId: number): Promise<{ film: ApiFilm }> {
    return request('/api/admin/films', {
      method: 'POST',
      body: JSON.stringify({ tmdb_id: tmdbId }),
    });
  },

  async setFilmAvailability(filmId: number, available: boolean): Promise<void> {
    await request(`/api/admin/films/${filmId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ available }),
    });
  },

  async downloadFilm(filmId: number): Promise<{ film: ApiFilm }> {
    return request(`/api/admin/films/${filmId}/download`, {
      method: 'POST',
    });
  },

  async setFilmAisle(filmId: number, updates: { aisle?: string | null; is_nouveaute?: boolean; stock?: number }): Promise<void> {
    await request(`/api/admin/films/${filmId}/aisle`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async getTranscodeStatus(): Promise<TranscodeStatus[]> {
    return request('/api/admin/films/status');
  },
};

// Export par défaut
export const api = {
  auth,
  rentals,
  reviews,
  films,
  genres,
  me,
  filmRequests,
  admin,
};

export default api;
