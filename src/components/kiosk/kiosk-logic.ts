// Logique pure de la borne de location : onglets, listes, tris, libellés, décision du bouton
// d'action, déroulé d'une location, geste retour, orientation. La validation des formulaires
// de compte est partagée avec le vidéoclub : src/utils/account-rules.ts.
//
// Ce module est chargé tel quel par Node dans les tests (tests/domain/kiosk-logic.test.mjs) : imports de type, et
// imports de valeur relatifs qui portent l'extension `.ts` (sans elle, Node ne les trouverait pas).
import type { AisleType, Film } from '../../types';
import type { RentalHistoryEntry, ReviewEligibilityMap } from '../../store';
import type { CastPhase, CastView } from '../../cast/cast-machine';
import { resolvedVersion, versionLine } from '../../utils/version-choice.ts';
import type { VersionDecision, VersionOffer } from '../../utils/version-choice.ts';

// ===== Onglets =====

export type KioskTab = AisleType | 'tous';
export type KioskSort = 'rayon' | 'alpha' | 'date';

export const KIOSK_TABS: ReadonlyArray<{ id: KioskTab; label: string }> = [
  { id: 'nouveautes', label: 'Nouveautés' },
  { id: 'action', label: 'Action' },
  { id: 'aventure', label: 'Aventure' },
  { id: 'comedie', label: 'Comédie' },
  { id: 'drame', label: 'Drame' },
  { id: 'horreur', label: 'Horreur' },
  { id: 'policier', label: 'Policier' },
  { id: 'romance', label: 'Romance' },
  { id: 'sf', label: 'SF' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'animation', label: 'Animation' },
  { id: 'classiques', label: 'Classiques' },
  { id: 'bizarre', label: 'Bizarre' },
  { id: 'tous', label: 'Tous' },
];

/**
 * Six rayons par page, et « Suite » pour les autres : la colonne compte sept boutons au lieu de huit
 * (Rusmir, 17/11/2026 : « la partie section occupe trop de place en hauteur […] laisser plus de
 * place pour la description »).
 */
export const KIOSK_TAB_PAGE_SIZE = 6;

/** Les onglets, par pages de six (la colonne des rayons n'en montre qu'une à la fois). */
export function tabPages(): KioskTab[][] {
  const pages: KioskTab[][] = [];
  for (let i = 0; i < KIOSK_TABS.length; i += KIOSK_TAB_PAGE_SIZE) {
    pages.push(KIOSK_TABS.slice(i, i + KIOSK_TAB_PAGE_SIZE).map((t) => t.id));
  }
  return pages;
}

/** Libellé d'un onglet ; un tiret quand le film n'a aucun rayon (Film.aisle est nullable). */
export function tabLabel(id: KioskTab | null | undefined): string {
  if (!id) return '—';
  return KIOSK_TABS.find((t) => t.id === id)?.label ?? '—';
}

// ===== Listes et tris =====

/** Tous les films du catalogue, sans doublon (un film peut être en rayon et en nouveauté). */
export function allFilms(films: Record<AisleType, Film[]>): Film[] {
  const seen = new Set<number>();
  const out: Film[] = [];
  for (const aisleFilms of Object.values(films)) {
    for (const film of aisleFilms) {
      if (seen.has(film.id)) continue;
      seen.add(film.id);
      out.push(film);
    }
  }
  return out;
}

/** Les films d'un onglet, triés. `'rayon'` garde l'ordre reçu de l'API. */
export function filmsForTab(films: Record<AisleType, Film[]>, tab: KioskTab, sort: KioskSort): Film[] {
  const list = tab === 'tous' ? allFilms(films) : [...(films[tab] ?? [])];
  if (sort === 'alpha') {
    list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  } else if (sort === 'date') {
    list.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
  }
  return list;
}

/** L'onglet affiché à l'ouverture : Nouveautés, ou le premier rayon qui a des films. */
export function firstNonEmptyTab(films: Record<AisleType, Film[]>): KioskTab {
  for (const { id } of KIOSK_TABS) {
    if (id !== 'tous' && (films[id]?.length ?? 0) > 0) return id;
  }
  return 'nouveautes';
}

// ===== État du catalogue =====

export const CATALOG_WAIT_MS = 8000;

/**
 * Jamais un écran vide : on charge, puis on dit que le catalogue est indisponible — tout de
 * suite si le chargement a répondu sans rien rapporter (`loadFailed`), au bout de 8 s sinon.
 */
export function catalogState(total: number, waitedMs: number, loadFailed = false): 'ready' | 'loading' | 'unavailable' {
  if (total > 0) return 'ready';
  if (loadFailed) return 'unavailable';
  return waitedMs < CATALOG_WAIT_MS ? 'loading' : 'unavailable';
}

// ===== Libellés de la fiche =====

