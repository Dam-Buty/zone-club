import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Film, Rental, AisleType, SceneType, MemberLevel, AuthUser, LocalUser } from '../types';
import api, { ApiError, apiFilmToFilm, type ApiRentalWithFilm, type ApiRentalHistoryEntry, type ApiFilm, type MeResponse, type ReviewWithUser, type ApiReturnRequest, type WeeklyBonusStatus, type ApiBoardNote, type BoardCapacity } from '../api';
import { preloadPosterImage } from '../utils/CassetteTextureArray';
import { fetchVHSCoverData } from '../utils/VHSCoverGenerator';
import { parseServerDate } from '../utils/server-date';
import { rentalsRefreshOutcome } from '../utils/rentals-refresh';
import { keepsVersionPref, parseVersionChoice } from '../utils/version-choice';
import { createCastSlice, type CastSlice } from './slices/cast';
import { createVersionSlice, filmVersionsAfterRead, type VersionSlice } from './slices/version';
import { createManagerSlice } from './slices/manager';
import { createTutorialSlice, TUTORIAL_WAYPOINTS } from './slices/tutorial';

// Re-export the tutorial waypoints constant — moved to the tutorial slice
// but still imported from this module by ~15 consumers (TutorialOverlay,
// Controls.tsx, etc.).
export { TUTORIAL_WAYPOINTS };

function calculateLevel(totalRentals: number): MemberLevel {
  if (totalRentals >= 50) return 'platine';
  if (totalRentals >= 25) return 'or';
  if (totalRentals >= 10) return 'argent';
  return 'bronze';
}

// Convertit un ApiRentalWithFilm en Rental frontend
function apiRentalToRental(apiRental: ApiRentalWithFilm): Rental {
  return {
    filmId: apiRental.film_id,
    // Dates du serveur : UTC sans fuseau — parseServerDate, jamais new Date() (heure locale).
    rentedAt: parseServerDate(apiRental.rented_at),
    expiresAt: parseServerDate(apiRental.expires_at),
    videoUrl: apiRental.streaming_urls.vf || apiRental.streaming_urls.vo || '',
    streamingUrls: apiRental.streaming_urls,
    watchProgress: apiRental.watch_progress ?? 0,
    watchPosition: apiRental.watch_position ?? 0,
    watchCompletedAt: apiRental.watch_completed_at ? parseServerDate(apiRental.watch_completed_at) : null,
    extensionUsed: !!apiRental.extension_used,
    rewindClaimed: !!apiRental.rewind_claimed,
    viewingMode: (apiRental.viewing_mode as 'sur_place') ?? null,
  };
}

/** L'historique de /api/me au format du magasin : une seule lecture, pour `fetchMe` et `refreshRentals`. */
function historyFromApi(entries: ApiRentalHistoryEntry[] | undefined): RentalHistoryEntry[] {
  // SQLite stores naive-UTC datetimes ("YYYY-MM-DD HH:MM:SS"); normalise to ISO-UTC before parsing.
  const toMs = parseServerDate;
  return (entries || []).map((h) => ({
    filmId: h.film_id,
    title: h.film_title,
    posterUrl: h.film_poster_url,
    rentedAt: toMs(h.rented_at) || Date.now(),
    returnedAt: toMs(h.expires_at) || 0,
    // SQLite renvoie 0/1 malgré le typage `boolean` de l'API.
    isActive: !!h.is_active,
    expiresAt: toMs(h.expires_at) || 0,
    watchProgress: h.watch_progress ?? 0,
    rewindClaimed: !!h.rewind_claimed,
    returnedEarly: !!h.returned_early,
    returnDate: h.returned_at ? toMs(h.returned_at) || null : null,
    expiredDate: h.expired_at ? toMs(h.expired_at) || null : null,
  }));
}


// Mutually-exclusive interaction modes. Only one can be active at a time;
// setInteractionMode(mode) enforces this in the store, replacing the 6
// hand-rolled mutex setters that drifted over time.
export type InteractionMode =
  | 'none'             // free FPS, no overlay active
  | 'sitting'          // sat on the couch (TV seated menu active)
  | 'minitel'          // minitel screen / overlay open
  | 'tvStanding'       // standing TV menu (rarely entered — TV click teleports to couch since 42180ed)
  | 'lazoneStanding'   // standing in front of La Zone CRT, menu open
  | 'lazoneWatching'   // watching La Zone fullscreen
  | 'film'             // VHS case overlay open (selectedFilmId !== null)

