// « Sur la TV » depuis la borne : le lecteur s'ouvre et lance aussitôt son propre parcours Cast
// (docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 7). Fonction pure : aucun
// import de valeur, elle est chargée telle quelle par Node dans les tests.

/**
 * Le lecteur doit-il lancer le Cast maintenant ? Seulement s'il est ouvert, a sa location, sur le
 * film demandé — et pas sur un appareil Apple : la TV y passe par AirPlay, dont le sélecteur exige
 * un appui direct ; le lecteur s'ouvre alors normalement et son invite « Regarder sur TV » s'en charge.
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