/** Chemin de la jaquette par le proxy du site, ou `null` quand le film n'a pas d'affiche. */
export function posterSrc(film: Pick<Film, 'poster_path'>, size: 'w185' | 'w342'): string | null {
  return film.poster_path ? `/api/poster/${size}${film.poster_path}` : null;
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function releaseYear(film: Pick<Film, 'release_date'>): string {
  const year = (film.release_date || '').slice(0, 4);
  return year.length === 4 ? year : '—';
}

export function versionLabel(v: { vf: boolean; vo: boolean } | null): string {
  if (!v) return '—';
  const parts: string[] = [];
  if (v.vf) parts.push('VF');
  if (v.vo) parts.push('VO');
  return parts.length ? parts.join(' · ') : '—';
}

/** « 0 crédit », « 1 crédit », « 2 crédits ». */
export function creditsLabel(n: number): string {
  return `${n} crédit${n > 1 ? 's' : ''}`;
}

/**
 * Largeur des signes dans la police des libellés (Big Shoulders Display, graisse 800), en em,
 * relevée sur le fichier de police et arrondie au centième supérieur. Sert à choisir le corps du
 * titre : compter les signes ne suffit pas, « Confessions d'un homme dangereux » et « Killers of
 * the Flower Moon » n'ont que six signes d'écart mais 38 % de largeur. À REFAIRE si la police ou
 * la graisse du titre change (les tests portent des largeurs mesurées qui le rappelleront).
 */
const TITLE_GLYPH_EM: ReadonlyArray<readonly [number, string]> = [
  [0.2, "'"],
  [0.22, " IijlÎîï"],
  [0.24, "!,.:’"],
  [0.26, "1"],
  [0.28, "()"],
  [0.3, "³"],
  [0.32, "f"],
  [0.33, "rt"],
  [0.36, "«»"],
  [0.38, "FLz"],
  [0.39, "/ETZxÈÉÊ"],
  [0.41, "s"],
  [0.42, "-vy"],
  [0.43, "JYcekçèéêë"],
  [0.44, "PX"],
  [0.45, "7?ABRSaoÀÂàâäôö"],
  [0.46, "2CGHKUVÇ"],
  [0.47, "689DOQbdghnpquÔùûü"],
  [0.48, "034"],
  [0.49, "5"],
  [0.51, "N"],
  [0.52, "–"],
  [0.59, "&"],
  [0.64, "Œ"],
  [0.66, "…"],
  [0.67, "æ"],
  [0.68, "œ"],
  [0.7, "M"],
  [0.71, "w"],
  [0.72, "m"],
  [0.74, "W"],
  [0.85, "—"],
];
const TITLE_GLYPH_LOOKUP = new Map<string, number>(TITLE_GLYPH_EM.flatMap(([em, glyphs]) => Array.from(glyphs, (glyph) => [glyph, em] as [string, number])));
const TITLE_SPACE_EM = TITLE_GLYPH_LOOKUP.get(' ') ?? 0.2;
/** Un signe absent de la table compte large : mieux vaut un titre un peu petit qu'un titre coupé. */
const TITLE_UNKNOWN_EM = 0.7;

/** Largeur estimée d'un titre, en em. Vérifiée sur les titres du catalogue : de 0,4 à 1,6 % au-dessus de la largeur réelle. */
export function titleWidthEm(title: string): number {
  let width = 0;
  for (const glyph of title.trim()) {
    width += glyph === '\u00a0' || glyph === '\u202f' ? TITLE_SPACE_EM : TITLE_GLYPH_LOOKUP.get(glyph) ?? TITLE_UNKNOWN_EM;
  }
  return width;
}

/** Largeur du titre au bas de l'ardoise, en cqw. */
export const TITLE_W = 60.8;
/**
 * Largeur laissée au titre sur le parcours, à côté du bouton « (i) Fiche » (12,7cqw, à 1,6cqw du titre).
 * Rusmir, 17/11/2026 : « placé à côté du titre avec un petit bouton de type (i) fiche film », puis
 * « réduis le bouton fiche film de 30 % » (24 → 16,8cqw), puis « change fiche film par fiche et réduis
 * d'autant » (moins 4,13cqw, la largeur de « film » mesurée dans le navigateur) : le titre regagne la place.
 */
export const TITLE_W_WITH_INFO = TITLE_W - 12.7 - 1.6;

/**
 * Corps du titre sur la fiche : le plus grand qui tient dans sa largeur (`widthCqw`, toute
 * l'ardoise par défaut). Grand (6cqw) ou moyen (5cqw) sur une ligne, avec 3,2cqw de marge — sur
 * toute la largeur : jusqu'à 9,6 em et 11,5 em —, petit et sur deux lignes au-delà.
 */
export function titleScale(title: string, widthCqw: number = TITLE_W): 'lg' | 'md' | 'sm' {
  const width = titleWidthEm(title);
  if (width * 6 <= widthCqw - 3.2 + 1e-9) return 'lg';
  return width * 5 <= widthCqw - 3.3 + 1e-9 ? 'md' : 'sm';
}

export function synopsisText(overview: string | null | undefined): string {
  const text = (overview ?? '').trim();
  return text || 'Synopsis indisponible.';
}

/**
 * Générique court de la fiche : deux réalisateurs et trois interprètes au plus. `null` quand on
 * ne sait rien (détail pas encore arrivé, ou film sans générique) : la fiche n'affiche alors
 * pas de ligne vide.
 */
export function creditsLine(
  directors: ReadonlyArray<string> | null | undefined,
  cast: ReadonlyArray<string> | null | undefined,
): { by: string | null; cast: string | null } | null {
  const names = (list: ReadonlyArray<string> | null | undefined, max: number) =>
    (list ?? []).map((name) => name.trim()).filter(Boolean).slice(0, max).join(', ') || null;
  const by = names(directors, 2);
  const withCast = names(cast, 3);
  return by === null && withCast === null ? null : { by, cast: withCast };
}

// ===== Bouton d'action =====

export type RentAction = 'login' | 'watch' | 'unavailable' | 'unplayable' | 'out-of-stock' | 'insufficient' | 'rent';

/**
 * Ce que fait le bouton d'action de la fiche, par ordre de priorité. `copiesLeft` vaut `null` tant que le stock est
 * inconnu ; `playable` : le film a au moins une version lisible (`has_vf` / `has_vo` de la fiche, spec 2026-11-19 § 6).
 * Un film qui ne se loue pas le dit avant la connexion : un invité n'est pas envoyé s'inscrire pour rien.
 */
export function rentAction(i: {
  isAuthenticated: boolean;
  isRented: boolean;
  isAvailable: boolean;
  playable: boolean;
  copiesLeft: number | null;
  credits: number;
  cost: number;
}): RentAction {
  if (i.isRented) return 'watch';
  if (!i.isAvailable) return 'unavailable';
  if (!i.playable) return 'unplayable';
  if (!i.isAuthenticated) return 'login';
  if (i.copiesLeft !== null && i.copiesLeft <= 0) return 'out-of-stock';
  if (i.credits < i.cost) return 'insufficient';
  return 'rent';
}

/**
 * Ce qu'affiche le bouton d'action : l'action, et le prix à part — en toutes lettres, jamais en
 * abrégé. Le prix n'apparaît que lorsqu'un appui mène à une location. Les libellés sont écrits
 * normalement : la feuille de style met l'action principale en capitales.
 */
export function actionLabel(action: RentAction, cost: number, renting: boolean): { text: string; price: string | null } {
  if (renting) return { text: 'Location…', price: null };
  if (action === 'watch') return { text: 'Regarder', price: null };
  if (action === 'unavailable' || action === 'unplayable') return { text: 'Indisponible', price: null };
  if (action === 'out-of-stock') return { text: 'Toutes louées', price: null };
  return { text: 'Louer', price: creditsLabel(cost) };
}

/**
 * Le message qui confirme une location : le film, son prix, et ce qui restera ensuite. Louer
 * dépense des crédits : la borne ne le fait jamais en un seul appui (décision de Rusmir du
 * 17/11/2026). Espaces insécables dans les guillemets : « ne reste jamais seul en fin de ligne.
 */
export function confirmRentText(i: { title: string; cost: number; credits: number }): { title: string; body: string } {
  const left = i.credits - i.cost;
  const after = left > 0 ? `Il vous restera ${creditsLabel(left)}.` : 'Il ne vous restera plus de crédit.';
  return {
    title: 'Confirmer la location',
    body: `«\u00a0${i.title.trim()}\u00a0» pour ${creditsLabel(i.cost)}. ${after}`,
  };
}

export type RentFlowResult =
  | { status: 'ok' }
  | { status: 'busy' }
  | { status: 'error'; message: string; httpStatus: number | null };

/** « Se reconnecter » n'a de sens que si le serveur ne reconnaît plus la session (401). */
export function offersRelogin(result: RentFlowResult): boolean {
  return result.status === 'error' && result.httpStatus === 401;
}

/**
 * Déroulé d'une location. Le verrou rend le second appui sans effet tant que le premier n'a
 * pas répondu ; un échec du mode de visionnage n'annule pas une location déjà enregistrée.
 */
export async function rentFlow(
  deps: { rent: () => Promise<unknown>; setMode: () => Promise<unknown> },
  lock: { busy: boolean },
): Promise<RentFlowResult> {
  if (lock.busy) return { status: 'busy' };
  lock.busy = true;
  try {
    await deps.rent();
    try {
      await deps.setMode();
    } catch {
      // La location est faite : le mode de visionnage se repose à l'ouverture du lecteur.
    }
    return { status: 'ok' };
  } catch (error) {
    // Le code HTTP du refus (ApiError.status) est gardé : lui seul dit si la session a expiré.
    const status = (error as { status?: unknown } | null)?.status;
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Erreur inconnue',
      httpStatus: typeof status === 'number' ? status : null,
    };
  } finally {
    lock.busy = false;
  }
}