/** Une ligne d'historique telle que /api/me la renvoie, remise au format du store. */
export interface RentalHistoryEntry {
  filmId: number;
  /** Titre joint côté serveur : le catalogue 3D ne contient que les rayons chargés. */
  title: string | null;
  posterUrl: string | null;
  rentedAt: number;
  /** expires_at, pas une date de retour. */
  returnedAt: number;
  isActive: boolean;
  /** Ajouts pour « Mon compte » (spec 2026-11-17-borne-mon-compte). */
  expiresAt: number;
  watchProgress: number;
  rewindClaimed: boolean;
  returnedEarly: boolean;
  /** returned_at : rendu par le visiteur ; null avant la colonne ou si non rendu. */
  returnDate: number | null;
  /** expired_at : arrivé à échéance ; null avant la colonne ou si non expiré. */
  expiredDate: number | null;
}

/** Ce qu'un film loué et pas encore critiqué permet, par identifiant de film. */
export type ReviewEligibilityMap = Record<number, { allowed: boolean; reason: string | null; availableAtMs: number | null }>;

export interface VideoClubState extends CastSlice, VersionSlice {
  // Auth
  isAuthenticated: boolean;
  authUser: AuthUser | null;
  isLoading: boolean;
  authError: string | null;
  recoveryPhrase: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  clearAuthError: () => void;
  clearRecoveryPhrase: () => void;
  fetchMe: () => Promise<void>;
  /**
   * Relit les locations (et l'historique qui vient avec) sur le serveur, pour le Cast. Contrairement à `fetchMe`, une
   * panne ne déconnecte pas le visiteur : rien n'est écrit et la promesse rejette ; seul un 401 laisse `fetchMe`
   * constater la déconnexion. Une réponse arrivée après un changement de compte n'écrit rien.
   */
  refreshRentals: () => Promise<void>;

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
  getRental: (filmId: number) => Rental | undefined;
  // Push to server + sync local store. Single source of truth so seek-on-reopen
  // and recast both read the latest position without round-trip.
  updateRentalProgress: (filmId: number, progress: number, position: number) => Promise<{ ok: boolean }>;
  rentFilm: (filmId: number) => Promise<Rental | null>;
  returnFilm: (filmId: number) => Promise<{ earlyReturnCredit: boolean } | null>;
  requestReturn: (filmId: number) => Promise<boolean>;
  setViewingMode: (filmId: number, mode: 'sur_place') => Promise<Rental | null>;
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
  /** Les rayons dont le dernier chargement a échoué : la borne ne les dit pas « vides ». */
  failedAisles: AisleType[];
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
  /**
   * Location synthétique de la page admin : elle ne vient pas du serveur et ne
   * doit jamais entrer dans `rentals` (pas de crédit, pas d'historique, pas de
   * stock). `getRental` la sert en priorité pour que le VHSPlayer reste le vrai
   * player du vidéoclub, sans branche spéciale côté composant.
   */
  previewRental: Rental | null;
  previewFilm: Film | null;
  openPreviewPlayer: (film: Film, rental: Rental) => void;
  /**
   * `from` : d'où le visiteur vient (libellé du retour du lecteur) ; `ask` : montrer l'invite « Regarder sur TV ? »
   * sur mobile. Un appel à un seul argument garde les défauts : le vidéoclub, avec l'invite.
   */
  openPlayer: (filmId: number, opts?: { from?: 'kiosk' | 'store'; ask?: boolean }) => void;
  /** D'où le lecteur a été ouvert ; `closePlayer` n'y touche pas (le lecteur se ferme, son libellé reste lisible). */
  playerFrom: 'kiosk' | 'store';
  playerAsk: boolean;
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

  // Rental history — alimenté UNIQUEMENT par fetchMe (/api/me). Le serveur renvoie TOUTES les locations
  // de l'utilisateur, actives comprises, donc l'historique survit au changement d'appareil et au vidage
  // du localStorage. Pas de writer local : une insertion optimiste produirait une entrée sans titre et
  // ferait doublon au prochain fetchMe. returnedAt porte expires_at (fin de fenêtre), pas une date de
  // retour effective — d'où l'affichage « en cours / terminé » plutôt qu'une date.
  rentalHistory: RentalHistoryEntry[];

  // User reviews
  userReviews: ReviewWithUser[];
  reviewEligibility: ReviewEligibilityMap;
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
  vhsNavDirection: 'left' | 'right' | null;
  setVHSNavDirection: (dir: 'left' | 'right' | null) => void;
  vhsSwiping: boolean;
  vhsSwipeOffset: number;
  setVhsSwipeState: (swiping: boolean, offset: number) => void;
  vhsFlipCount: number;
  requestVHSFlip: () => void;

  // Interaction mode — single source of truth for the mutex between the
  // major overlays. The 5 isXxx booleans below are kept in the store as
  // derived views (auto-synced by setInteractionMode) so the ~50 read sites
  // in the codebase can keep their atomic selectors unchanged. New code
  // SHOULD read s.interactionMode directly. New modes go in this enum first.
  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;

