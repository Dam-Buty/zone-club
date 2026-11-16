// Palier tarifaire d'un film, partagé par la fiche du vidéoclub et par la borne.
// Imports de type uniquement : ce module est aussi chargé tel quel par Node dans les tests.
import type { Film, RentalTier } from '../types';

/** 1 an ou moins → nouveauté ; 20 ans ou plus → classique ; sinon standard. */
export function getRentalTier(film: Pick<Film, 'release_date'>, now: Date = new Date()): RentalTier {
  const year = new Date(film.release_date).getFullYear();
  const currentYear = now.getFullYear();
  if (currentYear - year <= 1) return 'nouveaute';
  if (currentYear - year >= 20) return 'classique';
  return 'standard';
}