/** « 19 novembre à 18:42 » — l'échéance d'une location. `timeZone` ne sert qu'aux tests. */
export function formatUntil(expiresAt: number, timeZone?: string): string {
  return new Date(expiresAt).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

// ===== Distribution de la K7 =====
//
// Après « LOUER » confirmé : « Veuillez patienter », puis le panneau « Votre K7 est prête » et l'écran
// « Mes locations » (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 7).

/**
 * Au-delà, « Veuillez patienter » rend la main : l'appel au serveur n'a pas de délai maximal, et
 * pendant l'attente « Quitter » est inerte et le geste retour ne fait rien (revue du 17/11/2026).
 */
export const KIOSK_RENT_TIMEOUT_MS = 30_000;

/** « À rendre avant le 19 novembre à 18:42 ». `timeZone` ne sert qu'aux tests. */
export function readyUntilText(expiresAt: number, timeZone?: string): string {
  return `À rendre avant le ${formatUntil(expiresAt, timeZone)}`;
}

/** Temps restant d'une location : « encore 2 j 4 h », « encore 3 h 05 », « encore 42 min », « expirée ». */
export function timeLeftLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expirée';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    const h = hours - days * 24;
    return h > 0 ? `encore ${days} j ${h} h` : `encore ${days} j`;
  }
  if (hours >= 1) return `encore ${hours} h ${String(minutes - hours * 60).padStart(2, '0')}`;
  return `encore ${Math.max(1, minutes)} min`;
}

export type KioskRentalRow = { filmId: number; title: string; timeLeft: string; expiresAt: number };

/** Lignes de « Mes locations » : la plus proche de son échéance d'abord. */
export function rentalRows(
  rentals: ReadonlyArray<{ filmId: number; expiresAt: number }>,
  films: ReadonlyArray<Pick<Film, 'id' | 'title'>>,
  now: number,
): KioskRentalRow[] {
  return rentals
    .map((r) => ({
      filmId: r.filmId,
      title: films.find((f) => f.id === r.filmId)?.title ?? 'Titre indisponible',
      timeLeft: timeLeftLabel(r.expiresAt, now),
      expiresAt: r.expiresAt,
    }))
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

// ===== « Mon compte » =====
//
// docs/superpowers/specs/2026-11-17-borne-mon-compte-design.md, § 4 : tout l'historique, et pour chaque film
// rendu le rembobinage, le retour anticipé et la critique. La règle des critiques est au serveur
// (/api/me → reviewEligibility) : la borne affiche, elle n'en a pas de copie.

export type KioskReviewState = { kind: 'publiée' } | { kind: 'possible' } | { kind: 'pas-encore'; reason: string };

export type KioskHistoryRow = {
  filmId: number;
  title: string;
  posterUrl: string | null;
  end: { kind: 'rendu' | 'expiré' | 'terminée'; atMs: number | null };
  rewound: boolean;
  returnedEarly: boolean;
  review: KioskReviewState;
};

/** L'état de la critique d'un film pour ce visiteur. Sans avis du serveur : il faut d'abord voir le film. */
export function reviewStateFor(filmId: number, reviewedFilmIds: ReadonlySet<number>, eligibility: ReviewEligibilityMap): KioskReviewState {
  if (reviewedFilmIds.has(filmId)) return { kind: 'publiée' };
  const e = eligibility[filmId];
  if (e?.allowed) return { kind: 'possible' };
  return { kind: 'pas-encore', reason: e?.reason ?? 'Vous devez regarder au moins 80 % du film' };
}

/**
 * Les locations terminées, la plus récente d'abord. « rendu » si le visiteur l'a rendue, « expiré » si elle est
 * arrivée à échéance, « terminée » (sans date) pour une location antérieure à ces dates.
 */
export function accountHistoryRows(
  history: ReadonlyArray<RentalHistoryEntry>,
  reviewedFilmIds: ReadonlySet<number>,
  eligibility: ReviewEligibilityMap,
): KioskHistoryRow[] {
  return history
    .filter((h) => !h.isActive)
    .slice()
    .sort((a, b) => b.rentedAt - a.rentedAt)
    .map((h) => ({
      filmId: h.filmId,
      title: h.title?.trim() || 'Titre indisponible',
      posterUrl: h.posterUrl,
      end: h.returnDate ? { kind: 'rendu', atMs: h.returnDate } : h.expiredDate ? { kind: 'expiré', atMs: h.expiredDate } : { kind: 'terminée', atMs: null },
      rewound: !!h.rewindClaimed,
      returnedEarly: !!h.returnedEarly,
      review: reviewStateFor(h.filmId, reviewedFilmIds, eligibility),
    }));
}

/** « 18 novembre » — le jour d'un retour ou d'une échéance. `timeZone` ne sert qu'aux tests. */
export function dayLabel(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone });
}

