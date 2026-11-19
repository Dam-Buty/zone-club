// « Sur la TV » depuis la borne : le lecteur s'ouvre et lance aussitôt son propre parcours Cast
// (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 7). Fonction pure : aucun
// import de valeur, elle est chargée telle quelle par Node dans les tests.

/**
 * Le lecteur doit-il lancer le Cast maintenant ? Seulement s'il est ouvert, a sa location, sur le
 * film demandé — et pas sur un appareil Apple : la TV y passe par AirPlay, dont le sélecteur exige
 * un appui direct ; le lecteur s'ouvre alors normalement et son invite « Regarder sur TV » s'en charge.
 * @deprecated retiré à la tâche 6
 */
export function shouldStartCastOnOpen(i: {
  castOnOpen: number | null;
  currentPlayingFilm: number | null;
  isPlayerOpen: boolean;
  hasRental: boolean;
  isApple: boolean;
}): boolean {
  return i.isPlayerOpen && i.hasRental && !i.isApple && i.castOnOpen !== null && i.castOnOpen === i.currentPlayingFilm;
}

/**
 * Appareil Apple dont le navigateur sait faire AirPlay — c'est-à-dire Safari : la TV y passe par
 * AirPlay, pas par le Cast. Même règle que l'invite « Regarder sur TV » du lecteur (agent Apple ET
 * AirPlay disponible), mais lue sur l'élément vidéo lui-même : l'état « AirPlay disponible » du lecteur
 * est posé par un effet du commit d'ouverture, trop tard pour l'effet qui lance le Cast.
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
