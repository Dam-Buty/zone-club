// Borne 24/7 — la distribution filmée de la K7 : logique pure, testée par
// tests/domain/kiosk-distribution-logic.test.mjs. Aucun import de valeur.
//
// Conception : docs/superpowers/specs/2026-11-17-borne-distribution-k7-design.md, § 13. Une seule vidéo sert à tous
// les films : la K7 y a une tranche neutre, et la page pose par-dessus, à CHAQUE image, la tranche du film loué —
// découpée par le cache de l'image (ce qui passe devant la K7) et assombrie par son ombre (la lumière de la scène).
// L'écran de la borne, lui, n'est pas filmé : c'est le vrai écran, mis à l'échelle dans la boîte de l'écran filmé.

/** Boîte en fractions de l'image de la vidéo : [x0, y0, x1, y1], origine en haut à gauche. */
export type Box = [number, number, number, number];

/** Ce que la page doit savoir d'une image de la vidéo. */
export type SuiviPas = {
  /** La tranche de la K7 ; `null` quand elle est hors champ. */
  t: Box | null;
  /** 1 : la K7 est couchée (elle sort par la fente) ; 0 : debout (vitrine). */
  c: 0 | 1;
  /** L'écran de la borne. */
  e: Box;
};

/** Un bloc de cellules d'une planche : les images `de` à `a`, rangées par lignes de `colonnes` cellules. */
export type SuiviBloc = { cellule: [number, number]; colonnes: number; de: number; a: number };

/** La forme de `public/kiosk-distribution-suivi.json`, écrit par `tools/devanture-borne/distribution_planches.py`. */
export type Suivi = {
  images: number;
  ips: number;
  /** Taille des deux planches (caches, ombres) ; le bloc « couchée » est sous le bloc « debout ». */
  planche: [number, number];
  debout: SuiviBloc;
  couchee: SuiviBloc;
  pas: SuiviPas[];
};

/** La forme de `film` dans `src/data/kiosk-distribution.json` (`distribution_sorties.py`). */
export type DistributionFilm = { src: string; largeur: number; hauteur: number; dureeMs: number; octets: number };

/**
 * Une distribution filmée et ce qui l'accompagne. Deux variantes (`distribution_sorties.py`) : celle du téléphone
 * (écran 5:9, borne seule) et celle du PC (écran 2:3, la borne dans la rue), qui a en plus son DÉCOR — la première
 * image du film, en haute définition, que la page garde derrière l'écran de la borne.
 */
export type DistributionVariant = {
  film: DistributionFilm;
  suivi: string;
  caches: string;
  ombres: string;
  decor?: { src: string; largeur: number; hauteur: number; ecran: Box };
};

export type WearLevel = 1 | 2 | 3;

/** Un rectangle à l'écran, en points CSS (ce que rend `getBoundingClientRect`). */
export type Rect = { left: number; top: number; width: number; height: number };

/**
 * Niveau d'usure de l'étui selon l'âge du film (Rusmir, 22/11/2026) : avant 1985 = ancien (3), de 1985 à 2004 = moyen
 * (2), 2005 et après = récent (1). Mêmes seuils que `niveau_du_film` de la fabrique. Sans année : moyen.
 */
export function wearLevel(year: number | null | undefined): WearLevel {
  if (year == null || !Number.isFinite(year)) return 2;
  return year < 1985 ? 3 : year < 2005 ? 2 : 1;
}

/** L'année d'un film d'après sa date de sortie (« 1986-08-15 ») ; `null` si elle manque. */
export function yearOf(releaseDate: string | null | undefined): number | null {
  const year = Number.parseInt((releaseDate ?? '').slice(0, 4), 10);
  return Number.isFinite(year) && year > 1800 ? year : null;
}

/**
 * La tranche préparée d'un film : debout, usée au niveau de son année. Deux images, une par régime de lumière — dans
 * la vitrine, et couchée à la fente (teinte et force de la lumière cuites ; l'ombre de chaque image fait le reste).
 */
export function spineSrc(tmdbId: number, couchee: boolean): string {
  return `/kiosk-tranches/${tmdbId}${couchee ? '-c' : ''}.webp`;
}

/** Repli d'un film sans tranche préparée : la tranche neutre usée, sur laquelle la page écrit le titre. */
export function fallbackSpineSrc(level: WearLevel, couchee: boolean): string {
  return `/kiosk-tranches/repli-${level}${couchee ? '-c' : ''}.webp`;
}

/** L'image du film que la vidéo présente à cet instant (son `mediaTime`), bornée au film. */
export function frameAt(mediaTimeS: number, suivi: Pick<Suivi, 'images' | 'ips'>): number {
  return Math.min(suivi.images - 1, Math.max(0, Math.round(mediaTimeS * suivi.ips)));
}