// ===== Connexion =====

/**
 * Ce que le visiteur voulait faire quand la connexion s'est imposée (louer). Annuler la
 * connexion l'oublie ; la reprendre le consomme, une seule fois. Sans cela, une connexion
 * annulée pendant qu'elle était en cours aboutissait après coup et louait quand même le film.
 */
export function createPendingAction(): {
  set: (action?: () => void) => void;
  cancel: () => void;
  take: () => (() => void) | undefined;
} {
  let pending: (() => void) | undefined;
  return {
    set(action) {
      pending = action;
    },
    cancel() {
      pending = undefined;
    },
    take() {
      const action = pending;
      pending = undefined;
      return action;
    },
  };
}

export type { AccountFormMode as KioskAuthMode } from '../../utils/account-rules';

// ===== Geste retour =====

export type KioskBackAction =
  | 'none'
  | 'close-player'
  | 'close-notice'
  | 'close-question'
  | 'close-version'
  | 'close-ready'
  | 'close-review'
  | 'close-pref'
  | 'close-account'
  | 'cancel-auth'
  | 'close-trailer'
  | 'close-detail'
  | 'close-search';

/**
 * Ce que fait le geste retour (ou le bouton retour du navigateur) dans la borne : il ferme ce
 * qui est ouvert au-dessus des rayons, du plus haut au plus bas. À la racine il ne fait rien —
 * on ne sort de la borne que par « quitter ». Ne se ferment pas d'un geste : la phrase de
 * récupération (elle ne se retrouve nulle part ailleurs), un message sans fermeture
 * (« Catalogue indisponible », qui porte ses propres boutons) et « Veuillez patienter » (l'appel
 * au serveur qui enregistre la location ne s'annule pas).
 */
export function kioskBackAction(s: {
  playerOpen: boolean;
  noticeOpen: boolean;
  noticeClosable: boolean;
  authOpen: boolean;
  phrasePending: boolean;
  searchOpen: boolean;
  /** La fiche détaillée d'un film est ouverte. */
  detailOpen?: boolean;
  /** Sa bande-annonce est affichée : le geste l'arrête et ramène au résumé, la fiche reste ouverte. */
  trailerOpen?: boolean;
  /** « Veuillez patienter » : la location est en route vers le serveur. */
  waiting?: boolean;
  /** Le panneau « Votre K7 est prête » est affiché. */
  readyOpen?: boolean;
  /** La question des sous-titres remplace le contenu du panneau : le geste ramène au panneau, rien n'est lancé. */
  questionOpen?: boolean;
  /** La liste « Version » remplace le contenu du panneau : le geste ramène au panneau. */
  versionOpen?: boolean;
  /** L'écran « Mon compte » est ouvert. */
  accountOpen?: boolean;
  /** Le formulaire de critique est ouvert (par-dessus « Mon compte »). */
  reviewOpen?: boolean;
  /** La liste « Version préférée » remplace le contenu de « Mon compte » : le geste ramène au compte. */
  prefOpen?: boolean;
}): KioskBackAction {
  if (s.playerOpen) return 'close-player';
  if (s.noticeOpen) return s.noticeClosable ? 'close-notice' : 'none';
  if (s.waiting) return 'none';
  if (s.questionOpen) return 'close-question';
  if (s.versionOpen) return 'close-version';
  if (s.readyOpen) return 'close-ready';
  if (s.reviewOpen) return 'close-review';
  if (s.prefOpen) return 'close-pref';
  if (s.accountOpen) return 'close-account';
  if (s.phrasePending) return 'none';
  if (s.authOpen) return 'cancel-auth';
  if (s.detailOpen) return s.trailerOpen ? 'close-trailer' : 'close-detail';
  if (s.searchOpen) return 'close-search';
  return 'none';
}

// ===== Orientation =====

/** Petit côté de l'écran en dessous duquel un appareil tactile est tenu pour un téléphone. */
export const PHONE_SHORT_SIDE_MAX = 540;

/**
 * Sur un téléphone, le paysage est réservé au film : la borne (un écran vertical) ne s'y affiche
 * pas, elle demande de redresser l'appareil. `shortSide` est le petit côté de l'ÉCRAN, pas de la
 * fenêtre : le clavier virtuel, qui rétrécit la fenêtre, ne doit pas passer pour une rotation.
 */
