// Géométrie de la devanture mobile : où poser l'image dans la fenêtre, et comment zoomer vers
// l'écran de la borne. Fonctions pures, sans aucun import de valeur : les tests `node --test` les
// chargent telles quelles.
//
// Les positions viennent de la fabrique des images (`tools/devanture-borne/fabrique.sh`), qui écrit
// `src/data/storefront-mobile.json` : tout y est en fractions de l'image (0 à 1, origine en haut à
// gauche), projeté par la caméra de la scène Blender.

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface StorefrontLayout {
  image: { w: number; h: number };
  /** La borne entière (son pied est sous le bord de l'image). */
  borne: Rect;
  /** L'écran de la borne, au format 5:9. */
  ecran: Rect;
  /** La porte, du haut de son cadre au bord de l'image. */
  porte: Rect;
  /** Milieu du bord haut de la plaque « PUSH ». */
  push: { x: number; y: number };
  /** Point sur lequel le cadrage se centre : le milieu de l'ensemble borne + porte. */
  groupe: { cx: number; cy: number };
  /** Zone couverte par la vue rapprochée (`/storefront-borne-zoom.webp`), et sa taille en pixels. */
  zoom: Rect & { w: number; h: number };
}

export interface Box { left: number; top: number; width: number; height: number }

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * La scène : l'image posée en « cover » dans la fenêtre, cadrée sur le groupe borne + porte.
 * Elle garde les proportions de l'image et ne laisse jamais de bord vide ; ce qui dépasse est
 * rogné autour du groupe plutôt qu'autour du centre de l'image.
 */
export function stageBox(layout: StorefrontLayout, vw: number, vh: number): Box {
  const { w, h } = layout.image;
  const width = Math.max(vw, (vh * w) / h);
  const height = (width * h) / w;
  return {
    left: clamp(vw - width, vw / 2 - layout.groupe.cx * width, 0),
    top: clamp(vh - height, vh / 2 - layout.groupe.cy * height, 0),
    width,
    height,
  };
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

/**
 * Transformation CSS de la scène (`transform-origin: 0 0`, soit `translate(x, y) scale(scale)`)
 * qui amène l'écran de la borne sur celui de l'interface (`kioskScreenBox`).
 */
export function zoomTransform(layout: StorefrontLayout, vw: number, vh: number): { scale: number; x: number; y: number } {
  const stage = stageBox(layout, vw, vh);
  const target = kioskScreenBox(vw, vh);
  const scale = target.width / ((layout.ecran.x1 - layout.ecran.x0) * stage.width);
  return {
    scale,
    x: target.left - stage.left - scale * layout.ecran.x0 * stage.width,
    y: target.top - stage.top - scale * layout.ecran.y0 * stage.height,
  };
}
