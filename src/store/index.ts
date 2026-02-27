import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Film, Rental, AisleType, SceneType, MemberLevel } from '../types';
import api, { type ApiRentalWithFilm, type ApiFilm, type ReviewWithUser, type ApiReturnRequest } from '../api';
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
    stock: apiFilm.stock ?? 2,
    active_rentals: apiFilm.active_rentals ?? 0,
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
    watchProgress: apiRental.watch_progress ?? 0,
    watchCompletedAt: apiRental.watch_completed_at ? new Date(apiRental.watch_completed_at).getTime() : null,
    extensionUsed: !!apiRental.extension_used,
    rewindClaimed: !!apiRental.rewind_claimed,
    viewingMode: (apiRental.viewing_mode as 'sur_place' | 'emporter') ?? null,
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
  returnFilm: (filmId: number) => Promise<{ earlyReturnCredit: boolean } | null>;
  requestReturn: (filmId: number) => Promise<boolean>;
  setViewingMode: (filmId: number, mode: 'sur_place' | 'emporter') => Promise<Rental | null>;
  extendRental: (filmId: number) => Promise<Rental | null>;

  // Scene
  currentScene: SceneType;
  currentAisle: AisleType;
  selectedFilmId: number | null;
  setScene: (scene: SceneType) => void;
  setAisle: (aisle: AisleType) => void;
  selectFilm: (filmId: number | null) => void;

  // Films cache
  films: Record<AisleType, Film[]>;
  filmRentalCounts: Record<number, { stock: number; activeRentals: number }>;
  setFilmRentalCounts: (filmId: number, stock: number, activeRentals: number) => void;
  setFilmsForAisle: (aisle: AisleType, films: Film[]) => void;
  loadFilmsFromApi: () => Promise<void>;

  // Return notifications
  returnNotifications: ApiReturnRequest[];
  fetchNotifications: () => Promise<void>;

  // Manager IA
  managerVisible: boolean;
  chatBackdropUrl: string | null;
  eventQueue: string[];
  showManager: () => void;
  hideManager: () => void;
  setChatBackdrop: (url: string | null) => void;
  pushEvent: (event: string) => void;
  drainEvents: () => string[];

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
  terminalAdminMode: boolean;
  openTerminal: () => void;
  closeTerminal: () => void;
  openTerminalAdmin: () => void;

  // Settings modals (auth/search triggered from CRT settings menu)
  pendingSettingsAction: 'auth' | 'search' | null;
  setPendingSettingsAction: (action: 'auth' | 'search' | null) => void;

  // VHS Case viewer
  isVHSCaseOpen: boolean;
  setVHSCaseOpen: (open: boolean) => void;
  vhsCaseAnimating: boolean;
  setVHSCaseAnimating: (animating: boolean) => void;

  // Sitting on couch
  isSitting: boolean;
  setSitting: (sitting: boolean) => void;

  // TV zoom (Paramètres — camera fills viewport with CRT screen)
  isZoomedOnTV: boolean;
  setZoomedOnTV: (val: boolean) => void;

  // Standing TV interaction (click TV while standing → 2-option menu)
  isInteractingWithTV: boolean;
  setInteractingWithTV: (val: boolean) => void;

  // TV seated menu control (dispatched by Controls, consumed by InteractiveTVDisplay)
  tvMenuAction: 'up' | 'down' | 'select' | 'back' | null;
  dispatchTVMenu: (action: 'up' | 'down' | 'select' | 'back') => void;
  clearTVMenuAction: () => void;

  // LaZone CRT interaction
  isInteractingWithLaZone: boolean;
  setInteractingWithLaZone: (val: boolean) => void;
  isWatchingLaZone: boolean;
  setWatchingLaZone: (val: boolean) => void;
  laZoneMenuAction: 'left' | 'right' | 'select' | 'back' | null;
  dispatchLaZoneMenu: (action: 'left' | 'right' | 'select' | 'back') => void;
  clearLaZoneMenuAction: () => void;
  laZoneSoundOn: boolean;
  setLaZoneSoundOn: (val: boolean) => void;
  laZoneChannelAction: { type: 'next' | 'prev'; ts: number } | null;
  dispatchLaZoneChannel: (action: 'next' | 'prev') => void;
  clearLaZoneChannelAction: () => void;

  // Onboarding
  hasSeenOnboarding: boolean;
  setHasSeenOnboarding: (seen: boolean) => void;

  // Benchmark
  benchmarkEnabled: boolean;
  setBenchmarkEnabled: (enabled: boolean) => void;
  toggleBenchmarkEnabled: () => void;

  // Loading screen
  isSceneReady: boolean;
  setSceneReady: (ready: boolean) => void;
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
          managerVisible: false,
          chatBackdropUrl: null,
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

      returnFilm: async (filmId) => {
        try {
          const result = await api.rentals.returnFilm(filmId);
          set((state) => ({
            rentals: state.rentals.filter(r => r.filmId !== filmId),
          }));
          // Refresh credits (early return gives +1)
          try {
            const meData = await api.me.get();
            set({ authUser: { id: meData.user.id, username: meData.user.username, credits: meData.user.credits, is_admin: meData.user.is_admin } });
          } catch { /* stale */ }
          // Decrement active rental count
          const current = get().filmRentalCounts[filmId];
          if (current) {
            get().setFilmRentalCounts(filmId, current.stock, Math.max(0, current.activeRentals - 1));
          }
          return result;
        } catch (error) {
          console.error('Erreur retour:', error);
          return null;
        }
      },

      requestReturn: async (filmId) => {
        try {
          await api.rentals.requestReturn(filmId);
          return true;
        } catch (error) {
          console.error('Erreur notification retour:', error);
          return false;
        }
      },

      rentFilm: async (filmId) => {
        const { isAuthenticated } = get();

        if (!isAuthenticated) {
          return null;
        }

        try {
          const { rental } = await api.rentals.rent(filmId);
          const frontendRental = apiRentalToRental(rental);

          // Refresh credits from /api/me instead of hardcoded -1
          set((state) => ({
            rentals: [...state.rentals.filter(r => r.filmId !== filmId), frontendRental],
          }));

          // Refresh user data to get updated credits
          try {
            const meData = await api.me.get();
            set({ authUser: { id: meData.user.id, username: meData.user.username, credits: meData.user.credits, is_admin: meData.user.is_admin } });
          } catch { /* credits will be stale until next refresh */ }

          // Increment active rental count
          const current = get().filmRentalCounts[filmId];
          if (current) {
            get().setFilmRentalCounts(filmId, current.stock, current.activeRentals + 1);
          }

          return frontendRental;
        } catch (error) {
          console.error('Erreur location:', error);
          return null;
        }
      },

      setViewingMode: async (filmId, mode) => {
        try {
          const { rental } = await api.rentals.setViewingMode(filmId, mode);
          const frontendRental = apiRentalToRental(rental);
          set((state) => ({
            rentals: [...state.rentals.filter(r => r.filmId !== filmId), frontendRental],
          }));
          return frontendRental;
        } catch (error) {
          console.error('Erreur mode visionnage:', error);
          return null;
        }
      },

      extendRental: async (filmId) => {
        try {
          const { rental } = await api.rentals.extend(filmId);
          const frontendRental = apiRentalToRental(rental);
          set((state) => ({
            rentals: [...state.rentals.filter(r => r.filmId !== filmId), frontendRental],
          }));
          // Refresh credits
          try {
            const meData = await api.me.get();
            set({ authUser: { id: meData.user.id, username: meData.user.username, credits: meData.user.credits, is_admin: meData.user.is_admin } });
          } catch { /* stale */ }
          return frontendRental;
        } catch (error) {
          console.error('Erreur prolongation:', error);
          return null;
        }
      },

      // Scene
      currentScene: 'exterior',
      currentAisle: 'nouveautes',
      selectedFilmId: null,
      setScene: (scene) => set({ currentScene: scene, isSceneReady: scene !== 'interior' }),
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
        comedie: [],
        drame: [],
        thriller: [],
        policier: [],
        sf: [],
        animation: [],
        classiques: [],
      },
      filmRentalCounts: {},
      setFilmRentalCounts: (filmId, stock, activeRentals) =>
        set((state) => ({
          filmRentalCounts: { ...state.filmRentalCounts, [filmId]: { stock, activeRentals } },
        })),

      returnNotifications: [],
      fetchNotifications: async () => {
        try {
          const { notifications } = await api.me.getNotifications();
          set({ returnNotifications: notifications });
        } catch {
          // Not authenticated or error
        }
      },

      setFilmsForAisle: (aisle, films) =>
        set((state) => ({
          films: { ...state.films, [aisle]: films },
        })),

      loadFilmsFromApi: async () => {
        const aisles: AisleType[] = ['nouveautes', 'action', 'horreur', 'comedie', 'drame', 'thriller', 'policier', 'sf', 'animation', 'classiques'];
        try {
          const results = await Promise.all(
            aisles.map(aisle => api.films.getByAisle(aisle).catch(() => ({ aisle, films: [] })))
          );
          const filmsMap: Record<AisleType, Film[]> = {
            nouveautes: [], action: [], horreur: [], comedie: [], drame: [], thriller: [], policier: [], sf: [], animation: [], classiques: [],
          };
          const rentalCounts: Record<number, { stock: number; activeRentals: number }> = {};
          for (const { aisle, films: aisleFilms } of results) {
            const converted = (aisleFilms as ApiFilm[]).map(apiFilmToFilm);
            filmsMap[aisle as AisleType] = converted;
            for (const film of converted) {
              rentalCounts[film.id] = {
                stock: film.stock ?? 2,
                activeRentals: film.active_rentals ?? 0,
              };
            }
          }
          set({ films: filmsMap, filmRentalCounts: rentalCounts });
        } catch (error) {
          console.error('Erreur chargement films:', error);
        }
      },

      // Manager IA
      managerVisible: false,
      chatBackdropUrl: null,
      eventQueue: [],
      showManager: () => set({ managerVisible: true }),
      hideManager: () => set({ managerVisible: false, chatBackdropUrl: null }),
      setChatBackdrop: (url) => set({ chatBackdropUrl: url }),
      pushEvent: (event) => set((state) => ({ eventQueue: [...state.eventQueue, event] })),
      drainEvents: () => {
        const events = get().eventQueue;
        set({ eventQueue: [] });
        return events;
      },

      // Player
      isPlayerOpen: false,
      currentPlayingFilm: null,
      openPlayer: (filmId) => {
        set({ isPlayerOpen: true, currentPlayingFilm: filmId, managerVisible: false, chatBackdropUrl: null });
      },
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
      terminalAdminMode: false,
      openTerminal: () => set({ isTerminalOpen: true }),
      closeTerminal: () => set({ isTerminalOpen: false, terminalAdminMode: false }),
      openTerminalAdmin: () => set({ isTerminalOpen: true, terminalAdminMode: true }),

      // Settings modals
      pendingSettingsAction: null,
      setPendingSettingsAction: (action) => set({ pendingSettingsAction: action }),

      // VHS Case viewer
      isVHSCaseOpen: false,
      setVHSCaseOpen: (open) => set({ isVHSCaseOpen: open }),
      vhsCaseAnimating: false,
      setVHSCaseAnimating: (animating) => {
        if (get().vhsCaseAnimating !== animating) set({ vhsCaseAnimating: animating });
      },

      // Sitting on couch
      isSitting: false,
      setSitting: (sitting) => set({ isSitting: sitting }),

      // TV zoom (Paramètres)
      isZoomedOnTV: false,
      setZoomedOnTV: (val) => set({ isZoomedOnTV: val }),

      // Standing TV interaction
      isInteractingWithTV: false,
      setInteractingWithTV: (val) => set({ isInteractingWithTV: val }),

      // TV seated menu control
      tvMenuAction: null,
      dispatchTVMenu: (action) => set({ tvMenuAction: action }),
      clearTVMenuAction: () => set({ tvMenuAction: null }),

      // LaZone CRT interaction
      isInteractingWithLaZone: false,
      setInteractingWithLaZone: (val) => set({ isInteractingWithLaZone: val }),
      isWatchingLaZone: false,
      setWatchingLaZone: (val) => set({ isWatchingLaZone: val }),
      laZoneMenuAction: null,
      dispatchLaZoneMenu: (action) => set({ laZoneMenuAction: action }),
      clearLaZoneMenuAction: () => set({ laZoneMenuAction: null }),
      laZoneSoundOn: false,
      setLaZoneSoundOn: (val) => set({ laZoneSoundOn: val }),
      laZoneChannelAction: null,
      dispatchLaZoneChannel: (action) => set({ laZoneChannelAction: { type: action, ts: Date.now() } }),
      clearLaZoneChannelAction: () => set({ laZoneChannelAction: null }),

      // Onboarding
      hasSeenOnboarding: false,
      setHasSeenOnboarding: (seen) => set({ hasSeenOnboarding: seen }),

      // Benchmark
      benchmarkEnabled: false,
      setBenchmarkEnabled: (enabled) => set({ benchmarkEnabled: enabled }),
      toggleBenchmarkEnabled: () => set((state) => ({ benchmarkEnabled: !state.benchmarkEnabled })),

      // Loading screen
      isSceneReady: false,
      setSceneReady: (ready) => set({ isSceneReady: ready }),
    }),
    {
      name: 'videoclub-storage',
      partialize: (state) => ({
        localUser: state.localUser,
        rentalHistory: state.rentalHistory,
        hasSeenOnboarding: state.hasSeenOnboarding,
        // Ne pas persister benchmarkEnabled — use ?benchmark=1 URL param only
        // Ne pas persister authUser, les cookies de session gèrent ça
      }),
    }
  )
);


// Dev/test hook — expose store to browser console & Playwright MCP
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as any).__store = useStore;
}

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

// Debug: expose store on window for Playwright testing
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__store = useStore;
}