export function hidesKioskInLandscape(i: { coarsePointer: boolean; landscape: boolean; shortSide: number }): boolean {
  return i.coarsePointer && i.landscape && i.shortSide <= PHONE_SHORT_SIDE_MAX;
}

// ===== « Où voulez-vous regarder ? » =====
//
// Rusmir, 17/11/2026 : « Sur la TV » et « Regarder » ne sont pas assez explicites. Chaque bouton dit où et
// comment (spec 2026-11-17-borne-mon-compte, § 3).

/** Où le film démarre si l'on choisit de le regarder ici. */
export function watchHereLabel(i: { coarsePointer: boolean; shortSide: number }): 'Sur ce téléphone' | 'Sur cette tablette' | 'Sur cet ordinateur' {
  if (!i.coarsePointer) return 'Sur cet ordinateur';
  return i.shortSide <= PHONE_SHORT_SIDE_MAX ? 'Sur ce téléphone' : 'Sur cette tablette';
}

/** Par quoi le film passe sur la télé : AirPlay sur un appareil Apple qui sait le faire, sinon Chromecast. */
export function tvMeansLabel(airPlay: boolean): 'via AirPlay' | 'via Chromecast' {
  return airPlay ? 'via AirPlay' : 'via Chromecast';
}

// Refonte du Cast (docs/superpowers/specs/2026-11-18-cast-refonte-design.md, § 5.4) : chaque reprise d'un film déjà
// loué — « REGARDER » de la fiche, « Regarder » de « Mon compte » — pose la question avec le panneau de la borne, pas
// avec l'invite du lecteur (proposition validée par Rusmir le 18/11/2026).

/**
 * Reprendre un film loué : la TV l'a déjà (elle le joue, ne répond plus pour lui, ou vient de le finir) → le lecteur
 * tout de suite, sur sa télécommande ou sur « BE KIND REWIND » ; sinon le panneau « Où voulez-vous regarder ? ».
 * `view` : ce que la machine du Cast dit de CE film (`castView`).
 */
export function watchEntry(i: { view: CastView }): 'remote' | 'choose' {
  return i.view === 'remote' || i.view === 'lost' || i.view === 'ended' ? 'remote' : 'choose';
}

/**
 * « Sur ma télé » : sur un appareil Apple qui sait faire AirPlay, le Cast de Google n'existe pas — le lecteur s'ouvre
 * avec son invite, qui porte AirPlay (son sélecteur exige un appui direct). Partout ailleurs, le Cast.
 */
export function tvEntry(i: { airPlay: boolean }): 'airplay' | 'cast' {
  return i.airPlay ? 'airplay' : 'cast';
}

/**
 * La seconde ligne de « Sur ma télé » : par quoi le film passe (`tvMeansLabel`) ; ou, si la TV joue déjà un AUTRE film
 * (`castView` = `other-on-tv`), « remplace {titre} sur {nom} ». L'appui remplace sans demander : une confirmation en
 * deux temps ferait perdre l'activation de l'appui dont le sélecteur a besoin, le visiteur est donc prévenu AVANT
 * (correctif 1 de la refonte du Cast, spec 2026-11-18, § 5.4). `title` : le film de la TV dans le catalogue de la
 * borne, « un film » sinon ; `device` : déjà passé par `castDeviceLabel` (« la télé » quand le nom est inconnu).
 * AirPlay ne passe pas par le Cast : il ne remplace rien.
 */
export function tvChoiceLine(i: { airPlay: boolean; replacing: { title: string | null; device: string } | null }): string {
  if (i.airPlay || i.replacing === null) return tvMeansLabel(i.airPlay);
  return `remplace ${i.replacing.title?.trim() || 'un film'} sur ${i.replacing.device}`;
}

// ===== La version du film, dans le panneau (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.1, 4.3 a et 4.4) =====
// Le panneau, le lecteur et le Cast partent de la même décision (`decideVersion`, rendue par `versionDecisionFor`).

/** Le film loué n'a ni VF ni VO lisible : le lancement le dit au lieu de partir. */
export const NO_PLAYABLE_VERSION = "Ce film n'a aucune version lisible pour le moment.";

/**
 * « Sur ce téléphone » / « Sur ma télé » : une version décidée se lance (une substitution comprise : sa note est déjà
 * écrite sous la ligne « Version ») ; la question des sous-titres se pose d'abord, une fois, au moment de lancer ; sans
 * aucune version lisible, le lancement est refusé (`NO_PLAYABLE_VERSION`).
 */
export function readyLaunchStep(d: VersionDecision): 'launch' | 'ask' | 'refuse' {
  switch (d.kind) {
    case 'play': return 'launch';
    case 'ask': return 'ask';
    case 'none': return 'refuse';
  }
}

/**
 * La ligne « Version » du panneau : la version qui jouera (celle qu'on garde par défaut tant que la question n'a pas été
 * posée), si un appui ouvre la liste, et la note d'une substitution. Sans version lisible, la ligne n'ouvre rien et
 * dit pourquoi.
 */
export function readyVersionRow(offer: VersionOffer, d: VersionDecision): { text: string; openable: boolean; note: string | null } {
  if (d.kind === 'none') return { text: '—', openable: false, note: NO_PLAYABLE_VERSION };
  return { ...versionLine(offer, resolvedVersion(d)), note: d.kind === 'play' ? d.note : null };
}

/**
 * Ce qu'un lecteur d'écran entend sur la barre du Cast : ce que fait l'appui, selon l'état de la TV. `null` quand la
 * barre n'a rien à signaler (mêmes phases que `castChipLabel`).
 */
export function castBarLabel(phase: CastPhase, title: string): string | null {
  switch (phase) {
    // Deux-points plutôt que « de » : aucune élision à faire (« de Une Affaire… », « de Il était une fois… »).
    case 'remote': return `Ouvrir la télécommande : ${title}`;
    case 'lost': return `${title} : la télé ne répond plus, ouvrir`;
    case 'ended': return `${title} est terminé, ouvrir`;
    case 'idle': case 'choosing': case 'connecting': case 'loading': return null;
  }
}

