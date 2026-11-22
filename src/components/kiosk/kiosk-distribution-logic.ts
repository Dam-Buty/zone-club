// Borne 24/7 — la distribution filmée de la K7 (livraison 2) : logique pure, testée par
// tests/domain/kiosk-distribution-logic.test.mjs. Aucun import de valeur.
//
// Conception : docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 12. Une seule vidéo sert à tous
// les films : la K7 y a une tranche neutre, et la page pose par-dessus, pendant l'arrêt sur la fente, la tranche du
// film loué (une image préparée par la fabrique) et le texte de l'afficheur.

/** Boîte en fractions de l'image de la vidéo (0 à 1, origine en haut à gauche). */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** L'arrêt sur la fente : la K7 est immobile et l'appareil fixe entre `debutS` et `finS`. */
export type Arret = { debutS: number; finS: number; tranche: Box; afficheur: Box };

/** La forme de `src/data/kiosk-distribution.json`, écrit par `tools/devanture-borne/distribution_sorties.py`. */
export type DistributionFilm = { src: string; largeur: number; hauteur: number; dureeMs: number; octets: number };

export type WearLevel = 1 | 2 | 3;

/**
 * Niveau d'usure de l'étui selon l'âge du film (Rusmir, 22/11/2026) : avant 1985 = ancien (3), de 1985 à 2004 = moyen
 * (2), 2005 et après = récent (1). Mêmes seuils que `niveau_du_film` de la fabrique. Sans année : moyen.
 */
export function wearLevel(year: number | null | undefined): WearLevel {
  if (year == null || !Number.isFinite(year)) return 2;
  return year < 1985 ? 3 : year < 2005 ? 2 : 1;
}

/** La tranche préparée d'un film (usure de son année et éclairage de la fente déjà cuits). */
export function spineSrc(tmdbId: number): string {
  return `/kiosk-tranches/${tmdbId}.webp`;
}

/** Repli d'un film sans tranche préparée : la tranche neutre éclairée, sur laquelle la page écrit le titre. */
export function fallbackSpineSrc(level: WearLevel): string {
  return `/kiosk-tranches/repli-${level}.webp`;
}

/** L'usure seule (papier à nu sur fond transparent), posée par-dessus le titre du repli. */
export function fallbackWearSrc(level: WearLevel): string {
  return `/kiosk-tranches/usure-${level}.webp`;
}

/** Les calques de la page ne se montrent que pendant l'arrêt : avant et après, l'appareil bouge. */
export function overlayVisible(tMs: number, arret: Pick<Arret, 'debutS' | 'finS'>): boolean {
  return tMs >= arret.debutS * 1000 && tMs < arret.finS * 1000;
}

const DISPLAY_COLUMNS = 20;

/** Les deux lignes de l'afficheur pendant la sortie de la K7 : 20 caractères chacune, le titre coupé s'il dépasse. */
export function displayLines(title: string): [string, string] {
  const t = title.toUpperCase();
  return ['RETIREZ VOTRE K7', t.length > DISPLAY_COLUMNS ? `${t.slice(0, DISPLAY_COLUMNS - 1)}…` : t];
}

/** Position CSS d'une boîte, en pourcentages du cadre de la vidéo. */
export function boxStyle(box: Box): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${v * 100}%`;
  return { left: pct(box.x0), top: pct(box.y0), width: pct(box.x1 - box.x0), height: pct(box.y1 - box.y0) };
}
