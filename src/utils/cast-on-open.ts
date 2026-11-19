// Décisions du lecteur à l'ouverture d'un film, quand la TV entre en jeu : AirPlay ou Cast, et la
// proposition de rembobiner. Fonctions pures : aucun import de valeur, chargées telles quelles par Node
// dans les tests.

/**
 * Appareil Apple dont le navigateur sait faire AirPlay — c'est-à-dire Safari : la TV y passe par
 * AirPlay, pas par le Cast. Règle de « Regarder sur TV » (lecteur et borne) : agent Apple ET AirPlay
 * disponible, lu sur l'élément vidéo lui-même plutôt que sur un état posé par un effet du lecteur.
 */
export function appleAirPlay(userAgent: string, video: { webkitShowPlaybackTargetPicker?: unknown } | null): boolean {
  return /(iPad|iPhone|iPod|Macintosh)/.test(userAgent) && typeof video?.webkitShowPlaybackTargetPicker === 'function';
}

/**
 * À l'ouverture du lecteur : proposer tout de suite de rembobiner ? Oui pour un film vu jusqu'au bout
 * (100 %, posé par la fin de lecture ou par le serveur à la fin estimée d'un Cast) dont le rembobinage
 * n'a pas été réclamé — sauf si la TV joue encore ce film, le Cast reprend alors la main
 * (docs/superpowers/specs/2026-11-17-cast-suivi-serveur-design.md).
 */
export function shouldOfferRewindOnOpen(i: { watchProgress: number; rewindClaimed: boolean; castingThisFilm: boolean }): boolean {
  return i.watchProgress >= 100 && !i.rewindClaimed && !i.castingThisFilm;
}

/**
 * La décision à l'ouverture, à trois issues. `wait` tant que les données ne sont pas fraîches (la
 * réponse du serveur demandée à l'ouverture n'est pas arrivée : une page gardée en mémoire a une
 * progression périmée) ou qu'un Cast de ce film est en cours ou attendu (on décidera s'il abandonne) ;
 * sinon `offer` ou `skip`, d'après shouldOfferRewindOnOpen.
 */
export function rewindOfferOnOpen(i: { fresh: boolean; watchProgress: number; rewindClaimed: boolean; castingThisFilm: boolean }): 'offer' | 'skip' | 'wait' {
  if (!i.fresh || i.castingThisFilm) return 'wait';
  return shouldOfferRewindOnOpen(i) ? 'offer' : 'skip';
}