/**
 * Un libellé écrit en capitales (`castChipLabel`, pour la puce du vidéoclub) remis dans la casse de la borne : une
 * majuscule initiale, le reste écrit normalement (« TÉLÉCOMMANDE » → « Télécommande »). Les mots restent ceux de
 * cast-labels, écrits à un seul endroit.
 */
export function kioskLabelCase(label: string): string {
  return label.charAt(0).toLocaleUpperCase('fr') + label.slice(1).toLocaleLowerCase('fr');
}

/**
 * « Location terminée » (la location d'un film sur la TV a disparu : échéance, retour, déconnexion). La borne le dit
 * lecteur fermé. Le lecteur ne dessine rien sans location mais reste « ouvert », la borne inerte sous lui : il est
 * d'abord fermé. Un lecteur qui joue un autre film, lui, n'est pas interrompu — le message attend sa fermeture.
 */
export function rentalOverStep(i: { playerOpen: boolean; playerHasRental: boolean }): 'show' | 'close-player' | 'wait' {
  if (!i.playerOpen) return 'show';
  return i.playerHasRental ? 'wait' : 'close-player';
}

// ===== Trame de la dalle =====

/**
 * Taille d'un pixel PHYSIQUE de l'écran, en px CSS. La trame de la dalle (sous-pixels, interligne)
 * est dessinée dans cette unité : un pas qui ne tombe pas sur un nombre entier de pixels physiques
 * bat avec la grille de l'écran et fait du moirage — c'est le cas d'un pas fixe en px CSS sur un
 * téléphone à densité fractionnaire (2,625 sur le Pixel 9a).
 */
