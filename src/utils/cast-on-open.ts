// Décisions du lecteur à l'ouverture d'un film, quand la TV entre en jeu : AirPlay ou Cast, la lecture
// automatique, la proposition de rembobiner. Fonctions pures : aucun import de valeur, chargées telles
// quelles par Node dans les tests.
import type { CastNotice, CastView } from '../cast/cast-machine';

/**
 * La vidéo d'ici a la main : la TV n'a pas ce film — repos, ou un AUTRE film sur la TV (ce n'est pas le même film
 * sur deux écrans : lecteur local normal, avec son bandeau). Ailleurs (attente, télécommande, liaison perdue, film
 * fini sur la TV) elle se tait.
 */
export function playsHere(view: CastView): boolean {
  return view === 'local' || view === 'other-on-tv';
}

/**
 * Le message du Cast pour ce film attend une réponse du visiteur avant que rien ne parte ici : le lancement vers la TV
 * vient d'échouer, ou le Cast manque à ce navigateur (panneau « recopie d'écran ») — réessayer, ou regarder ici, c'est
 * à lui de choisir. Un arrêt ou une erreur de la TV laissent déjà le lecteur en pause (reprise sans lecture).
 */
export function noticeHoldsPlayback(code: CastNotice): boolean {
  return code === 'connect_failed' || code === 'load_failed' || code === 'unavailable';
}

/**
 * La vidéo d'ici part-elle d'elle-même ? Seulement si elle a la main (`playsHere`) et que rien ne la retient : l'invite
 * « Regarder sur TV ? » (`prompt`), « BE KIND REWIND » ou son rembobinage (`rewind`), un message qui attend une réponse
 * (`castHeld`, voir noticeHoldsPlayback), la machine qui ne sait pas encore si la TV joue ce film (`pending` :
 * `castPending`, page rechargée), ou la question des sous-titres affichée (`question`, spec 2026-11-19, § 4.1). Jamais
 * de lecture lancée d'office, jamais le même film sur deux écrans.
 */
export function localAutoPlay(i: { view: CastView; prompt: boolean; rewind: boolean; castHeld: boolean; pending: boolean; question: boolean }): boolean {
  return playsHere(i.view) && !i.prompt && !i.rewind && !i.castHeld && !i.pending && !i.question;
}

/**
 * Une lecture qui part ici doit-elle être arrêtée aussitôt ? Oui quand la TV a ce film, le prend ou vient de le finir
 * (`tvOwnsFilm`), sous le panneau « Cette version ne se lance pas » (`failure` : failureHoldsPlayback) ou sous la question
 * des sous-titres (`question`). La lecture automatique est déjà désarmée là (localAutoPlay) ; ceci arrête ce qui partirait
 * quand même — une reprise du Cast, une touche média du matériel, un chargement tardif.
 */
export function playHeldHere(i: { tvOwnsFilm: boolean; failure: boolean; question: boolean }): boolean {
  return i.tvOwnsFilm || i.failure || i.question;
}

/** Durée pendant laquelle un appui suivant l'ouverture du lecteur est tenu pour son clic fantôme (voir ghostClick). */
export const GHOST_CLICK_MS = 500;

/**
 * Un appui reçu moins de GHOST_CLICK_MS après l'ouverture du lecteur est le clic fantôme du toucher qui l'a ouvert : le
 * menu de la télé assise ouvre le lecteur au `touchstart`, et le clic synthétisé arrive 50 à 100 ms plus tard, à la même
 * place — sur l'éjection, ou sur une réponse de la question des sous-titres et son « Retour », affichés dès l'ouverture.
 * Il est ignoré ; un vrai appui, plus tardif, passe.
 */
export function ghostClick(openedAt: number, now: number): boolean {
  return now - openedAt < GHOST_CLICK_MS;
}

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
