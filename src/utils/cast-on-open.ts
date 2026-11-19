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

/**
 * Le lecteur est ouvert sur un film que plus rien ne permet de regarder ici — ni location réelle, ni prévisualisation
 * (`hasRental` : ce que sert `getRental`) — une fois ses données relues depuis l'ouverture (`fresh`) : il doit se
 * fermer. Il ne dessine rien sans location mais reste « ouvert » : la borne inerte dessous, le vidéoclub en pause, un
 * écran sans sortie visible (relecture finale de la refonte du Cast, A3). Avant la relecture, un magasin périmé n'est
 * pas une location disparue.
 */
export function playerWithoutRental(i: { open: boolean; hasRental: boolean; fresh: boolean }): boolean {
  return i.open && !i.hasRental && i.fresh;
}

/**
 * La proposition « BE KIND REWIND » que le lecteur montre maintenant, décidée à un seul endroit. Deux décisions
 * séparées se contredisaient : à la fin vue par la TV, la location déjà à 100 % faisait aussi proposer « l'ouverture »,
 * dont NON MERCI remplaçait ÉJECTER, et la question revenait une seconde fois.
 * `tv` : la TV vient de finir ce film (`ended`), l'a ou le prend (`busy`), ou n'y est pour rien (`free`).
 * `offered` : la proposition de l'ouverture a déjà été tranchée pour ce film.
 * - `eject` : fin vue par la TV, à rembobiner — ÉJECTER ;
 * - `close` : fin vue par la TV, rembobinage déjà réclamé — le lecteur se ferme ;
 * - `offer` : film fini ailleurs, à l'ouverture — NON MERCI laisse le revoir ;
 * - `wait` : rien encore (données pas relues, ou la TV a le film) ; `skip` : rien pour cette ouverture.
 */
export function rewindPromptFor(i: {
  tv: 'ended' | 'busy' | 'free';
  offered: boolean;
  fresh: boolean;
  watchProgress: number;
  rewindClaimed: boolean;
}): 'eject' | 'close' | 'offer' | 'wait' | 'skip' {
  if (i.tv === 'ended') return i.rewindClaimed ? 'close' : 'eject';
  if (i.offered) return 'skip';
  return rewindOfferOnOpen({ fresh: i.fresh, watchProgress: i.watchProgress, rewindClaimed: i.rewindClaimed, castingThisFilm: i.tv === 'busy' });
}