export function lcdDevicePixel(devicePixelRatio: number | undefined): string {
  if (typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return '1px';
  return `${parseFloat((1 / devicePixelRatio).toFixed(6))}px`;
}

/**
 * Pas de la grille de la dalle, en pixels PHYSIQUES de l'écran : aussi serré que l'écran le permet.
 * Sur un écran non dense on ne peut pas dessiner plus fin qu'un trait d'un pixel tous les deux
 * pixels ; sur un écran dense le pas reste voisin d'un pixel CSS et demi, pour que la grille ait
 * la même finesse apparente partout.
 */
export function lcdPitchInDevicePixels(devicePixelRatio: number | undefined): number {
  if (typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 2;
  return Math.max(2, Math.round(devicePixelRatio * 1.5));
}

/**
 * La bande de jaquettes est-elle à son début, à son bout ? Une flèche qui ne mènerait plus nulle
 * part s'éteint à moitié (elle reste un bouton). Deux pixels de tolérance : sur un écran dense le
 * défilement s'arrête sur une fraction de pixel.
 */
export function railEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { atStart: boolean; atEnd: boolean } {
  return { atStart: scrollLeft <= 2, atEnd: scrollLeft + clientWidth >= scrollWidth - 2 };
}

// ===== Mise en page sur téléphone =====
//
// Validé par Rusmir le 17/11/2026 sur maquette, sur son Pixel 9a : chaque commande garde une hauteur
// minimale en pixels, quel que soit le téléphone ; sous « LOUER », seulement la bande de jaquettes,
// trois K7 à la fois, sur toute la hauteur qui reste. Le format de l'écran (5:9, 180cqw de haut) ne
// change pas : c'est la répartition de sa hauteur qui s'adapte.

/** Hauteurs minimales des commandes, en pixels CSS. */
export const KIOSK_MIN_PX = { nav: 40, tab: 44, btn: 48 } as const;

export type KioskLayout = {
  navH: number;
  cardTop: number;
  tabH: number;
  cardH: number;
  posterW: number;
  metaGap: number;
  underTop: number;
  underH: number;
  showUnder: boolean;
  synSize: number;
  synLines: number;
  btnTop: number;
  btnH: number;
  stripTop: number;
  stripH: number;
  railPosterH: number;
  /** Barre du Cast (KioskCastBar), entre LOUER et la bande ; hauteur 0 quand elle n'est pas montrée. */
  castTop: number;
  castH: number;
};

const SCREEN_H = 180; // écran haut 5:9, en cqw
const RAIL_W = 70.4; // largeur utile de la bande entre les flèches, en cqw
/** Hauteur d'une jaquette de la bande quand trois tiennent entières entre les flèches (2:3, deux intervalles de 0,5cqw). */
export const RAIL_POSTER_MAX_H = ((RAIL_W - 1) / 3) * 1.5;
/** Corps du texte du cadre « En bref », en cqw ; sur téléphone on y ajoute SYN_EXTRA_PX pixels (Rusmir, 17/11/2026 : « une police 1 ou 2 px plus grande, on a du mal à lire »). */
const SYN_SIZE = 3.75;
export const SYN_EXTRA_PX = 2;
/**
 * Jaquette de l'ardoise : 10 % plus grande que le calcul d'origine (Rusmir, 17/11/2026 : « la jaquette
 * elle-même devrait être 10 % plus grande »), dans la limite de la place. À gauche, les valeurs au
 * feutre : la plus large, « Tous publics », s'arrête à 24,3cqw du bord de l'ardoise (Marker Felt,
 * relevé le 17/11/2026) ; l'ardoise fait 66cqw, la jaquette est à 2cqw de son bord droit → 38,4cqw
 * au plus. En bas, elle s'arrête 1cqw au-dessus de la ligne du titre (elle passe sur celle de
 * l'étiquette « TITRE », dont le filet s'arrête avant elle).
 */
export const POSTER_MAX_W = 38.4;
const POSTER_GROWTH = 1.1;
const STRIP_MIN = 30; // en dessous, les jaquettes de la bande deviennent trop petites
const STRIP_PREF = 34; // bande confortable : des jaquettes d'environ 30cqw de haut
/** Boutons de la colonne des rayons : une page d'onglets et « Suite ». */
const COLUMN_BUTTONS = KIOSK_TAB_PAGE_SIZE + 1;

/**
 * Répartition de la hauteur de l'écran de la borne sur un téléphone, en cqw, pour un écran de
 * `pxPerCqw` pixels par cqw (sa largeur divisée par 100). Les commandes ne descendent jamais sous
 * KIOSK_MIN_PX ; la fiche suit la colonne des rayons ; la place qui reste se partage entre le cadre
 * « En bref » et la bande de jaquettes. La description passe en premier (Rusmir : « laisser plus de
 * place pour la description »), tant que la bande garde des jaquettes confortables :
 *  1. le plus de lignes de résumé possible, jusqu'à quatre, avec une bande d'au moins STRIP_PREF ;
 *  2. sinon deux lignes, avec une bande d'au moins STRIP_MIN ;
 *  3. sinon le générique seul (« De », « Avec ») ;
 *  4. sinon le cadre s'efface : sur un tout petit écran, les jaquettes passent avant le reste.
 *
 * `castBar` : la barre du Cast (la TV a un film à signaler, lecteur fermé) prend sa place entre LOUER et la bande,
 * haute comme un onglet (44 px au moins). Sa place est retirée de celle qui se partage, par les mêmes règles : elle
 * ne recouvre rien et ne pousse rien hors de l'écran ; c'est le cadre « En bref » qui cède d'abord (refonte du Cast,
 * spec 2026-11-18, § 5.5 point 6 — visuel provisoire tant que Rusmir ne l'a pas vu).
 */
export function phoneLayout(pxPerCqw: number, castBar = false): KioskLayout {
  const q = pxPerCqw > 0 && Number.isFinite(pxPerCqw) ? pxPerCqw : 4;
  const navH = Math.max(7.6, KIOSK_MIN_PX.nav / q);
  const tabH = Math.max(9.75, KIOSK_MIN_PX.tab / q);
  const btnH = Math.max(12, KIOSK_MIN_PX.btn / q);
  const synSize = SYN_SIZE + SYN_EXTRA_PX / q;
  const line = synSize * 1.24; // une ligne du cadre « En bref »
  const underCredits = 3 + 2 * line + 1 + 0.4; // marges du cadre + générique (« De », « Avec »)
  const cardTop = 1.9 + navH + 2.5;
  const cardH = COLUMN_BUTTONS * tabH + 1.8;
  const underTop = cardTop + cardH + 1.6;
  const castH = castBar ? tabH : 0;
  const castSpace = castBar ? castH + 1.8 : 0; // la barre et l'écart qui la sépare de la bande
  const available = SCREEN_H - underTop - 2 - btnH - 1.8 - 2.4 - castSpace;
  const underFor = (lines: number) => underCredits + lines * line;
  const preferred = [4, 3, 2].find((lines) => available - underFor(lines) >= STRIP_PREF);
  let underH = 0;
  let showUnder = true;
  if (preferred !== undefined) underH = underFor(preferred);
  else if (available - underFor(2) >= STRIP_MIN) underH = underFor(2);
  else if (available - underCredits >= STRIP_MIN) underH = underCredits;
  else showUnder = false;
  const btnTop = showUnder ? underTop + underH + 2 : underTop;
  const castTop = btnTop + btnH + 1.8;
  const stripTop = castTop + castSpace;
  const stripH = SCREEN_H - 2.4 - stripTop;
  return {
    navH,
    cardTop,
    tabH,
    cardH,
    // Avant : Math.min(38, (cardH - 26.7) / 1.5), jaquette à 2,8cqw du haut de l'ardoise (6,6cqw sous
    // le haut de la fiche), 1,5cqw au-dessus de la zone du titre (14,4cqw, à 1,4cqw du bas).
    // Maintenant à 1,4cqw du haut, et jusqu'à 1cqw au-dessus de la ligne du titre (14,4 − 3,83cqw).
    posterW: Math.min(POSTER_MAX_W, Math.min(38, (cardH - 26.7) / 1.5) * POSTER_GROWTH, (cardH - 6.6 - 1.4 - (14.4 - 3.83) - 1 - 1.4) / 1.5),
    metaGap: 1.7 + Math.max(0, cardH - 80) / 6,
    underTop,
    underH,
    showUnder,
    synSize,
    synLines: showUnder ? Math.max(0, Math.min(4, Math.floor((underH - underCredits) / line + 1e-6))) : 0,
    btnTop,
    btnH,
    stripTop,
    stripH,
    railPosterH: Math.min(RAIL_POSTER_MAX_H, (stripH - 0.8) * 0.9),
    castTop,
    castH,
  };
}

/** Les variables CSS de l'écran de la borne qui portent cette mise en page. */
export function phoneLayoutVars(L: KioskLayout): Record<string, string> {
  const cq = (v: number) => `${Math.round(v * 1000) / 1000}cqw`;
  return {
    '--k-nav-h': cq(L.navH),
    '--k-card-top': cq(L.cardTop),
    '--k-tab-h': cq(L.tabH),
    '--k-card-h': cq(L.cardH),
    '--k-poster-w': cq(L.posterW),
    '--k-meta-gap': cq(L.metaGap),
    '--k-under-top': cq(L.underTop),
    '--k-under-h': cq(L.underH),
    '--k-under-display': L.showUnder ? 'block' : 'none',
    '--k-syn-size': cq(L.synSize),
    '--k-syn-lines': String(Math.max(1, L.synLines)),
    '--k-syn-display': L.synLines > 0 ? '-webkit-box' : 'none',
    '--k-btn-top': cq(L.btnTop),
    '--k-btn-h': cq(L.btnH),
    '--k-strip-top': cq(L.stripTop),
    '--k-rail-poster-h': cq(L.railPosterH),
    '--k-cast-top': cq(L.castTop),
    '--k-cast-h': cq(L.castH),
  };
}

// ===== Fiche détaillée d'un film =====
//
// Ouverte d'un appui sur la jaquette de la fiche (Rusmir, 17/11/2026 : « entrer dans la fiche du
// film en cliquant sur la jaquette […] une nouvelle page où on conserve la jaquette, le bouton
// location ou le retour, et où on aura toute la place »). Ses rubriques prennent la place des
// rayons, dans la même colonne d'onglets.

export type DetailTab = 'resume' | 'distribution' | 'equipe' | 'avis' | 'bande-annonce' | 'voir-aussi';

export const DETAIL_TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: 'resume', label: 'Résumé' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'equipe', label: 'Équipe' },
  { id: 'avis', label: 'Avis' },
  { id: 'bande-annonce', label: 'Bande-annonce' },
  { id: 'voir-aussi', label: 'À voir aussi' },
];