  // Sitting on couch (derived from interactionMode === 'sitting')
  isSitting: boolean;
  setSitting: (sitting: boolean) => void;

  // TV zoom (Paramètres — camera fills viewport with CRT screen)
  isZoomedOnTV: boolean;
  setZoomedOnTV: (val: boolean) => void;

  // Minitel (search/browse films + 3D highlight)
  isInteractingWithMinitel: boolean;
  setInteractingWithMinitel: (val: boolean) => void;
  minitelMode: 'idle' | 'sommaire' | 'recherche' | 'rayons' | 'alpha' | 'commander' | 'detail';
  setMinitelMode: (m: 'idle' | 'sommaire' | 'recherche' | 'rayons' | 'alpha' | 'commander' | 'detail') => void;
  minitelQuery: string;
  setMinitelQuery: (q: string) => void;
  minitelSelectedAisle: AisleType | null;
  setMinitelSelectedAisle: (a: AisleType | null) => void;
  minitelSelectedFilm: number | null;
  setMinitelSelectedFilm: (id: number | null) => void;
  minitelPageIndex: number;
  setMinitelPageIndex: (n: number) => void;
  // Currently highlighted item index (1-based) for arrow-key navigation in the minitel.
  minitelHighlightedItem: number;
  setMinitelHighlightedItem: (n: number) => void;
  // Bridge for direct-click on the 3D minitel screen plane: MinitelDisplay
  // sets this to the clicked item index; MinitelOverlay reads + clears it
  // and reuses its existing handleNumberPress flow.
  pendingMinitelPress: number | null;
  dispatchMinitelItem: (n: number) => void;
  consumeMinitelItem: () => void;
  highlightedCassetteKey: string | null;
  setHighlightedCassetteKey: (k: string | null) => void;
  // True for ~320ms after a user clicks ILLUMINER LA K7 — drives a brief
  // reverse-video flash on the button so the click registers visually
  // before the minitel closes.
  minitelIlluminerFlash: boolean;
  setMinitelIlluminerFlash: (v: boolean) => void;
  // TMDB search state for COMMANDER mode. Lives in the store so the canvas
  // (rendered by MinitelDisplay) and the action handlers (in MinitelOverlay)
  // both see the same results.
  minitelTmdbResults: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null }>;
  setMinitelTmdbResults: (r: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null }>) => void;
  minitelTmdbState: 'idle' | 'pending' | 'ok' | 'empty' | 'error';
  setMinitelTmdbState: (s: 'idle' | 'pending' | 'ok' | 'empty' | 'error') => void;
  minitelRequestedIds: Set<number>;
  setMinitelRequestedIds: (ids: Set<number>) => void;

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

  // VHS swipe hint (mobile)
  hasSeenVHSSwipeHint: boolean;
  setHasSeenVHSSwipeHint: (seen: boolean) => void;

  // Benchmark
  benchmarkEnabled: boolean;
  setBenchmarkEnabled: (enabled: boolean) => void;
  toggleBenchmarkEnabled: () => void;

  // Loading screen
  isSceneReady: boolean;
  /**
   * La scène intérieure MONTÉE a fini son préchauffage (shaders compilés, jaquettes chargées).
   * Distinct de `isSceneReady` : la scène peut être préchauffée, cachée, pendant que le
   * visiteur est encore devant la devanture. `isSceneReady` reste « ce que voit le visiteur
   * est prêt » — toujours vrai à l'extérieur, égal à `interiorWarm` à l'intérieur.
   */
  interiorWarm: boolean;
  setSceneReady: (ready: boolean) => void;

  // Weekly bonus
  weeklyBonusStatus: WeeklyBonusStatus | null;
  setWeeklyBonusStatus: (s: WeeklyBonusStatus | null) => void;
  claimWeeklyBonus: () => Promise<boolean>;
  /** Relit l'état du bonus : il dépend du solde, qui bouge à chaque location, retour ou critique. */
  refreshWeeklyBonus: () => Promise<void>;

  // Tutorial
  tutorialStep: number | null;
  hasCompletedTutorial: boolean;
  tutorialCameraTarget: { position: [number, number, number]; lookAt: [number, number, number] } | null;
  showPostTutorialAuth: boolean;
  showInstallPrompt: boolean;
  startTutorial: () => void;
  nextTutorialStep: () => void;
  skipTutorial: () => void;
  dismissPostTutorialAuth: () => void;
  setShowInstallPrompt: (show: boolean) => void;
  dismissInstallPrompt: () => void;

  // Desk display (3 recently returned films on manager counter)
  deskFilms: Film[];
  fetchDeskFilms: () => Promise<void>;
  showDeskFilmPicker: boolean;
  setShowDeskFilmPicker: (show: boolean) => void;

  // Board (sticky notes)
  boardOverlayMode: 'create' | 'detail' | null;
  boardNotes: ApiBoardNote[];
  boardCapacity: BoardCapacity | null;
  selectedBoardNoteId: number | null;
  boardCreateCell: { row: number; col: number } | null;
  openBoardCreate: (row?: number, col?: number) => void;
  openBoardNote: (noteId: number) => void;
  closeBoard: () => void;
  fetchBoardNotes: () => Promise<void>;
}

