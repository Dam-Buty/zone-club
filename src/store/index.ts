import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Film, Rental, AisleType, SceneType, MemberLevel } from '../types';
import api, { type ApiRentalWithFilm, type ApiFilm, type ReviewWithUser } from '../api';
import { preloadPosterImage } from '../utils/CassetteTextureArray';
import { fetchVHSCoverData } from '../utils/VHSCoverGenerator';

function calculateLevel(totalRentals: number): MemberLevel {
  if (totalRentals >= 50) return 'platine';
  if (totalRentals >= 25) return 'or';
  if (totalRentals >= 10) return 'argent';
  return 'bronze';
}

// Extract TMDB path from full poster URL
// e.g. "https://image.tmdb.org/t/p/w500/xxx.jpg" → "/xxx.jpg"
function extractTmdbPath(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/t\/p\/\w+(\/.+)$/);
  return match ? match[1] : null;
}

// Convertit un ApiFilm en Film frontend
function apiFilmToFilm(apiFilm: ApiFilm): Film {
  return {
    id: apiFilm.id,
    tmdb_id: apiFilm.tmdb_id,
    title: apiFilm.title,
    overview: apiFilm.synopsis || '',
    poster_path: extractTmdbPath(apiFilm.poster_url),
    backdrop_path: extractTmdbPath(apiFilm.backdrop_url),
    release_date: apiFilm.release_year ? `${apiFilm.release_year}-01-01` : '',
    runtime: apiFilm.runtime,
    vote_average: 0, // fetched from TMDB at runtime in fetchVHSCoverData
    genres: apiFilm.genres,
    is_available: apiFilm.is_available,
  };
}

// Convertit un ApiRentalWithFilm en Rental frontend
function apiRentalToRental(apiRental: ApiRentalWithFilm): Rental {
  return {
    filmId: apiRental.film_id,
    rentedAt: new Date(apiRental.rented_at).getTime(),
    expiresAt: new Date(apiRental.expires_at).getTime(),
    videoUrl: apiRental.streaming_urls.vf || apiRental.streaming_urls.vo || '',
    streamingUrls: apiRental.streaming_urls,
  };
}

// User authentifié (backend)
interface AuthUser {
  id: number;
  username: string;
  credits: number;
  is_admin: boolean;
}

// User local (fallback quand pas connecté)
interface LocalUser {
  credits: number;
  totalRentals: number;
  level: MemberLevel;
  badges: string[];
}

interface VideoClubState {
  // Auth
  isAuthenticated: boolean;
  authUser: AuthUser | null;
  isLoading: boolean;
  authError: string | null;
  recoveryPhrase: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  clearRecoveryPhrase: () => void;
  fetchMe: () => Promise<void>;

  // User local (fallback)
  localUser: LocalUser;

  // Credits (utilise authUser ou localUser)
  getCredits: () => number;
  addCredits: (amount: number) => void;
  deductCredits: (amount: number) => boolean;

  // Rentals
  rentals: Rental[];
  setRentals: (rentals: Rental[]) => void;
  addRental: (rental: Rental) => void;
  removeRental: (filmId: number) => void;
  getRental: (filmId: number) => Rental | undefined;
  rentFilm: (filmId: number) => Promise<Rental | null>;

  // Scene
  currentScene: SceneType;
  currentAisle: AisleType;
  selectedFilmId: number | null;
  setScene: (scene: SceneType) => void;
  setAisle: (aisle: AisleType) => void;
  selectFilm: (filmId: number | null) => void;

  // Films cache
  films: Record<AisleType, Film[]>;
  setFilmsForAisle: (aisle: AisleType, films: Film[]) => void;
  loadFilmsFromApi: () => Promise<void>;

  // Manager
  managerVisible: boolean;
  chatHistory: { role: 'manager' | 'user'; text: string }[];
  lastBonusDate: string | null;
  showManager: () => void;
  hideManager: () => void;
  addChatMessage: (role: 'manager' | 'user', text: string) => void;
  clearChat: () => void;
  claimDailyBonus: () => boolean;

  // Player
  isPlayerOpen: boolean;
  currentPlayingFilm: number | null;
  openPlayer: (filmId: number) => void;
  closePlayer: () => void;