/** Position CSS d'une boîte, en pourcentages du cadre de la vidéo. */
export function boxStyle(box: Box): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${v * 100}%`;
  return { left: pct(box[0]), top: pct(box[1]), width: pct(box[2] - box[0]), height: pct(box[3] - box[1]) };
}

/**
 * Place du décor (PC), en pourcentages de la boîte du VRAI écran de la borne : l'écran filmé du décor (`ecran`, en
 * fractions du décor) tombe alors exactement sur lui, quelle que soit la taille de la fenêtre.
 */
export function decorStyle(ecran: Box): { left: string; top: string; width: string; height: string } {
  const w = ecran[2] - ecran[0];
  const h = ecran[3] - ecran[1];
  const pct = (v: number) => `${v * 100}%`;
  return { left: pct(-ecran[0] / w), top: pct(-ecran[1] / h), width: pct(1 / w), height: pct(1 / h) };
}

/**
 * Où est la cellule de l'image `i` dans une planche, pour un calque qui a la taille d'une cellule : valeurs de
 * `mask-size` / `mask-position` (cache) et de `background-size` / `background-position` (ombre).
 */
export function sheetPosition(i: number, couchee: 0 | 1, suivi: Pick<Suivi, 'planche' | 'debout' | 'couchee'>): { size: string; position: string } {
  const bloc = couchee ? suivi.couchee : suivi.debout;
  const [w, h] = bloc.cellule;
  const [W, H] = suivi.planche;
  const k = Math.min(bloc.a, Math.max(bloc.de, i)) - bloc.de;
  const lignesDebout = Math.ceil((suivi.debout.a - suivi.debout.de + 1) / suivi.debout.colonnes);
  const x = (k % bloc.colonnes) * w;
  const y = (couchee ? lignesDebout * suivi.debout.cellule[1] : 0) + Math.floor(k / bloc.colonnes) * h;
  const part = (v: number, total: number, cellule: number) => (total > cellule ? (v / (total - cellule)) * 100 : 0);
  return { size: `${(W / w) * 100}% ${(H / h) * 100}%`, position: `${part(x, W, w)}% ${part(y, H, h)}%` };
}

/**
 * Le cadre de la vidéo, placé pour que l'écran filmé de la première image tombe exactement sur le vrai écran de la
 * borne : le raccord du début (et de la fin, la vidéo revenant au même cadrage) est exact par construction.
 */
export function stageRect(ecran0: Box, ecranBorne: Rect, ratio: number): Rect {
  const width = ecranBorne.width / (ecran0[2] - ecran0[0]);
  const height = width / ratio;
  return { left: ecranBorne.left - ecran0[0] * width, top: ecranBorne.top - ecran0[1] * height, width, height };
}

/**
 * Le cadre de la vidéo pour cette borne. Quand son écran a les proportions de l'écran filmé (téléphone, 5:9), c'est
 * `stageRect` : raccord exact. Sinon (PC : écran 2:3) aucun cadre ne peut à la fois tenir dans la fenêtre et faire
 * coïncider les deux écrans : le cadre tient alors EN ENTIER dans la fenêtre, centré sur l'écran de la borne, et le
 * vrai écran y est placé sans déformation (`screenTransform(…, false)`).
 */
export function stageFor(ecran0: Box, ecranBorne: Rect, ratio: number, fenetre: { width: number; height: number }): { cadre: Rect; exact: boolean } {
  const filme = ((ecran0[2] - ecran0[0]) * ratio) / (ecran0[3] - ecran0[1]);
  const reel = ecranBorne.width / ecranBorne.height;
  if (Math.abs(reel - filme) / filme < 0.02) return { cadre: stageRect(ecran0, ecranBorne, ratio), exact: true };
  const height = Math.min(fenetre.height, fenetre.width / ratio);
  const width = height * ratio;
  const left = Math.min(Math.max(0, ecranBorne.left + ecranBorne.width / 2 - width / 2), fenetre.width - width);
  return { cadre: { left, top: (fenetre.height - height) / 2, width, height }, exact: false };
}

/**
 * Ce qu'il faut faire subir au vrai écran de la borne (origine en haut à gauche) pour qu'il occupe la boîte de l'écran
 * filmé. `ecranBorne` est sa place AVANT toute transformation. `exact` faux (écran d'autres proportions que l'écran
 * filmé) : il garde ses proportions, au plus grand qui tient dans la boîte, centré.
 */
export function screenTransform(ecranFilme: Box, cadre: Rect, ecranBorne: Rect, exact = true): { tx: number; ty: number; sx: number; sy: number } {
  if (!exact) {
    const w = (ecranFilme[2] - ecranFilme[0]) * cadre.width;
    const h = (ecranFilme[3] - ecranFilme[1]) * cadre.height;
    const s = Math.min(w / ecranBorne.width, h / ecranBorne.height);
    return {
      tx: cadre.left + ecranFilme[0] * cadre.width + (w - ecranBorne.width * s) / 2 - ecranBorne.left,
      ty: cadre.top + ecranFilme[1] * cadre.height + (h - ecranBorne.height * s) / 2 - ecranBorne.top,
      sx: s,
      sy: s,
    };
  }
  return {
    tx: cadre.left + ecranFilme[0] * cadre.width - ecranBorne.left,
    ty: cadre.top + ecranFilme[1] * cadre.height - ecranBorne.top,
    sx: ((ecranFilme[2] - ecranFilme[0]) * cadre.width) / ecranBorne.width,
    sy: ((ecranFilme[3] - ecranFilme[1]) * cadre.height) / ecranBorne.height,
  };
}

/**
 * Le vrai écran ne doit pas dépasser du cadre de la vidéo (pendant le rapproché sur la fente, l'écran filmé sort par
 * le haut) : la part à rogner, en points de l'écran NON transformé, pour `clip-path`.
 */
export function screenClip(t: { tx: number; ty: number; sx: number; sy: number }, cadre: Rect, ecranBorne: Rect): string {
  const left = ecranBorne.left + t.tx;
  const top = ecranBorne.top + t.ty;
  const cut = (v: number, scale: number) => `${Math.max(0, v) / scale}px`;
  return `inset(${cut(cadre.top - top, t.sy)} ${cut(left + ecranBorne.width * t.sx - (cadre.left + cadre.width), t.sx)} ${cut(
    top + ecranBorne.height * t.sy - (cadre.top + cadre.height),
    t.sy,
  )} ${cut(cadre.left - left, t.sx)})`;
}

export function transformCss(t: { tx: number; ty: number; sx: number; sy: number }): string {
  return `translate(${t.tx}px, ${t.ty}px) scale(${t.sx}, ${t.sy})`;
}