/** Une note sur 5 en étoiles, arrondie à l'étoile la plus proche. */
export function starsFor(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

/** Public conseillé d'après la classification française que donne TMDB (« 12 », « U »…). */
export function audienceLabel(certification: string | null | undefined): string | null {
  const c = (certification ?? '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'U' || c === 'TP' || c === 'TOUS PUBLICS') return 'Tous publics';
  const age = c.match(/^-?(\d{1,2})$/);
  return age ? `Dès ${age[1]} ans` : null;
}

/** « 3 mai 2017 » pour « 2017-05-03 » ; null pour ce qui n'est pas une date. */
export function frenchDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const date = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Disponibilité affichée sur la fiche : « 2 copies sur 3 en rayon », ou le prochain retour quand
 * tout est loué. `earliestReturnMs` est déjà lu par parseServerDate (UTC sans fuseau) ; NaN quand
 * on ne le connaît pas. `null` tant que le stock est inconnu. `timeZone` ne sert qu'aux tests.
 */
export function availabilityText(
  i: { stock: number; copiesLeft: number; earliestReturnMs: number; timeZone?: string } | null,
): string | null {
  if (!i) return null;
  if (i.copiesLeft > 0) return `${i.copiesLeft} copie${i.copiesLeft > 1 ? 's' : ''} sur ${i.stock} en rayon`;
  if (!Number.isFinite(i.earliestReturnMs)) return 'Toutes les copies sont louées';
  return `Toutes louées, prochain retour le ${formatUntil(i.earliestReturnMs, i.timeZone)}`;
}

// ===== Effets de dalle de 2007 =====
//
// Rusmir, 17/11/2026, sur quatre propositions pour « donner un effet plus réaliste à un écran LCD » :
// « je suis chaud pour les 4 » — allumage du rétroéclairage, fuites de lumière, rémanence et
// cadence de l'époque, angle de vue piloté par l'inclinaison du téléphone.

/** Cadence des animations d'une borne de 2007 (Flash, Director) : 25 images par seconde. */
export const KIOSK_FPS = 25;

/**
 * Positions successives d'un défilement de `from` à `to` en `durationMs`, une par image à
 * `fps` images par seconde, avec un ralenti en fin de course. La dernière est exactement `to`.
 * Un écran d'aujourd'hui défile de façon fluide (120 images par seconde sur le Pixel 9a) : c'est ce
 * qui trahit le plus la page web.
 */
export function steppedScroll(from: number, to: number, durationMs: number, fps: number = KIOSK_FPS): number[] {
  const frames = Math.max(1, Math.round((Math.max(0, durationMs) / 1000) * fps));
  return Array.from({ length: frames }, (_, i) => {
    if (i === frames - 1) return to;
    const t = (i + 1) / frames;
    return Math.round(from + (to - from) * (1 - (1 - t) ** 3));
  });
}

export type ViewingAngle = { washOut: number; darken: number; warm: number; cool: number; reflectX: number; reflectY: number };

/**
 * En deçà, tenir le téléphone ne change rien ; au-delà de ANGLE_FULL, l'effet est entier. En degrés.
 * 35° au départ ; 60° depuis le 17/11/2026 (Rusmir : « plus d'angle réaliste, le mouvement est trop
 * restreint ») : une TN change dès qu'on la penche et continue de changer bien au-delà de 30°.
 */
const ANGLE_DEAD = 4;
const ANGLE_FULL = 60;

/**
 * Ce que l'angle de vue fait à une dalle TN, d'après l'écart d'inclinaison du téléphone avec sa
 * position « de face » (degrés ; `dBeta` : avant/arrière, positif quand le haut vient vers soi ;
 * `dGamma` : de côté). Vue d'en dessus, l'image se délave ; vue d'en dessous, elle s'assombrit
 * (une TN y tend vers le négatif, qu'on ne peut pas simuler sans filtre) ; de côté, la teinte
 * glisse. Le reflet, lui, glisse sur la vitre. Chaque valeur va de 0 à 1 (de -1 à 1 pour le reflet).
 */
export function viewingAngle(dBeta: number, dGamma: number): ViewingAngle {
  if (!Number.isFinite(dBeta) || !Number.isFinite(dGamma)) return { washOut: 0, darken: 0, warm: 0, cool: 0, reflectX: 0, reflectY: 0 };
  const ramp = (deg: number) => {
    const a = Math.abs(deg);
    return a <= ANGLE_DEAD ? 0 : Math.min(1, (a - ANGLE_DEAD) / (ANGLE_FULL - ANGLE_DEAD));
  };
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const v = ramp(dBeta);
  const h = ramp(dGamma);
  return {
    washOut: dBeta > 0 ? v : 0,
    darken: dBeta < 0 ? v : 0,
    warm: dGamma > 0 ? h : 0,
    cool: dGamma < 0 ? h : 0,
    reflectX: clamp(dGamma / ANGLE_FULL) + 0,
    reflectY: clamp(dBeta / ANGLE_FULL) + 0,
  };
}

/**
 * La position « de face » suit lentement l'inclinaison réelle (constante de temps `tauMs`) : on
 * ne connaît pas la place de l'œil, mais on tient d'ordinaire le téléphone de face. Un geste
 * rapide se voit ; une façon durable de le tenir redevient « de face ».
 */
export function followBaseline(baseline: number, sample: number, dtMs: number, tauMs = 8000): number {
  if (!Number.isFinite(baseline)) return sample;
  return baseline + (sample - baseline) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
}
