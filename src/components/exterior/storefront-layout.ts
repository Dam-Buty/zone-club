// Géométrie des devantures : où poser l'image dans la fenêtre (mobile : rognée autour de la borne et
// de la porte ; bureau : entière), et où amener l'écran de la borne à la fin du film d'approche.
// Fonctions pures, sans aucun import de valeur : les tests `node --test` les chargent telles quelles.
//
// Les positions viennent de la fabrique des images (`tools/devanture-borne/fabrique.sh`), qui écrit
// `src/data/storefront-mobile.json` et `src/data/storefront-desktop.json` : tout y est en fractions
// de l'image (0 à 1, origine en haut à gauche), projeté par la caméra de la scène Blender.

import type { Av1Version } from '../../utils/video-source';

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface StorefrontLayout {
  image: { w: number; h: number };
  /** La borne entière (son pied est sous le bord de l'image). */
  borne: Rect;
  /** L'écran de la borne (5:9 sur la devanture mobile, 2:3 sur celle du bureau). */
  ecran: Rect;
  /** La porte, du haut de son cadre au bord de l'image. */
  porte: Rect;
  /** Milieu du bord haut de la plaque « PUSH ». */
  push: { x: number; y: number };
  /** Point sur lequel le cadrage se centre : le milieu de l'ensemble borne + porte. */
  groupe: { cx: number; cy: number };
  /** Le film d'approche de la borne : son fichier, sa taille, sa durée (s), et où est l'écran de la
      borne dans sa DERNIÈRE image (fractions du cadre du film, qui a le format de l'image). */
  approche: {
    src: string; w: number; h: number; duree: number; images: number; octets: number; ecran: Rect;
    /** Le même film en AV1, plus léger, pour les navigateurs qui le lisent (src/utils/video-source.ts). */
    av1?: Av1Version;
    /** Mobile : le même film en haute définition (même trajet, même cadrage), pour les écrans qui en tirent parti. */
    hd?: { src: string; w: number; h: number; octets: number; av1?: Av1Version };
  };
}

export interface Box { left: number; top: number; width: number; height: number }

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * La scène : l'image posée en « cover » dans la fenêtre, cadrée sur le groupe borne + porte.
 * Elle garde les proportions de l'image et ne laisse jamais de bord vide ; ce qui dépasse est
 * rogné autour du groupe plutôt qu'autour du centre de l'image.
 *
 * `reserveBottom` : hauteur laissée en bas de la fenêtre à la barre des deux boutons. L'image
 * garde la taille qu'elle aurait sans la barre et REMONTE : sur un téléphone en portrait son bas
 * vient au ras de la barre et c'est le ciel, en haut, qui cède la place (Rusmir, 18/11/2026 :
 * « relever le tout, la visibilité du ciel est secondaire »).
 */
export function stageBox(layout: StorefrontLayout, vw: number, vh: number, reserveBottom = 0): Box {
  const { w, h } = layout.image;
  const areaHeight = vh - reserveBottom;
  const width = Math.max(vw, (vh * w) / h);
  const height = (width * h) / w;
  return {
    left: clamp(vw - width, vw / 2 - layout.groupe.cx * width, 0),
    top: clamp(areaHeight - height, areaHeight / 2 - layout.groupe.cy * height, 0),
    width,
    height,
  };
}

/**
 * Bureau : l'image entière dans la fenêtre, centrée, sans rognage — des bandes en haut et en bas
 * quand la fenêtre est plus haute que l'image, sur les côtés quand elle est plus large. C'est la
 * boîte où la scène animée dessine la devanture ; les zones cliquables s'y posent en pourcentages.
 */