  // Targeting (pour le hover via raycasting central)
  targetedFilmId: number | null;
  targetedCassetteKey: string | null;
  setTargetedFilm: (filmId: number | null, cassetteKey?: string | null) => void;

  // Interactive target (manager, bell, tv, couch, null)
  targetedInteractive: string | null;
  setTargetedInteractive: (target: string | null) => void;

  // Pointer lock state
  isPointerLocked: boolean;
  setPointerLocked: (locked: boolean) => void;

  // Pointer lock control (for programmatic lock/unlock)
  requestPointerUnlock: () => void;
  requestPointerLock: () => void;
  pointerLockRequested: 'lock' | 'unlock' | null;
  clearPointerLockRequest: () => void;

  // Rental history
  rentalHistory: { filmId: number; rentedAt: number; returnedAt: number }[];
  addToHistory: (filmId: number, rentedAt: number) => void;

  // User reviews
  userReviews: ReviewWithUser[];
  setUserReviews: (reviews: ReviewWithUser[]) => void;

  // Terminal
  isTerminalOpen: boolean;
  openTerminal: () => void;
  closeTerminal: () => void;

  // VHS Case viewer
  isVHSCaseOpen: boolean;
  setVHSCaseOpen: (open: boolean) => void;

  // Sitting on couch
  isSitting: boolean;
  setSitting: (sitting: boolean) => void;

  // TV seated menu control (dispatched by Controls, consumed by InteractiveTVDisplay)
  tvMenuAction: 'up' | 'down' | 'select' | 'back' | null;
  dispatchTVMenu: (action: 'up' | 'down' | 'select' | 'back') => void;
  clearTVMenuAction: () => void;

  // Onboarding
  hasSeenOnboarding: boolean;
  setHasSeenOnboarding: (seen: boolean) => void;

  // Benchmark
  benchmarkEnabled: boolean;
  setBenchmarkEnabled: (enabled: boolean) => void;
  toggleBenchmarkEnabled: () => void;
}

