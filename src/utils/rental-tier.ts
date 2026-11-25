// Palier tarifaire d'un film — LA règle, pour le serveur qui facture (lib/films.ts la délègue
// ici) comme pour la fiche du vidéoclub et la borne qui affichent le prix.
//
// Elle a existé en deux exemplaires qui ont divergé : le serveur facturait d'après le marquage
// « nouveauté » et le rayon Classiques, le client affichait d'après l'année de sortie. Un film
// de 2017 marqué nouveauté s'affichait à 1 crédit et en coûtait 2. Une seule fonction, donc.
//
// Imports de type uniquement : ce module est aussi chargé tel quel par Node dans les tests.
import type { RentalTier } from '../types';

/** Nouveauté signalée → `'nouveaute'` ; sinon rayon Classiques → `'classique'` ; sinon `'standard'`. */
export function getRentalTier(film: { is_nouveaute?: boolean | number | null; aisle?: string | null }): RentalTier {
  if (film.is_nouveaute) return 'nouveaute';
  if (film.aisle === 'classiques') return 'classique';
  return 'standard';
}