export function fitBox(image: { w: number; h: number }, vw: number, vh: number): Box {
  const scale = Math.min(vw / image.w, vh / image.h);
  const width = image.w * scale;
  const height = image.h * scale;
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

export interface Span { left: number; width: number }

/**
 * Les deux boutons de la barre : chacun sous son objet et à sa largeur (la borne, la porte),
 * ramené dans la fenêtre s'il en sort. Ils ne s'étalent plus sur la moitié de la fenêtre : sur un
 * petit écran, où l'image entière tient en largeur, ils gardent la proportion qu'ils ont sur un
 * grand.
 */
export function choiceSpans(layout: StorefrontLayout, stage: Box, vw: number, margin = 6): { borne: Span; porte: Span } {
  const span = (zone: Rect): Span => {
    const left = Math.max(margin, stage.left + zone.x0 * stage.width);
    const right = Math.min(vw - margin, stage.left + zone.x1 * stage.width);
    return { left, width: right - left };
  };
  return { borne: span(layout.borne), porte: span(layout.porte) };
}

// Constantes de KioskView.module.css (téléphone). Un test vérifie que la feuille les porte encore.
const KIOSK_SCREEN_RATIO = 5 / 9;
const KIOSK_SIDE_MARGIN = 12; // « 100vw - 12px » : un cadre de 6 px de chaque côté
const KIOSK_RESERVE_TALL = 84; // --kiosk-reserve : enseigne 50, écart 10, marges 2 × 6, cadre 2 × 6
const KIOSK_RESERVE_SHORT = 26; // sous « max-height: 760px », l'enseigne s'efface
const KIOSK_SHORT_MAX_HEIGHT = 760;
const KIOSK_TOP_TALL = 72; // marge 6 + enseigne 50 + écart 10 + cadre 6
const KIOSK_TOP_SHORT = 12; // marge 6 + cadre 6

/**
 * Où sera l'écran de KioskView (formule de KioskView.module.css, téléphone).
 * La largeur est celle de `--ks-w` ; l'écran est centré en largeur. En hauteur, il suit la pile de
 * `.root` : marge, enseigne (fenêtres hautes), écart, cadre. Les encoches (`safe-area-inset-top`)
 * ne sont pas connues ici : l'écart éventuel de quelques pixels est couvert par le fondu final.
 */
export function kioskScreenBox(vw: number, vh: number): Box {
  const short = vh <= KIOSK_SHORT_MAX_HEIGHT;
  const reserve = short ? KIOSK_RESERVE_SHORT : KIOSK_RESERVE_TALL;
  const width = Math.min(vw - KIOSK_SIDE_MARGIN, (vh - reserve) * KIOSK_SCREEN_RATIO);
  return {
    left: (vw - width) / 2,
    top: short ? KIOSK_TOP_SHORT : KIOSK_TOP_TALL,
    width,
    height: width / KIOSK_SCREEN_RATIO,
  };
}

// Constantes de KioskView.module.css (bureau : « min-width: 769px » et pointeur fin). Un test vérifie
// que la feuille les porte encore ; les positions ont été mesurées à l'écran le 18/11/2026.
const KIOSK_DESKTOP_HEIGHT = 0.94; // « min(94dvh, 1100px) »
const KIOSK_DESKTOP_MAX_HEIGHT = 1100;
const KIOSK_DESKTOP_RATIO = 2 / 3;
const KIOSK_DESKTOP_VITRINE = 0.62; // la vitrine à gauche de l'écran : 0,62 × la largeur de l'écran
const KIOSK_DESKTOP_LEFT = 62; // bordure 3 + marge 26 + écart 20 + cadre 13
const KIOSK_DESKTOP_AROUND = 104; // tout ce qui entoure vitrine et écran : 2 × (3 + 26) + 20 + 2 × 13
// « margin-left » du corps sur les fenêtres plus larges que le décor : il le centre dans la fenêtre (un test vérifie que
// ce coefficient suit la boîte de l'écran dans le décor, src/data/kiosk-distribution.json).
const KIOSK_DESKTOP_DECOR_SHIFT = 1.3301;

/**
 * Où sera l'écran de KioskView sur un bureau. Le corps de la borne est collé à GAUCHE de la
 * fenêtre — décalé, sur une fenêtre plus large que le décor, de ce qu'il faut pour centrer le décor : sa vitrine, puis l'écran (2:3, haut de 94 % de la fenêtre, 1100 px au plus), centré en
 * hauteur. Sur une fenêtre étroite la vitrine cède de la place avant l'écran.
 */
export function kioskScreenBoxDesktop(vw: number, vh: number): Box {
  const height = Math.min(KIOSK_DESKTOP_HEIGHT * vh, KIOSK_DESKTOP_MAX_HEIGHT);
  const width = height * KIOSK_DESKTOP_RATIO;
  const vitrine = clamp(0, vw - width - KIOSK_DESKTOP_AROUND, KIOSK_DESKTOP_VITRINE * width);
  const shift = Math.max(0, vw / 2 - width * KIOSK_DESKTOP_DECOR_SHIFT - KIOSK_DESKTOP_LEFT);
  return { left: vitrine + KIOSK_DESKTOP_LEFT + shift, top: (vh - height) / 2, width, height };
}

// Au-delà de cette marge, le film léger serait trop agrandi : on prend la haute définition.
const HD_FILM_MARGIN = 1.15;

/**
 * Le film d'approche à charger : la haute définition quand la scène, en points d'écran réels
 * (`stageWidth` en points logiques × `pixelRatio`), dépasse nettement la largeur du film léger ;
 * le film léger sinon, et toujours quand le visiteur a demandé d'économiser ses données (Rusmir,
 * 18/11/2026 : garder le film léger pour les téléphones de faible définition).
 */
export function pickApproachFilm(
  approche: StorefrontLayout['approche'],
  stageWidth: number,
  pixelRatio: number,
  saveData = false,
): { src: string; w: number; h: number; av1?: Av1Version } {
  const { hd } = approche;
  if (hd && !saveData && stageWidth * pixelRatio > approche.w * HD_FILM_MARGIN) return hd;
  return approche;
}

/**
 * Le plus grand rectangle de proportions `ratio` (largeur / hauteur) logé dans `box`, centré. Sert
 * quand l'écran filmé n'a pas le format de l'écran de l'interface (film du mobile, 5:9, sur un
 * bureau retombé sur l'image fixe, dont l'interface est en 2:3).
 */
export function fitInside(box: Box, ratio: number): Box {
  const width = Math.min(box.width, box.height * ratio);
  const height = width / ratio;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * Transformation CSS de la scène (`transform-origin: 0 0`, soit `translate(x, y) scale(scale)`)
 * qui amène un rectangle de la scène — l'écran de la borne dans la dernière image du film — sur
 * `target`, l'écran de l'interface. Le film fait lui-même l'approche : il ne reste ici qu'un petit
 * ajustement, d'une fenêtre à l'autre.
 */
export function approachTransform(stage: Box, ecran: Rect, target: Box): { scale: number; x: number; y: number } {
  const scale = target.width / ((ecran.x1 - ecran.x0) * stage.width);
  return {
    scale,
    x: target.left - stage.left - scale * ecran.x0 * stage.width,
    y: target.top - stage.top - scale * ecran.y0 * stage.height,
  };
}