/** Connexion acceptée par le serveur mais session absente à la relecture : le cookie n'a pas été gardé. */
export const SESSION_NOT_KEPT = 'Connexion acceptée, mais la session n\u2019a pas tenu : ce navigateur refuse peut-être les cookies de ce site. Autorisez-les, ou ouvrez le site dans un autre navigateur.';

export const useStore = create<VideoClubState>()(
  persist(
    (set, get, store) => ({
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
          if (!get().isAuthenticated) {
            // Le serveur a accepté la connexion, mais la relecture du compte dit « non connecté » : le navigateur n'a pas
            // gardé le cookie de session. Le dire — sans cela le panneau se rouvrait sans un mot (Rusmir, 25/11/2026).
            set({ isLoading: false, authError: SESSION_NOT_KEPT });
            return false;
          }
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
            // Compte neuf, sans fetchMe : ni préférence ni choix par film, et la table de l'appareil devient la sienne.
            versionPref: null, filmVersions: {}, filmVersionsUser: user.id,
          });
          // Le compte existe ; la session tient-elle ? Si le navigateur a refusé le cookie, la borne doit le savoir —
          // la phrase reste affichée (elle seule permet de retrouver le compte), et la connexion est redemandée après.
          try {
            await api.me.get();
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) set({ isAuthenticated: false, authUser: null });
          }
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
        // La location du film qui est sur la TV disparaît avec le compte : la TV s'arrête, et sa séance serveur est
        // close tant que le cookie existe encore. AVANT la requête de déconnexion : après elle, le DELETE de la séance
        // reçoit 401 (la route de déconnexion clôt de toute façon les séances du visiteur côté serveur).
        get().castLoggedOut();
        try {
          await api.auth.logout();
        } catch (error) {
          // Un 401 : le serveur ne nous connaît déjà plus, on finit le ménage. Toute autre erreur (réseau coupé, panne) :
          // le cookie de session est toujours dans le navigateur — annoncer « déconnecté » serait faux, et le visiteur
          // suivant sur le même appareil se retrouverait connecté à ce compte au rechargement.
          if (!(error instanceof ApiError && error.status === 401)) return false;
        }
        set({
          isAuthenticated: false,
          authUser: null,
          // Une phrase de récupération pas encore confirmée ne doit pas survivre à la session :
          // la personne suivante sur le même appareil la verrait à l'ouverture de la borne.
          recoveryPhrase: null,
          rentals: [],
          rentalHistory: [],
          userReviews: [],
          reviewEligibility: {},
          filmRentalCounts: {},
          managerVisible: false,
          chatBackdropUrl: null,
          // Le film dont le Cast courait peut-être est celui de ce compte : le visiteur suivant sur le même appareil
          // recevrait « Location terminée » pour un film qu'il n'a pas loué.
          lastCastFilmId: null,
          // Ni la préférence ni les choix par film de ce compte ne passent au visiteur suivant.
          versionPref: null,
          filmVersions: {}, filmVersionsUser: null,
        });
        return true;
      },

      clearAuthError: () => set({ authError: null }),
      clearRecoveryPhrase: () => set({ recoveryPhrase: null }),

      refreshRentals: async () => {
        // Le compte connecté au départ : une réponse revenue après une déconnexion (logout part pendant qu'une séance de
        // Cast se clôt) ne doit pas remplir les locations du visiteur suivant.
        const accountBefore = get().authUser?.id ?? null;
        let data: MeResponse;
        try {
          data = await api.me.get();
        } catch (error) {
          // Panne réseau ou erreur du serveur : rien n'est touché, le visiteur reste connecté, l'appelant le sait. Un 401
          // seulement est une vraie déconnexion : fetchMe la constate, comme partout ailleurs.
          const outcome = rentalsRefreshOutcome({
            failedStatus: error instanceof ApiError ? error.status : null, accountBefore, accountNow: null, responseAccount: null,
          });
          if (outcome === 'logged-out') await get().fetchMe();
          throw error;
        }
        const outcome = rentalsRefreshOutcome({ accountBefore, accountNow: get().authUser?.id ?? null, responseAccount: data.user.id });
        if (outcome !== 'write') throw new Error('Compte changé pendant la relecture des locations');
        set({
          rentals: data.activeRentals.map(apiRentalToRental),
          rentalHistory: historyFromApi(data.rentalHistory),
          ...filmVersionsAfterRead(get(), data.user.id, data.activeRentals.map((r) => r.film_id)),
        });
      },

      fetchMe: async () => {
        try {
          const data = await api.me.get();
          set({
            isAuthenticated: true,
            authUser: data.user,
            rentals: data.activeRentals.map(apiRentalToRental),
            // Source of truth for the rental history (was previously never populated → terminal showed
            // "empty" even with rentals on record). Server returns ALL of the user's rentals.
            rentalHistory: historyFromApi(data.rentalHistory),
            userReviews: data.reviews || [],
            reviewEligibility: Object.fromEntries(
              (data.reviewEligibility || []).map((e) => [e.film_id, { allowed: e.allowed, reason: e.reason, availableAtMs: e.available_at_ms }]),
            ),
            weeklyBonusStatus: data.weeklyBonus ?? null,
            versionPref: parseVersionChoice(data.user.version_pref?.audio, data.user.version_pref?.subtitle),
            // Les choix par film de ce seul compte, pour ses films encore loués ; jamais ceux d'un visiteur précédent.
            ...filmVersionsAfterRead(get(), data.user.id, data.activeRentals.map((r) => r.film_id)),
          });
        } catch (error) {
          // Non connecté, pas d'erreur. Les choix par film et leur propriétaire restent sur l'appareil. La version préférée
          // ne part que sur un vrai 401 (keepsVersionPref) : une panne ne fait pas changer la version en plein film.
          const status = error instanceof ApiError ? error.status : null;
          // Seul un 401 dit « non connecté ». Une panne (réseau coupé, erreur 5xx) ne déconnecte personne : le compte
          // reste à l'écran tel qu'il était, la lecture suivante le rafraîchira. Sans cela « Mon compte » s'ouvrait sur
          // un pseudo vide et des crédits inventés (batterie de tests du 25/11/2026).
          if (status !== 401) return;
          set({
            isAuthenticated: false, authUser: null, rentals: [], rentalHistory: [], userReviews: [], reviewEligibility: {}, weeklyBonusStatus: null,
            ...(keepsVersionPref(status) ? {} : { versionPref: null }),
          });
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

      getRental: (filmId) =>
        (get().previewRental?.filmId === filmId ? get().previewRental : null)
        ?? get().rentals.find((r) => r.filmId === filmId),

      updateRentalProgress: (filmId, progress, position) => {
        set((state) => ({
          previewRental: state.previewRental?.filmId === filmId
            ? {
                ...state.previewRental,
                watchPosition: position,
                watchProgress: Math.max(state.previewRental.watchProgress, progress),
              }
            : state.previewRental,
          rentals: state.rentals.map((r) =>
            r.filmId === filmId
              ? { ...r, watchPosition: position, watchProgress: Math.max(r.watchProgress, progress) }
              : r
          ),
        }));
        // Une prévisualisation n'a pas de ligne `rentals` : appeler l'API
        // renverrait 404 toutes les 10 s, et le store local suffit au player.
        if (get().previewRental?.filmId === filmId) return Promise.resolve({ ok: true });
        return api.rentals.updateProgress(filmId, progress, position);
      },

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
          throw new Error('Connecte-toi pour louer un film.');
        }

        // Let the API error (insufficient credits, out of stock, etc.)
        // propagate so the calling component can surface it to the user.
        // The previous catch + return null produced silent failures where
        // tapping the rent button did nothing visible on mobile.
        const { rental } = await api.rentals.rent(filmId);
        const frontendRental = apiRentalToRental(rental);

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
      setScene: (scene) => set((s) => ({ currentScene: scene, isSceneReady: scene !== 'interior' || s.interiorWarm })),
      setAisle: (aisle) => set({ currentAisle: aisle }),
      selectFilm: (filmId) => {
        if (filmId !== null) {
          // Switch to 'film' mode first (clears other overlay flags via the
          // single mutex setter), then set the actual filmId.
          get().setInteractionMode('film');
          set({
            selectedFilmId: filmId,
            targetedFilmId: null,
            targetedCassetteKey: null,
          });
          const allFilms = Object.values(get().films).flat();
          const film = allFilms.find(f => f.id === filmId) || get().deskFilms.find(f => f.id === filmId);
          if (film) fetchVHSCoverData(film).catch(() => {});
        } else if (get().interactionMode === 'film') {
          // Leaving film mode — setInteractionMode clears selectedFilmId.
          get().setInteractionMode('none');
        } else {
          set({ selectedFilmId: null, targetedFilmId: null, targetedCassetteKey: null });
        }
      },

      // Films cache
      failedAisles: [],
      films: {
        nouveautes: [],
        action: [],
        aventure: [],
        horreur: [],
        comedie: [],
        drame: [],
        thriller: [],
        policier: [],
        sf: [],
        animation: [],
        classiques: [],
        bizarre: [],
        romance: [],
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
        const aisles: AisleType[] = ['nouveautes', 'action', 'aventure', 'horreur', 'comedie', 'drame', 'thriller', 'policier', 'sf', 'animation', 'classiques', 'bizarre', 'romance'];
        try {
          // Un rayon en échec n'est pas un rayon vide : il est retenu, et garde les films qu'on lui connaissait.
          const failed: AisleType[] = [];
          const results = await Promise.all(
            aisles.map(aisle => api.films.getByAisle(aisle).catch(() => { failed.push(aisle); return { aisle, films: [] }; }))
          );
          const filmsMap: Record<AisleType, Film[]> = {
            nouveautes: [], action: [], aventure: [], horreur: [], comedie: [], drame: [], thriller: [], policier: [], sf: [], animation: [], classiques: [], bizarre: [], romance: [],
          };
          const rentalCounts: Record<number, { stock: number; activeRentals: number }> = {};
          for (const { aisle, films: aisleFilms } of results) {
            const converted = failed.includes(aisle as AisleType) ? get().films[aisle as AisleType] : (aisleFilms as ApiFilm[]).map(apiFilmToFilm);
            filmsMap[aisle as AisleType] = converted;
            for (const film of converted) {
              rentalCounts[film.id] = {
                stock: film.stock ?? 2,
                activeRentals: film.active_rentals ?? 0,
              };
            }
          }
          set({ films: filmsMap, filmRentalCounts: rentalCounts, failedAisles: failed });
        } catch (error) {
          console.error('Erreur chargement films:', error);
        }
      },

      // Desk display
      deskFilms: [],
      fetchDeskFilms: async () => {
        try {
          const apiFilms = await api.films.getDeskDisplay();
          set({ deskFilms: apiFilms.map(apiFilmToFilm) });
        } catch {
          // Silently fail — desk will show empty
        }
      },
      showDeskFilmPicker: false,
      setShowDeskFilmPicker: (show) => set({ showDeskFilmPicker: show }),

      // Manager IA — see src/store/slices/manager.ts
      ...createManagerSlice(set, get, store),

      // Cast — voir src/store/slices/cast.ts
      ...createCastSlice(set, get, store),

      // Versions (préférence du compte, choix par film) — voir src/store/slices/version.ts
      ...createVersionSlice(set, get, store),

      // Player
      isPlayerOpen: false,
      currentPlayingFilm: null,
      playerFrom: 'store',
      playerAsk: true,
      previewRental: null,
      previewFilm: null,
      openPreviewPlayer: (film, rental) => set({
        isPlayerOpen: true,
        currentPlayingFilm: film.id,
        previewFilm: film,
        previewRental: rental,
        managerVisible: false,
        chatBackdropUrl: null,
      }),
      openPlayer: (filmId, opts) => {
        // Always allow opening — even if another film is already casting. The
        // player reads the Cast machine (`castView`): this film on the TV → the
        // remote control; another film → local player with its banner. The
        // previous silent return left users wondering why "Watch" did nothing.
        set({
          isPlayerOpen: true,
          currentPlayingFilm: filmId,
          playerFrom: opts?.from ?? 'store',
          playerAsk: opts?.ask ?? true,
          // Une location réelle remplace toute prévisualisation admin restée
          // ouverte dans le même onglet.
          previewRental: null,
          previewFilm: null,
          managerVisible: false,
          chatBackdropUrl: null,
        });
      },
      // closePlayer leaves the TV alone: the film continues on the TV
      // without the player, and the next openPlayer finds it through the
      // Cast machine (remote control) without re-casting. Seuls partent avec
      // le lecteur le message du Cast qu'il montrait et la reprise qu'il n'a
      // pas prise (castPlayerClosed ; « Location terminée » reste).
      closePlayer: () => {
        const filmId = get().currentPlayingFilm;
        set({
          isPlayerOpen: false,
          currentPlayingFilm: null,
          previewRental: null,
          previewFilm: null,
        });
        if (filmId !== null) get().castPlayerClosed(filmId);
      },

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
              preloadPosterImage(`/api/poster/w500${film.poster_path}`);
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

      // User reviews
      userReviews: [],
      reviewEligibility: {},
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
      vhsNavDirection: null,
      setVHSNavDirection: (dir) => set({ vhsNavDirection: dir }),
      vhsSwiping: false,
      vhsSwipeOffset: 0,
      setVhsSwipeState: (swiping, offset) => set({ vhsSwiping: swiping, vhsSwipeOffset: offset }),
      vhsFlipCount: 0,
      requestVHSFlip: () => set((state) => ({ vhsFlipCount: state.vhsFlipCount + 1 })),

      // === Interaction mode (single mutex setter) ===
      // Every transition into one of the 6 mutually-exclusive overlay modes
      // funnels through here. The 5 isXxx booleans are kept in the state
      // tree as derived mirrors so existing atomic selectors keep working.
      // selectedFilmId is also cleared when leaving 'film' mode.
      interactionMode: 'none',
      setInteractionMode: (mode) => {
        const prev = get().interactionMode;
        if (prev === mode) return;
        set({
          interactionMode: mode,
          isSitting:                mode === 'sitting',
          isInteractingWithMinitel: mode === 'minitel',
          isInteractingWithTV:      mode === 'tvStanding',
          isInteractingWithLaZone:  mode === 'lazoneStanding',
          isWatchingLaZone:         mode === 'lazoneWatching',
          // Leaving film mode also clears the selected film id.
          ...(prev === 'film' && mode !== 'film' ? { selectedFilmId: null, targetedFilmId: null, targetedCassetteKey: null } : {}),
        });
      },

      // Sitting on couch (derived view of interactionMode)
      isSitting: false,
      setSitting: (sitting) => {
        if (sitting) {
          get().setInteractionMode('sitting');
        } else if (get().interactionMode === 'sitting') {
          get().setInteractionMode('none');
        }
      },

      // TV zoom (Paramètres)
      isZoomedOnTV: false,
      setZoomedOnTV: (val) => set({ isZoomedOnTV: val }),

      // Minitel (derived view of interactionMode === 'minitel')
      isInteractingWithMinitel: false,
      setInteractingWithMinitel: (val) => {
        if (val) {
          get().setInteractionMode('minitel');
        } else if (get().interactionMode === 'minitel') {
          get().setInteractionMode('none');
          // UX 45: re-open minitel doit repartir du sommaire (idle).
          // NB: ne PAS reset highlightedCassetteKey ici — ILLUMINER LA K7
          // ferme le minitel volontairement pour laisser la K7 illuminée
          // dans le rayon. Le highlight est nettoyé ailleurs (au prochain
          // ILLUMINER, sélection cassette, etc.).
          set({
            minitelMode: 'idle',
            minitelQuery: '',
            minitelSelectedAisle: null,
            minitelSelectedFilm: null,
            minitelPageIndex: 0,
            minitelHighlightedItem: 1,
            pendingMinitelPress: null,
          });
        }
      },
      minitelMode: 'idle',
      setMinitelMode: (m) => set({ minitelMode: m }),
      minitelQuery: '',
      setMinitelQuery: (q) => set({ minitelQuery: q }),
      minitelSelectedAisle: null,
      setMinitelSelectedAisle: (a) => set({ minitelSelectedAisle: a }),
      minitelSelectedFilm: null,
      setMinitelSelectedFilm: (id) => set({ minitelSelectedFilm: id }),
      minitelPageIndex: 0,
      setMinitelPageIndex: (n) => set({ minitelPageIndex: n }),
      minitelHighlightedItem: 1,
      setMinitelHighlightedItem: (n) => set({ minitelHighlightedItem: n }),
      pendingMinitelPress: null,
      dispatchMinitelItem: (n) => set({ pendingMinitelPress: n }),
      consumeMinitelItem: () => set({ pendingMinitelPress: null }),
      highlightedCassetteKey: null,
      setHighlightedCassetteKey: (k) => set({ highlightedCassetteKey: k }),
      minitelIlluminerFlash: false,
      setMinitelIlluminerFlash: (v) => set({ minitelIlluminerFlash: v }),
      minitelTmdbResults: [],
      setMinitelTmdbResults: (r) => set({ minitelTmdbResults: r }),
      minitelTmdbState: 'idle',
      setMinitelTmdbState: (s) => set({ minitelTmdbState: s }),
      minitelRequestedIds: new Set<number>(),
      setMinitelRequestedIds: (ids) => set({ minitelRequestedIds: ids }),

      // Standing TV interaction (derived view of interactionMode === 'tvStanding')
      isInteractingWithTV: false,
      setInteractingWithTV: (val) => {
        if (val) {
          get().setInteractionMode('tvStanding');
        } else if (get().interactionMode === 'tvStanding') {
          get().setInteractionMode('none');
        }
      },

      // TV seated menu control
      tvMenuAction: null,
      dispatchTVMenu: (action) => set({ tvMenuAction: action }),
      clearTVMenuAction: () => set({ tvMenuAction: null }),

      // LaZone CRT interaction (derived views of interactionMode)
      isInteractingWithLaZone: false,
      setInteractingWithLaZone: (val) => {
        if (val) {
          get().setInteractionMode('lazoneStanding');
        } else if (get().interactionMode === 'lazoneStanding') {
          get().setInteractionMode('none');
        }
      },
      isWatchingLaZone: false,
      setWatchingLaZone: (val) => {
        if (val) {
          get().setInteractionMode('lazoneWatching');
        } else if (get().interactionMode === 'lazoneWatching') {
          get().setInteractionMode('none');
        }
      },
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

      // VHS swipe hint (mobile)
      hasSeenVHSSwipeHint: false,
      setHasSeenVHSSwipeHint: (seen) => set({ hasSeenVHSSwipeHint: seen }),

      // Benchmark
      benchmarkEnabled: false,
      setBenchmarkEnabled: (enabled) => set({ benchmarkEnabled: enabled }),
      toggleBenchmarkEnabled: () => set((state) => ({ benchmarkEnabled: !state.benchmarkEnabled })),

      // Loading screen
      isSceneReady: false,
      interiorWarm: false,
      // Appelé par le préchauffage de la scène intérieure (InteriorScene), qu'elle soit affichée
      // ou encore cachée derrière la devanture.
      setSceneReady: (ready) => set((s) => ({
        interiorWarm: ready,
        isSceneReady: s.currentScene === 'interior' ? ready : s.isSceneReady,
      })),

      // Weekly bonus
      weeklyBonusStatus: null,
      setWeeklyBonusStatus: (s) => set({ weeklyBonusStatus: s }),
      claimWeeklyBonus: async () => {
        try {
          const result = await api.me.claimWeeklyBonus();
          const { authUser } = get();
          if (authUser) {
            set({ authUser: { ...authUser, credits: result.new_balance } });
          }
          set({ weeklyBonusStatus: { canClaim: false, amount: 0, code: 'claimed' } });
          return true;
        } catch {
          return false;
        }
      },
      refreshWeeklyBonus: async () => {
        if (!get().isAuthenticated) return;
        try {
          set({ weeklyBonusStatus: await api.me.getWeeklyBonus() });
        } catch {
          // En panne : l'état connu reste, le serveur tranchera à l'appui.
        }
      },

      // Tutorial — see src/store/slices/tutorial.ts
      ...createTutorialSlice(set, get, store),

      // Board (sticky notes)
      boardOverlayMode: null,
      boardNotes: [],
      boardCapacity: null,
      selectedBoardNoteId: null,
      boardCreateCell: null,
      openBoardCreate: (row?: number, col?: number) => {
        set({
          boardOverlayMode: 'create',
          boardCreateCell: row !== undefined && col !== undefined ? { row, col } : null,
        });
      },
      openBoardNote: (noteId) => {
        set({ boardOverlayMode: 'detail', selectedBoardNoteId: noteId });
      },
      closeBoard: () => set({ boardOverlayMode: null, selectedBoardNoteId: null, boardCreateCell: null }),
      fetchBoardNotes: async () => {
        try {
          const { notes, capacity } = await api.board.getAll();
          set({ boardNotes: notes, boardCapacity: capacity });
        } catch {
          // silently fail
        }
      },
    }),
    {
      name: 'videoclub-storage',
      partialize: (state) => ({
        localUser: state.localUser,
        // La phrase de récupération tant qu'elle n'est pas notée : un rechargement (onglet déchargé pendant qu'on va
        // la coller ailleurs) la faisait disparaître pour toujours. « J'ai noté ma phrase » et la déconnexion l'effacent.
        recoveryPhrase: state.recoveryPhrase,
        rentalHistory: state.rentalHistory,
        hasSeenOnboarding: state.hasSeenOnboarding,
        hasSeenVHSSwipeHint: state.hasSeenVHSSwipeHint,
        hasCompletedTutorial: state.hasCompletedTutorial,
        // Le film dont le Cast court peut-être encore (page rechargée). Jamais l'état du Cast : adresse du film, drapeaux passagers.
        lastCastFilmId: state.lastCastFilmId,
        // Le choix fait pour chaque film loué, avec le compte à qui il appartient : retenu sur l'appareil. Jamais la
        // version préférée : le serveur la tient.
        filmVersions: state.filmVersions, filmVersionsUser: state.filmVersionsUser,
        // Navigation state — persisted so mobile tab-switch doesn't reset to exterior
        currentScene: state.currentScene,
        currentAisle: state.currentAisle,
        // Ne pas persister benchmarkEnabled — use ?benchmark=1 URL param only
        // Ne pas persister authUser, les cookies de session gèrent ça
      }),
    }
  )
);


// Dev/test hook — expose store to browser console & Playwright MCP
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __store?: typeof useStore }).__store = useStore;
}

// Single source of truth for the displayed credit count. Picks authUser.credits
// when signed in, falls back to localUser.credits (guest welcome bonus = 5)
// otherwise. Returning the number directly lets Zustand re-render only on
// value change — selecting the `getCredits` function (stable reference) misses
// updates, which is what 3 call-sites used to do.
export const useCredits = (): number =>
  useStore((s) =>
    s.isAuthenticated && s.authUser ? s.authUser.credits : s.localUser.credits,
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

// Debug: expose store on window for Playwright testing
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__store = useStore;
}
