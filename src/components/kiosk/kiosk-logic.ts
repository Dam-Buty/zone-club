// Logique pure de la borne de location : onglets, listes, tris, libellés, décision du bouton
// d'action, déroulé d'une location, validation du formulaire de connexion.
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

// ===== État du catalogue =====

export const CATALOG_WAIT_MS = 8000;

/** Jamais un écran vide : on charge, puis on dit que le catalogue est indisponible. */
export function catalogState(total: number, waitedMs: number): 'ready' | 'loading' | 'unavailable' {
  if (total > 0) return 'ready';
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

export function synopsisText(overview: string | null | undefined): string {
  const text = (overview ?? '').trim();
  return text || 'Synopsis indisponible.';
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
 * Déroulé d'une location. Le verrou rend le second appui sans effet tant que le premier n'a
 * pas répondu ; un échec du mode de visionnage n'annule pas une location déjà enregistrée.
 */
export async function rentFlow(
  deps: { rent: () => Promise<unknown>; setMode: () => Promise<unknown> },
  lock: { busy: boolean },
): Promise<{ status: 'ok' } | { status: 'busy' } | { status: 'error'; message: string }> {
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
    return { status: 'error', message: error instanceof Error ? error.message : 'Erreur inconnue' };
  } finally {
    lock.busy = false;
  }
}

// ===== Connexion =====

export type KioskAuthMode = 'login' | 'register' | 'recover';

/** Premier refus du formulaire, ou `null` s'il peut partir. */
export function authFormError(
  mode: KioskAuthMode,
  f: { username: string; password: string; confirm: string; phrase: string },
): string | null {
  if (!f.username.trim()) return 'Saisissez votre pseudo.';
  if (!f.password) return 'Saisissez votre mot de passe.';
  if (mode === 'recover' && !f.phrase.trim()) return 'Saisissez votre phrase de récupération.';
  if (mode !== 'login' && f.confirm !== f.password) return 'Les deux mots de passe ne sont pas identiques.';
  return null;
}
