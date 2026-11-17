// Logique pure de la borne de location : onglets, listes, tris, libellés, décision du bouton
// d'action, déroulé d'une location, geste retour, orientation. La validation des formulaires
// de compte est partagée avec le vidéoclub : src/utils/account-rules.ts.
//
// Imports de type uniquement : ce module est chargé tel quel par Node dans les tests
// (tests/domain/kiosk-logic.test.mjs), un import de valeur sans extension casserait.
import type { AisleType, Film } from '../../types';

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

export const KIOSK_TAB_PAGE_SIZE = 7;

/** Les onglets, par pages de sept (la colonne des rayons n'en montre qu'une à la fois). */
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

/**
 * Corps du titre sur la fiche : le plus grand qui tient dans ses 60,8cqw. Grand (6cqw) jusqu'à
 * 9,6 em, moyen (5cqw) jusqu'à 11,5 em — une ligne dans les deux cas, à moins de 59cqw —, petit
 * et sur deux lignes au-delà.
 */
export function titleScale(title: string): 'lg' | 'md' | 'sm' {
  const width = titleWidthEm(title);
  if (width <= 9.6) return 'lg';
  return width <= 11.5 ? 'md' : 'sm';
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

export type RentAction = 'login' | 'watch' | 'unavailable' | 'out-of-stock' | 'insufficient' | 'rent';

/** Ce que fait le bouton d'action de la fiche, par ordre de priorité. `copiesLeft` vaut `null` tant que le stock est inconnu. */
export function rentAction(i: {
  isAuthenticated: boolean;
  isRented: boolean;
  isAvailable: boolean;
  copiesLeft: number | null;
  credits: number;
  cost: number;
}): RentAction {
  if (i.isRented) return 'watch';
  if (!i.isAuthenticated) return 'login';
  if (!i.isAvailable) return 'unavailable';
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
  if (action === 'unavailable') return { text: 'Indisponible', price: null };
  if (action === 'out-of-stock') return { text: 'Toutes louées', price: null };
  return { text: 'Louer', price: creditsLabel(cost) };
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

export type KioskBackAction = 'none' | 'close-player' | 'close-notice' | 'cancel-auth' | 'close-search';

/**
 * Ce que fait le geste retour (ou le bouton retour du navigateur) dans la borne : il ferme ce
 * qui est ouvert au-dessus des rayons, du plus haut au plus bas. À la racine il ne fait rien —
 * on ne sort de la borne que par « quitter ». Ne se ferment pas d'un geste : la phrase de
 * récupération (elle ne se retrouve nulle part ailleurs) et un message sans fermeture
 * (« Catalogue indisponible », qui porte ses propres boutons).
 */
export function kioskBackAction(s: {
  playerOpen: boolean;
  noticeOpen: boolean;
  noticeClosable: boolean;
  authOpen: boolean;
  phrasePending: boolean;
  searchOpen: boolean;
}): KioskBackAction {
  if (s.playerOpen) return 'close-player';
  if (s.noticeOpen) return s.noticeClosable ? 'close-notice' : 'none';
  if (s.phrasePending) return 'none';
  if (s.authOpen) return 'cancel-auth';
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