export const useStore = create<VideoClubState>()(
  persist(
    (set, get) => ({
      // Auth
      isAuthenticated: false,
      authUser: null,
      isLoading: false,
      authError: null,
      recoveryPhrase: null,

      login: async (username, password) => {
        set({ isLoading: true, authError: null });
        try {
          const { user } = await api.auth.login(username, password);
          set({
            isAuthenticated: true,
            authUser: user,
            isLoading: false,
          });
          // Charger les locations actives
          await get().fetchMe();
          return true;
        } catch (error) {
          set({
            isLoading: false,
            authError: error instanceof Error ? error.message : 'Erreur de connexion',
          });
          return false;
        }
      },

      register: async (username, password) => {
        set({ isLoading: true, authError: null });
        try {
          const { user, recoveryPhrase } = await api.auth.register(username, password);
          set({
            isAuthenticated: true,
            authUser: user,
            recoveryPhrase,
            isLoading: false,
          });
          return true;
        } catch (error) {
          set({
            isLoading: false,
            authError: error instanceof Error ? error.message : "Erreur d'inscription",
          });
          return false;
        }
      },

      logout: async () => {
        try {
          await api.auth.logout();
        } catch {
          // Ignorer les erreurs de déconnexion
        }
        set({
          isAuthenticated: false,
          authUser: null,
          rentals: [],
          rentalHistory: [],
        });
      },

      clearAuthError: () => set({ authError: null }),
      clearRecoveryPhrase: () => set({ recoveryPhrase: null }),

      fetchMe: async () => {
        try {
          const data = await api.me.get();
          set({
            isAuthenticated: true,
            authUser: data.user,
            rentals: data.activeRentals.map(apiRentalToRental),
            userReviews: data.reviews || [],
          });
        } catch {
          // Non connecté, pas d'erreur
          set({ isAuthenticated: false, authUser: null, userReviews: [] });
        }
      },

      // User local (fallback)
      localUser: {
        credits: 5,
        totalRentals: 0,
        level: 'bronze',
        badges: [],
      },

      // Credits
      getCredits: () => {
        const { isAuthenticated, authUser, localUser } = get();
        return isAuthenticated && authUser ? authUser.credits : localUser.credits;
      },

      addCredits: (amount) => {
        const { isAuthenticated, authUser } = get();
        if (isAuthenticated && authUser) {
          set({ authUser: { ...authUser, credits: authUser.credits + amount } });
        } else {
          set((state) => ({
            localUser: { ...state.localUser, credits: state.localUser.credits + amount },
          }));
        }
      },

      deductCredits: (amount) => {
        const { isAuthenticated, authUser, localUser } = get();
        const currentCredits = isAuthenticated && authUser ? authUser.credits : localUser.credits;

        if (currentCredits < amount) return false;

        if (isAuthenticated && authUser) {
          set({ authUser: { ...authUser, credits: authUser.credits - amount } });
        } else {
          set((state) => ({
            localUser: { ...state.localUser, credits: state.localUser.credits - amount },
          }));
        }
        return true;
      },

      // Rentals
      rentals: [],
      setRentals: (rentals) => set({ rentals }),

      addRental: (rental) =>
        set((state) => {
          const newTotalRentals = state.localUser.totalRentals + 1;
          return {
            rentals: [...state.rentals, rental],
            localUser: {
              ...state.localUser,
              totalRentals: newTotalRentals,
              level: calculateLevel(newTotalRentals),
            },
          };
        }),

      removeRental: (filmId) =>
        set((state) => {
          const rental = state.rentals.find((r) => r.filmId === filmId);
          const newHistory = rental
            ? [...state.rentalHistory, { filmId, rentedAt: rental.rentedAt, returnedAt: Date.now() }].slice(-50)
            : state.rentalHistory;
          return {
            rentals: state.rentals.filter((r) => r.filmId !== filmId),
            rentalHistory: newHistory,
          };
        }),

      getRental: (filmId) => get().rentals.find((r) => r.filmId === filmId),

      rentFilm: async (filmId) => {
        const { isAuthenticated } = get();

        if (!isAuthenticated) {
          // Mode local (pas connecté) - utiliser le système existant
          return null;
        }

        try {
          const { rental } = await api.rentals.rent(filmId);
          const frontendRental = apiRentalToRental(rental);

          set((state) => ({
            rentals: [...state.rentals.filter(r => r.filmId !== filmId), frontendRental],
            authUser: state.authUser ? {
              ...state.authUser,
              credits: state.authUser.credits - 1
            } : null,
          }));

          return frontendRental;
        } catch (error) {
          console.error('Erreur location:', error);
          return null;
        }
      },

      // Scene
      currentScene: 'exterior',
      currentAisle: 'nouveautes',
      selectedFilmId: null,
      setScene: (scene) => set({ currentScene: scene }),
      setAisle: (aisle) => set({ currentAisle: aisle }),
      selectFilm: (filmId) => {
        set({ selectedFilmId: filmId });
        // Pre-fetch VHS cover data at click time (before VHSCaseViewer mounts)
        // fetchVHSCoverData checks its own cache — no double-fetch risk
        if (filmId !== null) {
          const allFilms = Object.values(get().films).flat();
          const film = allFilms.find(f => f.id === filmId);
          if (film) fetchVHSCoverData(film).catch(() => {});
        }
      },

      // Films cache
      films: {
        nouveautes: [],
        action: [],
        horreur: [],
        sf: [],
        comedie: [],
        classiques: [],
        bizarre: [],
      },
      setFilmsForAisle: (aisle, films) =>
        set((state) => ({
          films: { ...state.films, [aisle]: films },
        })),

      loadFilmsFromApi: async () => {
        const aisles: AisleType[] = ['nouveautes', 'action', 'horreur', 'sf', 'comedie', 'classiques', 'bizarre'];
        try {
          const results = await Promise.all(
            aisles.map(aisle => api.films.getByAisle(aisle).catch(() => ({ aisle, films: [] })))
          );
          const filmsMap: Record<AisleType, Film[]> = {
            nouveautes: [], action: [], horreur: [], sf: [], comedie: [], classiques: [], bizarre: [],
          };
          for (const { aisle, films: aisleFilms } of results) {
            filmsMap[aisle as AisleType] = (aisleFilms as ApiFilm[]).map(apiFilmToFilm);
          }
          set({ films: filmsMap });
        } catch (error) {
          console.error('Erreur chargement films:', error);
        }
      },

      // Manager
      managerVisible: false,
      chatHistory: [],
      lastBonusDate: null,
      showManager: () => set({ managerVisible: true }),
      hideManager: () => set({ managerVisible: false }),
      addChatMessage: (role, text) =>
        set((state) => ({
          chatHistory: [...state.chatHistory, { role, text }],
        })),
      clearChat: () => set({ chatHistory: [] }),
      claimDailyBonus: () => {
        const today = new Date().toDateString();
        const { lastBonusDate, chatHistory, addCredits } = get();
        if (lastBonusDate === today) return false;
        if (chatHistory.length < 6) return false;
        addCredits(1);
        set({ lastBonusDate: today });
        return true;
      },

      // Player
      isPlayerOpen: false,
      currentPlayingFilm: null,
      openPlayer: (filmId) => set({ isPlayerOpen: true, currentPlayingFilm: filmId }),
      closePlayer: () => set({ isPlayerOpen: false, currentPlayingFilm: null }),

      // Targeting
      targetedFilmId: null,
      targetedCassetteKey: null,
      setTargetedFilm: (filmId, cassetteKey = null) => {
        set({ targetedFilmId: filmId, targetedCassetteKey: cassetteKey });
        // Preload w500 poster as soon as cassette is aimed at (before click)
        if (filmId !== null) {
          const allFilms = Object.values(get().films).flat();
          const film = allFilms.find(f => f.id === filmId);
          if (film) {
            if (film.poster_path) {
              preloadPosterImage(`https://image.tmdb.org/t/p/w500${film.poster_path}`);
            }
            // Prefetch all VHS cover data (TMDB + images) while user aims
            // fetchVHSCoverData has its own cache — no duplicate requests
            fetchVHSCoverData(film).catch(() => {});
          }
        }
      },

      // Interactive target
      targetedInteractive: null,
      setTargetedInteractive: (target) => set({ targetedInteractive: target }),

      // Pointer lock
      isPointerLocked: false,
      setPointerLocked: (locked) => set({ isPointerLocked: locked }),

      // Pointer lock control
      pointerLockRequested: null,
      requestPointerUnlock: () => set({ pointerLockRequested: 'unlock' }),
      requestPointerLock: () => set({ pointerLockRequested: 'lock' }),
      clearPointerLockRequest: () => set({ pointerLockRequested: null }),

      // Rental history
      rentalHistory: [],
      addToHistory: (filmId, rentedAt) =>
        set((state) => ({
          rentalHistory: [...state.rentalHistory, { filmId, rentedAt, returnedAt: Date.now() }].slice(-50),
        })),

      // User reviews
      userReviews: [],
      setUserReviews: (reviews) => set({ userReviews: reviews }),

      // Terminal
      isTerminalOpen: false,
      openTerminal: () => set({ isTerminalOpen: true }),
      closeTerminal: () => set({ isTerminalOpen: false }),

      // VHS Case viewer
      isVHSCaseOpen: false,
      setVHSCaseOpen: (open) => set({ isVHSCaseOpen: open }),

      // Sitting on couch
      isSitting: false,
      setSitting: (sitting) => set({ isSitting: sitting }),

      // TV seated menu control
      tvMenuAction: null,
      dispatchTVMenu: (action) => set({ tvMenuAction: action }),
      clearTVMenuAction: () => set({ tvMenuAction: null }),

      // Onboarding
      hasSeenOnboarding: false,
      setHasSeenOnboarding: (seen) => set({ hasSeenOnboarding: seen }),

      // Benchmark
      benchmarkEnabled: false,
      setBenchmarkEnabled: (enabled) => set({ benchmarkEnabled: enabled }),
      toggleBenchmarkEnabled: () => set((state) => ({ benchmarkEnabled: !state.benchmarkEnabled })),
    }),
    {
      name: 'videoclub-storage',
      partialize: (state) => ({
        localUser: state.localUser,
        rentalHistory: state.rentalHistory,
        lastBonusDate: state.lastBonusDate,
        hasSeenOnboarding: state.hasSeenOnboarding,
        // Ne pas persister benchmarkEnabled — use ?benchmark=1 URL param only
        // Ne pas persister authUser, les cookies de session gèrent ça
      }),
    }
  )
);


// Hook pour initialiser l'auth au démarrage
export function useInitAuth() {
  const fetchMe = useStore((state) => state.fetchMe);
  const loadFilmsFromApi = useStore((state) => state.loadFilmsFromApi);

  // À appeler au montage de l'app
  return async () => {
    await fetchMe();
    await loadFilmsFromApi();
  };
}
