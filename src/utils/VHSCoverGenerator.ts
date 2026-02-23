import * as THREE from "three";
import type { Film } from "../types";
import { tmdb, type TMDBImage } from "../services/tmdb";
import { preloadPosterImage } from "./CassetteTextureArray";

// ---- Canvas & UV Layout Constants ----
const TEX_SIZE = 1024;
const RENDER_SCALE = 1.5; // 1.5x resolution: 1536px — balance between sharpness and CPU/GPU cost

// ---- Reusable canvases (separate responsibilities to avoid draw-state corruption) ----
const _blitCanvas = document.createElement("canvas");
const _blitCtx = _blitCanvas.getContext("2d")!;
const _logoSampleCanvas = document.createElement("canvas");
const _logoSampleCtx = _logoSampleCanvas.getContext("2d", {
  willReadFrequently: true,
})!;

// ---- Caches for logo analysis (avoids repeated GPU→CPU readbacks) ----
const _logoBrightnessCache = new Map<string, boolean>();
const _logoMonochromeCache = new Map<string, boolean>();
const _invertedLogoCache = new Map<string, HTMLCanvasElement>();

// ---- VHS Cover caches (avoid re-fetching TMDB data + re-rendering canvas) ----
const VHS_DATA_CACHE = new Map<number, VHSCoverData>();
const VHS_TEXTURE_CACHE = new Map<number, THREE.CanvasTexture>();
const VHS_TEXTURE_LRU: number[] = []; // oldest first
const VHS_TEXTURE_MAX = 24; // ~216MB VRAM max (24 × 9MB per 1536² RGBA)

// Face regions in canvas pixel coordinates { x, y, w, h }
const FRONT = { x: 614, y: 117, w: 395, h: 712 };
const BACK = { x: 117, y: 117, w: 395, h: 712 };
const SPINE1 = { x: 15, y: 117, w: 102, h: 712 };
const SPINE2 = { x: 512, y: 117, w: 102, h: 712 };
const TOP_EDGE = { x: 117, y: 15, w: 395, h: 102 };
const BOTTOM_EDGE = { x: 117, y: 829, w: 395, h: 102 };

// Notch safe zone — top center of front face where tape is visible through jacket cutout
// Content drawn here is hidden by the physical notch, so skip important elements
const NOTCH_BOTTOM = 24; // matches NOTCH_RADIUS_Y
// Notch semi-ellipse dimensions (tape-grab cutout in paper jacket)
// Sized to match the physical cutout visible on the GLB model
const NOTCH_RADIUS_X = 36; // horizontal radius — matches model's semi-circle width
const NOTCH_RADIUS_Y = 24; // vertical radius — matches model's semi-circle depth

// ---- Studio name → canonical TMDB company ID (for entries without logo_path) ----
const STUDIO_ALIASES: Record<string, number> = {
  "20th century fox": 25,
  "twentieth century fox": 25,
  "twentieth century-fox productions": 25,
  "twentieth century fox film corporation": 25,
  "20th century studios": 25,
  "warner bros.": 174,
  "warner bros": 174,
  "warner bros. pictures": 174,
  "warner bros. entertainment": 174,
  "universal pictures": 33,
  "universal studios": 33,
  "paramount pictures": 4,
  paramount: 4,
  "columbia pictures": 5,
  "columbia pictures corporation": 5,
  "columbia pictures industries": 5,
  "walt disney pictures": 2,
  disney: 2,
  "metro-goldwyn-mayer": 8411,
  mgm: 8411,
  "metro goldwyn mayer": 8411,
  "new line cinema": 12,
  lionsgate: 1632,
  "lionsgate films": 1632,
  miramax: 14,
  "miramax films": 14,
  dreamworks: 7,
  "dreamworks pictures": 7,
  "dreamworks animation": 521,
  "touchstone pictures": 9195,
  "tristar pictures": 559,
  "tri-star pictures": 559,
  "orion pictures": 41,
  "united artists": 60,
  "amblin entertainment": 56,
  "legendary pictures": 923,
  "legendary entertainment": 923,
  lucasfilm: 1,
  "lucasfilm ltd.": 1,
  pixar: 3,
  "pixar animation studios": 3,
  "marvel studios": 420,
  "marvel enterprises": 420,
  "dc films": 128064,
  "dc entertainment": 128064,
  a24: 41077,
  "blumhouse productions": 3172,
  "focus features": 10146,
  "fox searchlight pictures": 43,
  "fox searchlight": 43,
  "canal+": 104,
  gaumont: 9,
  pathé: 130,
  studiocanal: 694,
  europacorp: 6896,
  // --- Streaming / Modern ---
  netflix: 178464,
  "amazon studios": 20580,
  "amazon mgm studios": 20580,
  "apple studios": 194232,
  "apple tv+": 194232,
  "apple original films": 194232,
  hulu: 140361,
  neon: 90733,
  // --- Production companies ---
  "sony pictures": 34,
  "sony pictures entertainment": 34,
  "sony pictures animation": 34,
  "annapurna pictures": 13184,
  annapurna: 13184,
  "regency enterprises": 508,
  "new regency pictures": 508,
  "new regency": 508,
  "plan b entertainment": 82819,
  "plan b": 82819,
  participant: 10163,
  "participant media": 10163,
  "studio ghibli": 10342,
  "film4": 6705,
  "film4 productions": 6705,
  "filmfour": 6705,
  "bbc films": 288,
  "bbc film": 288,
  "relativity media": 7295,
  "eone films": 8147,
  "entertainment one": 8147,
  "filmnation entertainment": 7493,
  filmnation: 7493,
  "tsg entertainment": 22213,
  "skydance media": 82819,
  skydance: 82819,
  "original film": 333,
  "spyglass media group": 143790,
  "spyglass entertainment": 143790,
  "bron studios": 13240,
  "bron creative": 13240,
  "constantin film": 47,
  "monkeypaw productions": 88934,
};

// ---- Local color studio logos (TMDB company ID → local file) ----
// These IDs have logos in public/studio-logos/{id}.png
const LOCAL_STUDIO_LOGOS = new Set([
  // --- Majors ---
  25, // 20th Century Studios (color)
  174, // Warner Bros. (color)
  33, // Universal Pictures (color)
  4, // Paramount Pictures (B&W)
  5, // Columbia Pictures (B&W)
  2, // Walt Disney Pictures (B&W)
  8411, // MGM (color)
  34, // Sony Pictures (color)
  // --- Mini-majors ---
  12, // New Line Cinema (B&W)
  1632, // Lionsgate (B&W)
  14, // Miramax (B&W)
  7, // DreamWorks (color)
  521, // DreamWorks Animation (color)
  9195, // Touchstone Pictures (color)
  559, // TriStar Pictures (B&W)
  41, // Orion Pictures (B&W)
  60, // United Artists (B&W)
  56, // Amblin Entertainment (color)
  923, // Legendary Pictures (B&W)
  // --- Franchise / Genre ---
  1, // Lucasfilm (B&W)
  3, // Pixar (B&W)
  420, // Marvel Studios (color)
  128064, // DC Studios (color)
  41077, // A24 (B&W)
  3172, // Blumhouse Productions (B&W)
  // --- Distributors ---
  10146, // Focus Features (B&W)
  43, // Searchlight Pictures (color)
  104, // Canal+ (B&W)
  9, // Gaumont (color)
  130, // Pathé (color)
  694, // StudioCanal (B&W)
  6896, // EuropaCorp (B&W)
  // --- Streaming / Modern ---
  178464, // Netflix (color — red)
  20580, // Amazon Studios (B&W)
  194232, // Apple Studios (B&W)
  140361, // Hulu (color — green)
  90733, // Neon (B&W)
  13184, // Annapurna Pictures (B&W)
  // --- Production companies ---
  508, // Regency Enterprises (B&W)
  333, // Original Film (B&W)
  82819, // Skydance (B&W)
  10163, // Participant (B&W)
  10342, // Studio Ghibli (B&W)
  6705, // FilmFour (B&W)
  288, // BBC Films (B&W)
  7295, // Relativity Media (B&W)
  8147, // eOne Films (B&W)
  7493, // FilmNation Entertainment (B&W)
  22213, // TSG Entertainment (B&W)
  143790, // Spyglass Media (B&W)
  13240, // BRON Studios (B&W)
  47, // Constantin Film (B&W)
  88934, // Monkeypaw Productions (B&W)
  429, // Babelsberg Film (color)
]);

/** Get the best logo URL for a production company: local color → TMDB → company endpoint */
async function resolveStudioLogoUrl(company: {
  id: number;
  name: string;
  logo_path: string | null;
}): Promise<string | null> {
  // 1. Always resolve canonical ID via alias
  const aliasId = STUDIO_ALIASES[company.name.toLowerCase()];
  const canonicalId = aliasId || company.id;

  // 2. Local color logo ALWAYS takes priority over TMDB monochrome
  if (LOCAL_STUDIO_LOGOS.has(canonicalId)) {
    return `/studio-logos/${canonicalId}.png`;
  }
  if (LOCAL_STUDIO_LOGOS.has(company.id)) {
    return `/studio-logos/${company.id}.png`;
  }

  // 3. TMDB logo_path from movie endpoint
  if (company.logo_path) {
    return `https://image.tmdb.org/t/p/w500${company.logo_path}`;
  }

  // 4. Fallback: fetch from /company/{id}
  return tmdb.getCompanyLogo(canonicalId);
}

// ---- VHS Template System ----

interface VHSTemplate {
  name: string;
  frontBg: string[];
  accentColor: string;
  titleColor: string;
  posterLayout: "full-bleed" | "centered-padded" | "offset-left";
  showTagline: boolean;
  borderStyle: "neon-lines" | "thick-band" | "none" | "double-stripe";
  backBg: string[];
  screenshotLayout: "hero-row" | "asymmetric" | "sidebar" | "scattered";
  spineBg: string[];
  spineAccent: string;
}

const TEMPLATES: VHSTemplate[] = [
  // 0: Neon Classic (Terminator Thorn EMI)
  {
    name: "Neon Classic",
    frontBg: ["#0d0020", "#0a0a18", "#050510"],
    accentColor: "#ff2d95",
    titleColor: "#ffffff",
    posterLayout: "full-bleed",
    showTagline: true,
    borderStyle: "neon-lines",
    backBg: ["#050510", "#0a0a18", "#0d0020"],
    screenshotLayout: "hero-row",
    spineBg: ["#1a0030", "#250040", "#1a0030"],
    spineAccent: "#ff2d95",
  },
  // 1: Blockbuster Bold (Rocky II Warner)
  {
    name: "Blockbuster Bold",
    frontBg: ["#1a0000", "#0a0000", "#050000"],
    accentColor: "#cc0000",
    titleColor: "#ffd700",
    posterLayout: "full-bleed",
    showTagline: false,
    borderStyle: "thick-band",
    backBg: ["#0a0000", "#0f0505", "#0a0000"],
    screenshotLayout: "asymmetric",
    spineBg: ["#cc0000", "#8b0000", "#cc0000"],
    spineAccent: "#ffd700",
  },
  // 2: Epic Saga (Return of the Jedi CBS/Fox)
  {
    name: "Epic Saga",
    frontBg: ["#0a0a1a", "#050510", "#020208"],
    accentColor: "#c8a000",
    titleColor: "#ffffff",
    posterLayout: "full-bleed",
    showTagline: true,
    borderStyle: "double-stripe",
    backBg: ["#020208", "#0a0a15", "#050510"],
    screenshotLayout: "sidebar",
    spineBg: ["#0a0a1a", "#14142a", "#0a0a1a"],
    spineAccent: "#c8a000",
  },
  // 3: Comedy Pop (Ghostbusters CEL)
  {
    name: "Comedy Pop",
    frontBg: ["#003333", "#004d4d", "#002828"],
    accentColor: "#00e5cc",
    titleColor: "#ffffff",
    posterLayout: "full-bleed",
    showTagline: true,
    borderStyle: "none",
    backBg: ["#002828", "#003838", "#002020"],
    screenshotLayout: "scattered",
    spineBg: ["#004d4d", "#006666", "#004d4d"],
    spineAccent: "#00e5cc",
  },
  // 4: Foreign Edition (Predator 2 Fox NL)
  {
    name: "Foreign Edition",
    frontBg: ["#0f0800", "#0a0500", "#050300"],
    accentColor: "#ff6600",
    titleColor: "#ffffff",
    posterLayout: "full-bleed",
    showTagline: false,
    borderStyle: "thick-band",
    backBg: ["#050300", "#0a0800", "#0f0a00"],
    screenshotLayout: "hero-row",
    spineBg: ["#0f0800", "#1a0f00", "#0f0800"],
    spineAccent: "#ff6600",
  },
  // 5: Retro Industrial (RoboCop Argentine)
  {
    name: "Retro Industrial",
    frontBg: ["#1a1a1a", "#222222", "#141414"],
    accentColor: "#888888",
    titleColor: "#cc0000",
    posterLayout: "full-bleed",
    showTagline: false,
    borderStyle: "thick-band",
    backBg: ["#141414", "#1a1a1a", "#111111"],
    screenshotLayout: "asymmetric",
    spineBg: ["#1a1a1a", "#252525", "#1a1a1a"],
    spineAccent: "#cc0000",
  },
];

// ---- Helpers ----

/** Check if a gradient array (template bg) is dark.
 *  Parses the middle stop hex color and tests luminance < 128. */
function isTemplateBgDark(bgStops: string[]): boolean {
  const hex = bgStops[Math.floor(bgStops.length / 2)] || bgStops[0];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Pre-analyze a logo image: populate monochrome + brightness caches.
 *  Called at load time (async context) so texture generation gets instant cache hits. */
function preAnalyzeLogo(img: HTMLImageElement): void {
  isMonochromeLogo(img);
  isLogoBright(img);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      if (lines.length >= maxLines) {
        lines[lines.length - 1] =
          lines[lines.length - 1].replace(/\s+\S*$/, "") + "...";
        return lines;
      }
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  rating: number,
  x: number,
  y: number,
  size: number,
) {
  const fullStars = Math.floor(rating / 2);
  const halfStar = (rating / 2) % 1 >= 0.5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle =
      i < fullStars || (i === fullStars && halfStar)
        ? "#ffd700"
        : "rgba(255,215,0,0.2)";
    ctx.font = `${size}px sans-serif`;
    ctx.fillText("\u2605", x + i * (size + 2), y);
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  try {
    return await preloadPosterImage(url);
  } catch {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
}

function coverCropImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgAspect = img.width / img.height;
  const targetAspect = w / h;
  let sx = 0,
    sy = 0,
    sw = img.width,
    sh = img.height;
  if (imgAspect > targetAspect) {
    sw = img.height * targetAspect;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetAspect;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawFramedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  frameColor: string,
) {
  ctx.fillStyle = frameColor;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  coverCropImage(ctx, img, x, y, w, h);
}

function fillGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stops: string[],
) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (stops.length === 2) {
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(1, stops[1]);
  } else if (stops.length >= 3) {
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.5, stops[1]);
    grad.addColorStop(1, stops[2]);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Draw MPAA/FR certification badge (rounded rect with text) */
function drawCertificationBadge(
  ctx: CanvasRenderingContext2D,
  cert: string,
  x: number,
  y: number,
  accentColor: string,
) {
  if (!cert) return;
  ctx.font = "bold 14px sans-serif";
  const textW = ctx.measureText(cert).width;
  const badgeW = textW + 12;
  const badgeH = 20;
  // Background
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  roundRect(ctx, x, y, badgeW, badgeH, 3);
  ctx.fill();
  // Border
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  roundRect(ctx, x, y, badgeW, badgeH, 3);
  ctx.stroke();
  // Text
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(cert, x + badgeW / 2, y + 15);
}

/** Draw VHS VIDÉO format badge (top-right area) */
function drawVHSBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accentColor: string,
) {
  const badgeW = 48;
  const badgeH = 22;
  // Background pill
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  roundRect(ctx, x, y, badgeW, badgeH, 3);
  ctx.fill();
  // VHS text
  ctx.font = "bold 11px sans-serif";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.fillText("VHS", x + badgeW / 2, y + 14);
}

/** Draw the classic VHS Hi-Fi Stereo logo block.
 *  Layout: VHS → double bar → ⌈hi-fi⌉ boxed → STEREO
 *  Used on spine (color) and spine bump map (white). */
function drawVHSHiFiBlock(
  tc: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  color: string,
  maxW: number,
) {
  tc.fillStyle = color;
  tc.textAlign = "center";
  tc.textBaseline = "middle";

  // 1. "VHS" inside a bordered box — bold, dominant
  tc.font = "bold 18px sans-serif";
  const vhsTextW = tc.measureText("VHS").width;
  const boxPadX = 6;
  const boxPadY = 4;
  const boxW = vhsTextW + boxPadX * 2;
  const boxH = 20 + boxPadY * 2;
  tc.strokeStyle = color;
  tc.lineWidth = 1.5;
  tc.strokeRect(cx - boxW / 2, baseY - boxH / 2, boxW, boxH);
  tc.fillText("VHS", cx, baseY);

  // 2. Single horizontal bar
  const barW = maxW * 0.52;
  const barX = cx - barW / 2;
  const barY1 = baseY + boxH / 2 + 3;
  tc.fillRect(barX, barY1, barW, 2);

  // 3. "hi-fi"
  tc.font = "bold 12px sans-serif";
  const hifiY = barY1 + 14;
  tc.fillText("hi-fi", cx, hifiY);

  // 4. "STEREO" — smaller, spaced
  tc.font = "bold 9px sans-serif";
  const stereoY = hifiY + boxH / 2 + 10;
  // Manual letter spacing via character-by-character drawing
  const stereo = "STEREO";
  const spacing = 2.5;
  const charWidths = stereo.split("").map((c) => tc.measureText(c).width);
  const totalStereoW =
    charWidths.reduce((s, w) => s + w, 0) + spacing * (stereo.length - 1);
  let sx = cx - totalStereoW / 2;
  tc.textAlign = "left";
  for (let i = 0; i < stereo.length; i++) {
    tc.fillText(stereo[i], sx, stereoY);
    sx += charWidths[i] + spacing;
  }
  tc.textAlign = "center"; // restore
}

/** Rounded rect helper (Canvas2D path) */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draw runtime indicator bar */
function drawRuntimeBar(
  ctx: CanvasRenderingContext2D,
  runtime: number | null,
  x: number,
  y: number,
  maxW: number,
  accentColor: string,
) {
  if (!runtime) return;
  const barH = 4;
  // Background track
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(x, y, maxW, barH);
  // Fill proportional to runtime (scale: 60min=30%, 180min=100%)
  const ratio = Math.min(1, runtime / 180);
  ctx.fillStyle = accentColor;
  ctx.fillRect(x, y, Math.round(maxW * ratio), barH);
  // Label
  ctx.font = "8px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.textAlign = "right";
  ctx.fillText(`${runtime} min`, x + maxW, y + barH + 9);
}

/** Enable subtle text shadow for readability */
function enableTextShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
}

function enableLightTextShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
}

/** Disable shadow (for images, shapes, barcodes) */
function disableShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Draw movie logo image or fallback to text title.
 * Returns the height consumed so the caller can advance curY.
 */
function drawTitleOrLogo(
  tc: CanvasRenderingContext2D,
  data: VHSCoverData,
  opts: {
    x: number; // center-x (for 'center') or left-x (for 'left')
    y: number; // top of the title zone
    maxW: number; // max width for logo/text
    fontSize: number; // text fallback font size
    color: string;
    align: "center" | "left";
    maxLines?: number;
  },
): number {
  const { x, y, maxW, fontSize, color, align, maxLines = 2 } = opts;

  if (data.logoImg) {
    const logoAspect = data.logoImg.width / data.logoImg.height;
    let logoW = maxW;
    let logoH = logoW / logoAspect;
    const maxH = fontSize * maxLines * 1.4;
    if (logoH > maxH) {
      logoH = maxH;
      logoW = logoH * logoAspect;
    }
    const drawX = align === "center" ? x - logoW / 2 : x;
    tc.drawImage(data.logoImg, drawX, y, logoW, logoH);
    return logoH + 4;
  }

  // Text fallback
  tc.font = `bold ${fontSize}px sans-serif`;
  tc.fillStyle = color;
  tc.textAlign = align;
  const lines = wrapText(tc, data.film.title.toUpperCase(), maxW, maxLines);
  let dy = 0;
  const lineH = Math.round(fontSize * 1.2);
  for (const line of lines) {
    tc.fillText(line, x, y + fontSize + dy);
    dy += lineH;
  }
  return dy + 4;
}

/** Detect if a logo image is predominantly bright (white/light) by sampling pixels.
 *  Results are cached by img.src to avoid repeated GPU→CPU readbacks. */
function isLogoBright(img: HTMLImageElement): boolean {
  const cached = _logoBrightnessCache.get(img.src);
  if (cached !== undefined) return cached;

  const size = 32;
  // Dedicated sampling canvas (must not be shared with cover blit rendering)
  _logoSampleCanvas.width = size;
  _logoSampleCanvas.height = size;
  _logoSampleCtx.clearRect(0, 0, size, size);
  _logoSampleCtx.drawImage(img, 0, 0, size, size);
  const pixels = _logoSampleCtx.getImageData(0, 0, size, size).data;
  let brightCount = 0;
  let opaqueCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 50) continue; // skip transparent pixels
    opaqueCount++;
    const lum =
      0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    if (lum > 130) brightCount++;
  }
  const result = opaqueCount > 0 && brightCount / opaqueCount > 0.5;
  _logoBrightnessCache.set(img.src, result);
  return result;
}

/** Check if a logo is monochrome (grayscale — R≈G≈B for all opaque pixels).
 *  Monochrome logos get adaptive contrast inversion; color logos are drawn as-is. */
function isMonochromeLogo(img: HTMLImageElement): boolean {
  const cached = _logoMonochromeCache.get(img.src);
  if (cached !== undefined) return cached;

  const size = 48;
  _logoSampleCanvas.width = size;
  _logoSampleCanvas.height = size;
  _logoSampleCtx.clearRect(0, 0, size, size);
  _logoSampleCtx.drawImage(img, 0, 0, size, size);
  const pixels = _logoSampleCtx.getImageData(0, 0, size, size).data;

  let opaqueCount = 0;
  let colorCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 50) continue;
    opaqueCount++;
    const maxC = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    const minC = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (maxC - minC > 30) colorCount++;
  }
  // <10% colored pixels = monochrome
  const result = opaqueCount > 0 && colorCount / opaqueCount < 0.1;
  _logoMonochromeCache.set(img.src, result);
  return result;
}

/** Get an inverted version of a logo image (white↔black, cached). */
function getInvertedLogo(
  img: HTMLImageElement,
  w: number,
  h: number,
): HTMLCanvasElement {
  const key = `${img.src}_${w}_${h}`;
  const cached = _invertedLogoCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const pw = Math.round(w * RENDER_SCALE);
  const ph = Math.round(h * RENDER_SCALE);
  canvas.width = pw;
  canvas.height = ph;
  const tctx = canvas.getContext("2d")!;
  tctx.drawImage(img, 0, 0, pw, ph);
  const imgData = tctx.getImageData(0, 0, pw, ph);
  const pixels = imgData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) {
      pixels[i] = 255 - pixels[i];
      pixels[i + 1] = 255 - pixels[i + 1];
      pixels[i + 2] = 255 - pixels[i + 2];
    }
  }
  tctx.putImageData(imgData, 0, 0);
  _invertedLogoCache.set(key, canvas);
  return canvas;
}

/** Draw a studio logo with adaptive contrast for monochrome logos.
 *  Color logos are drawn as-is. Monochrome logos are inverted when
 *  they would be invisible against the background (dark-on-dark or light-on-light).
 *  `bgIsDark` is derived from the template color — avoids expensive getImageData sampling. */
function drawLogoAdaptive(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  bgIsDark: boolean = true,
): void {
  if (!isMonochromeLogo(img)) {
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  const logoBright = isLogoBright(img);

  // Invert when: dark logo on dark bg, or bright logo on bright bg
  const needsInvert =
    (bgIsDark && !logoBright) || (!bgIsDark && logoBright);

  if (needsInvert) {
    const inverted = getInvertedLogo(img, w, h);
    ctx.drawImage(inverted, 0, 0, inverted.width, inverted.height, x, y, w, h);
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
}

/** Awards badge based on vote_average (proxy for critical acclaim) */
function getAwardsText(film: Film): string | null {
  const vc = film.vote_count || 0;
  if (film.vote_average >= 8.5 && vc >= 5000)
    return "CHEF-D'\u0152UVRE DU CIN\u00c9MA";
  if (film.vote_average >= 8.0 && vc >= 2000)
    return "ACCLAM\u00c9 PAR LA CRITIQUE";
  if (film.vote_average >= 7.5 && vc >= 3000) return "RECOMMAND\u00c9";
  return null;
}

// ---- Data types ----

/** Recorded fillText call for bump map replay */
interface TextBumpOp {
  text: string;
  x: number;
  y: number;
  font: string;
  align: CanvasTextAlign;
}

/** Position info captured during front cover color rendering, used for bump map alignment */
interface FrontTitleBumpInfo {
  x: number;
  y: number;
  maxW: number;
  fontSize: number;
  align: "center" | "left";
  maxLines: number;
  textOps: TextBumpOp[];
}

export interface VHSCoverData {
  film: Film;
  posterImg: HTMLImageElement | null;
  backdropImgs: HTMLImageElement[];
  directors: string[];
  actors: string[];
  secondaryActors: string[];
  producers: string[];
  writers: string[];
  composer: string;
  tagline: string;
  studioName: string; // major/distributor (first known major)
  productionStudioName: string; // production company (first non-major, if different)
  reviews: { author: string; content: string }[];
  certification: string;
  logoImg: HTMLImageElement | null;
  studioLogos: { img: HTMLImageElement; companyId: number }[];
}

export async function fetchVHSCoverData(film: Film): Promise<VHSCoverData> {
  const cached = VHS_DATA_CACHE.get(film.id);
  if (cached) return cached;

  const tmdbFilmId = film.tmdb_id ?? null;
  const data: VHSCoverData = {
    film,
    posterImg: null,
    backdropImgs: [],
    directors: film.directors || [],
    actors: film.actors || [],
    secondaryActors: [],
    producers: [],
    writers: [],
    composer: "",
    tagline: film.tagline || "",
    studioName: film.production_companies?.[0]?.name || "",
    productionStudioName: "",
    reviews: [],
    certification: "",
    logoImg: null,
    studioLogos: [],
  };

  const promises: Promise<void>[] = [];

  // Poster (w500)
  if (film.poster_path) {
    promises.push(
      loadImage(tmdb.posterUrl(film.poster_path, "w500"))
        .then((img) => {
          data.posterImg = img;
        })
        .catch(() => {}),
    );
  }

  if (tmdbFilmId !== null) {
    // Expanded credits
    if (!film.directors?.length || !film.actors?.length) {
      promises.push(
        tmdb
          .getCredits(tmdbFilmId)
          .then((credits) => {
            data.directors = credits.directors;
            data.actors = credits.actors;
            data.secondaryActors = credits.secondaryActors;
            data.producers = credits.producers;
            data.writers = credits.writers;
            data.composer = credits.composer;
          })
          .catch(() => {}),
      );
    }

    // Reviews
    promises.push(
      tmdb
        .getReviews(tmdbFilmId)
        .then((reviews) => {
          data.reviews = reviews;
        })
        .catch(() => {}),
    );

    // Certification (MPAA / FR rating)
    promises.push(
      tmdb
        .getCertification(tmdbFilmId)
        .then((cert) => {
          data.certification = cert;
        })
        .catch(() => {}),
    );

    // Movie logo (official title treatment from TMDB)
    promises.push(
      tmdb
        .getMovieLogo(tmdbFilmId)
        .then(async (logoUrl) => {
          if (logoUrl) {
            data.logoImg = await loadImage(logoUrl).catch(() => null);
          }
        })
        .catch(() => {}),
    );

    // Fetch full film details (for production_companies, tagline) then load studio logos
    promises.push(
      tmdb
        .getFilm(tmdbFilmId)
        .then(async (fullFilm) => {
          if (!data.tagline && fullFilm.tagline)
            data.tagline = fullFilm.tagline;
          // Use TMDB vote_average (the DB doesn't store it — fetched at runtime)
          if (fullFilm.vote_average)
            data.film = { ...data.film, vote_average: fullFilm.vote_average };
          // Sort companies: known majors first (those in LOCAL_STUDIO_LOGOS)
          const allCompanies = fullFilm.production_companies || [];
          allCompanies.sort((a, b) => {
            const aId = STUDIO_ALIASES[a.name.toLowerCase()] || a.id;
            const bId = STUDIO_ALIASES[b.name.toLowerCase()] || b.id;
            const aMajor = LOCAL_STUDIO_LOGOS.has(aId) ? 0 : 1;
            const bMajor = LOCAL_STUDIO_LOGOS.has(bId) ? 0 : 1;
            return aMajor - bMajor;
          });
          // First major = distributor, first non-major = production studio
          if (allCompanies.length) {
            const firstMajor = allCompanies.find((c) => {
              const cid = STUDIO_ALIASES[c.name.toLowerCase()] || c.id;
              return LOCAL_STUDIO_LOGOS.has(cid);
            });
            const firstNonMajor = allCompanies.find((c) => {
              const cid = STUDIO_ALIASES[c.name.toLowerCase()] || c.id;
              return !LOCAL_STUDIO_LOGOS.has(cid);
            });
            if (firstMajor) {
              data.studioName = firstMajor.name;
              if (firstNonMajor) data.productionStudioName = firstNonMajor.name;
            } else {
              data.studioName = allCompanies[0].name;
            }
          }
          const companies = allCompanies.slice(0, 3);
          if (companies.length > 0) {
            const logoUrls = await Promise.all(
              companies.map((c) => resolveStudioLogoUrl(c)),
            );
            const imgs = await Promise.all(
              logoUrls.map((url) =>
                url ? loadImage(url).catch(() => null) : Promise.resolve(null),
              ),
            );
            data.studioLogos = imgs
              .map((img, idx) =>
                img
                  ? {
                      img,
                      companyId:
                        STUDIO_ALIASES[companies[idx].name.toLowerCase()] ||
                        companies[idx].id,
                    }
                  : null,
              )
              .filter(
                (e): e is { img: HTMLImageElement; companyId: number } =>
                  e !== null,
              );
            // Pre-analyze logos now (async context) so texture generation gets instant cache hits
            for (const { img } of data.studioLogos) {
              preAnalyzeLogo(img);
            }
          }
        })
        .catch(() => {}),
    );

    // Backdrop images (deduplicated — avoid visually similar shots)
    promises.push(
      tmdb
        .getImages(tmdbFilmId)
        .then(async (images: TMDBImage[]) => {
          const candidates = images
            .filter((img) => img.aspect_ratio > 1.3)
            .sort((a, b) => b.width - a.width);

          // Deduplicate: skip images whose file_path base name is too similar
          // and spread picks across different aspect ratios to get varied shots
          const seen = new Set<string>();
          const picked: TMDBImage[] = [];
          for (const img of candidates) {
            if (picked.length >= 3) break;
            // Skip exact duplicate paths
            if (seen.has(img.file_path)) continue;
            seen.add(img.file_path);
            // Skip images with nearly identical dimensions (same shot, different quality)
            const isDupe = picked.some(
              (p) =>
                Math.abs(p.aspect_ratio - img.aspect_ratio) < 0.05 &&
                Math.abs(p.width - img.width) < 200,
            );
            if (isDupe) continue;
            picked.push(img);
          }

          const results = await Promise.all(
            picked.map((img) =>
              loadImage(tmdb.backdropUrl(img.file_path, "w780") || "").catch(
                () => null,
              ),
            ),
          );
          data.backdropImgs = results.filter(
            (img): img is HTMLImageElement => img !== null,
          );
        })
        .catch(() => {}),
    );
  }

  await Promise.all(promises);
  VHS_DATA_CACHE.set(film.id, data);
  return data;
}

// ---- Template selection ----

function getTemplate(film: Film): VHSTemplate {
  return TEMPLATES[film.id % TEMPLATES.length];
}

// ---- Texture generation ----

export function generateVHSCoverTexture(
  data: VHSCoverData,
): THREE.CanvasTexture {
  // Return cached texture if available
  const filmId = data.film.id;
  const cachedTex = VHS_TEXTURE_CACHE.get(filmId);
  if (cachedTex) return cachedTex;

  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE * RENDER_SCALE;
  canvas.height = TEX_SIZE * RENDER_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  const template = getTemplate(data.film);

  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const frontTitleInfo = drawFrontCover(ctx, data, template);
  // Paint notch cutout — black semi-ellipse at top center of front cover
  // Represents the paper jacket cutout where VHS tape is visible through black plastic
  drawNotchCutout(ctx, FRONT);
  const backTextOps = drawBackCover(ctx, data, template);
  drawSpine(ctx, SPINE1, data, template);
  drawSpine(ctx, SPINE2, data, template);
  drawEdge(ctx, TOP_EDGE);
  drawEdge(ctx, BOTTOM_EDGE);

  // Generate bump map for text/logo relief (light-reactive emboss on all surfaces)
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = TEX_SIZE * RENDER_SCALE;
  bumpCanvas.height = TEX_SIZE * RENDER_SCALE;
  const bCtx = bumpCanvas.getContext("2d")!;
  bCtx.scale(RENDER_SCALE, RENDER_SCALE);
  bCtx.fillStyle = "#000000";
  bCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  drawSpineBump(bCtx, SPINE1, data, template);
  drawSpineBump(bCtx, SPINE2, data, template);
  drawFrontBump(bCtx, data, template, frontTitleInfo);
  drawBackBump(bCtx, backTextOps);

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.flipY = false;
  bumpTexture.anisotropy = 16;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 16;
  texture.userData.bumpMap = bumpTexture;

  // LRU cache: evict oldest if at capacity
  if (VHS_TEXTURE_LRU.length >= VHS_TEXTURE_MAX) {
    const evictId = VHS_TEXTURE_LRU.shift()!;
    const evicted = VHS_TEXTURE_CACHE.get(evictId);
    if (evicted) {
      evicted.userData.bumpMap?.dispose();
      evicted.dispose();
      VHS_TEXTURE_CACHE.delete(evictId);
    }
  }
  VHS_TEXTURE_CACHE.set(filmId, texture);
  VHS_TEXTURE_LRU.push(filmId);

  return texture;
}

// ---- Notch cutout (tape-grab semi-ellipse at top center of front cover) ----

function drawNotchCutout(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  fillColor = "#0a0a0a", // default: VHS black plastic
) {
  const cx = region.x + region.w / 2;
  const cy = region.y; // top edge of the cover face
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy, NOTCH_RADIUS_X, NOTCH_RADIUS_Y, 0, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

// ---- Blit helper ----

function blitFlipped(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  drawFn: (tc: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  // Reuse blit canvas at high-DPI for sharp text & logos
  _blitCanvas.width = region.w * RENDER_SCALE;
  _blitCanvas.height = region.h * RENDER_SCALE;
  _blitCtx.scale(RENDER_SCALE, RENDER_SCALE);
  _blitCtx.clearRect(0, 0, region.w, region.h);
  drawFn(_blitCtx, region.w, region.h);
  ctx.save();
  ctx.translate(region.x + region.w, region.y);
  ctx.scale(-1, 1);
  ctx.drawImage(_blitCanvas, 0, 0, region.w, region.h);
  ctx.restore();
}

// ============================================================
//  FRONT COVER
// ============================================================

function drawFrontCover(
  ctx: CanvasRenderingContext2D,
  data: VHSCoverData,
  template: VHSTemplate,
): FrontTitleBumpInfo {
  let titleInfo: FrontTitleBumpInfo = {
    x: 0,
    y: 0,
    maxW: 0,
    fontSize: 32,
    align: "center",
    maxLines: 2,
    textOps: [],
  };
  const textOps: TextBumpOp[] = [];
  blitFlipped(ctx, FRONT, (tc, w, h) => {
    // Record all fillText calls for bump map replay
    const origFillText = tc.fillText;
    (tc as any).fillText = (
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) => {
      textOps.push({
        text,
        x,
        y,
        font: tc.font,
        align: tc.textAlign as CanvasTextAlign,
      });
      origFillText.call(tc, text, x, y, maxWidth!);
    };

    const pad = 14;

    fillGradient(tc, w, h, template.frontBg);
    enableTextShadow(tc);

    if (template.posterLayout === "full-bleed") {
      titleInfo = drawFrontFullBleed(tc, w, h, pad, data, template);
    } else if (template.posterLayout === "centered-padded") {
      titleInfo = drawFrontCenteredPadded(tc, w, h, pad, data, template);
    } else {
      titleInfo = drawFrontOffsetLeft(tc, w, h, pad, data, template);
    }

    // Restore fillText (remove instance shadow → prototype method)
    delete (tc as any).fillText;
  });
  titleInfo.textOps = textOps;
  return titleInfo;
}

function drawFrontFullBleed(
  tc: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  data: VHSCoverData,
  template: VHSTemplate,
): FrontTitleBumpInfo {
  const { film, posterImg } = data;

  if (posterImg) {
    disableShadow(tc);
    coverCropImage(tc, posterImg, 0, 0, w, h);
    // Bottom gradient (strong) for text zone
    const gradBot = tc.createLinearGradient(0, h * 0.38, 0, h);
    gradBot.addColorStop(0, "transparent");
    gradBot.addColorStop(0.3, "rgba(0,0,0,0.5)");
    gradBot.addColorStop(0.6, "rgba(0,0,0,0.85)");
    gradBot.addColorStop(1, "rgba(0,0,0,0.95)");
    tc.fillStyle = gradBot;
    tc.fillRect(0, h * 0.38, w, h * 0.62);
    // Top gradient for studio/actors
    const gradTop = tc.createLinearGradient(0, 0, 0, h * 0.22);
    gradTop.addColorStop(0, "rgba(0,0,0,0.8)");
    gradTop.addColorStop(1, "transparent");
    tc.fillStyle = gradTop;
    tc.fillRect(0, 0, w, h * 0.22);
    enableTextShadow(tc);
  } else {
    tc.fillStyle = `${template.accentColor}18`;
    tc.fillRect(0, 0, w, h);
    tc.font = "bold 64px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText(film.title.substring(0, 2).toUpperCase(), w / 2, h / 2 + 20);
  }

  // --- Top zone (below notch) ---
  let topY = NOTCH_BOTTOM + 4;

  // Studio (centered, top)
  enableLightTextShadow(tc);
  if (data.studioName) {
    tc.font = "bold 10px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.55)";
    tc.textAlign = "center";
    tc.fillText(data.studioName.toUpperCase(), w / 2, topY + 10);
    topY += 14;
  }

  // Actor names (centered)
  if (data.actors.length > 0) {
    tc.font = "bold 18px sans-serif";
    tc.fillStyle = "#ffffff";
    tc.textAlign = "center";
    const actorStr = data.actors.slice(0, 3).join("  \u2022  ").toUpperCase();
    const actorLines = wrapText(tc, actorStr, w - pad * 2, 2);
    for (const line of actorLines) {
      tc.fillText(line, w / 2, topY + 18);
      topY += 22;
    }
    topY += 4;
  }
  enableTextShadow(tc);

  // VHS badge (right) + Certification badge (left) — below studio/actors
  drawVHSBadge(tc, w - pad - 50, topY, template.accentColor);
  if (data.certification) {
    drawCertificationBadge(
      tc,
      data.certification,
      pad,
      topY,
      template.accentColor,
    );
  }

  // --- Bottom text zone (shifted down 5% for breathing room below poster) ---
  let curY = h - 260 + Math.round(h * 0.05);

  // Awards badge
  const awards = getAwardsText(film);
  if (awards) {
    tc.font = "bold 11px sans-serif";
    tc.fillStyle = "#ffd700";
    tc.textAlign = "center";
    tc.fillText("\u2605 " + awards + " \u2605", w / 2, curY + 11);
    curY += 20;
  }

  // Capture title position for bump map alignment
  const _titleY = curY;

  // Title (logo or text)
  enableLightTextShadow(tc);
  curY += drawTitleOrLogo(tc, data, {
    x: w / 2,
    y: curY,
    maxW: w - pad * 2,
    fontSize: 32,
    color: template.titleColor,
    align: "center",
  });
  enableTextShadow(tc);

  // Tagline
  if (template.showTagline && data.tagline) {
    tc.font = "italic 12px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.75)";
    tc.textAlign = "center";
    const tagLines = wrapText(tc, data.tagline, w - pad * 2, 2);
    for (const line of tagLines) {
      tc.fillText(line, w / 2, curY + 12);
      curY += 16;
    }
    curY += 4;
  }

  // Director
  if (data.directors.length > 0) {
    tc.font = "12px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.7)";
    tc.textAlign = "center";
    tc.fillText("Un film de " + data.directors.join(", "), w / 2, curY + 12);
    curY += 18;
  }

  // Stars + year
  drawStars(tc, film.vote_average, w / 2 - 55, curY + 14, 16);
  curY += 24;
  tc.font = "12px sans-serif";
  tc.fillStyle = "rgba(255,255,255,0.6)";
  tc.textAlign = "center";
  const year = film.release_date
    ? new Date(film.release_date).getFullYear()
    : "";
  tc.fillText(year.toString(), w / 2, curY + 12);
  curY += 18;

  // Genres
  if (film.genres.length > 0) {
    tc.font = "11px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText(
      film.genres.map((g) => g.name).join(" \u2022 "),
      w / 2,
      curY + 11,
    );
    curY += 16;
  }

  // Runtime bar (bottom)
  drawRuntimeBar(
    tc,
    film.runtime,
    pad,
    curY + 2,
    w - pad * 2,
    template.accentColor,
  );

  return {
    x: w / 2,
    y: _titleY,
    maxW: w - pad * 2,
    fontSize: 32,
    align: "center",
    maxLines: 2,
    textOps: [],
  };
}

function drawFrontCenteredPadded(
  tc: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  data: VHSCoverData,
  template: VHSTemplate,
): FrontTitleBumpInfo {
  const { film, posterImg } = data;
  let curY = 8;

  // Top colored band with studio
  if (template.borderStyle === "thick-band") {
    tc.fillStyle = template.accentColor;
    tc.fillRect(0, 0, w, 40);
    if (data.studioName) {
      tc.font = "bold 12px sans-serif";
      tc.fillStyle = "#ffffff";
      tc.textAlign = "center";
      tc.fillText(data.studioName.toUpperCase(), w / 2, 26);
    }
    curY = 46;
  }

  // Studio + actors (below notch zone, above badges)
  curY = Math.max(curY, NOTCH_BOTTOM + 6);

  enableLightTextShadow(tc);
  if (data.studioName && template.borderStyle !== "thick-band") {
    tc.font = "bold 10px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.55)";
    tc.textAlign = "center";
    tc.fillText(data.studioName.toUpperCase(), w / 2, curY + 10);
    curY += 14;
  }

  if (data.actors.length > 0) {
    tc.font = "bold 16px sans-serif";
    tc.fillStyle = "#ffffff";
    tc.textAlign = "center";
    const actorStr = data.actors.slice(0, 3).join("  \u2022  ").toUpperCase();
    const actorLines = wrapText(tc, actorStr, w - pad * 2, 2);
    for (const line of actorLines) {
      tc.fillText(line, w / 2, curY + 16);
      curY += 20;
    }
    curY += 4;
  }
  enableTextShadow(tc);

  // Certification + VHS badges on same line (below studio/actors)
  if (data.certification) {
    drawCertificationBadge(
      tc,
      data.certification,
      pad,
      curY,
      template.accentColor,
    );
  }
  drawVHSBadge(tc, w - pad - 50, curY, template.accentColor);
  curY += 26;

  // Poster image centered
  if (posterImg) {
    const posterMaxH = Math.round(h * 0.44);
    const posterMaxW = w - pad * 4;
    const aspect = posterImg.width / posterImg.height;
    let pW = posterMaxW;
    let pH = pW / aspect;
    if (pH > posterMaxH) {
      pH = posterMaxH;
      pW = pH * aspect;
    }
    const pX = Math.round((w - pW) / 2);
    tc.drawImage(posterImg, pX, curY, pW, pH);
    tc.strokeStyle = `${template.accentColor}66`;
    tc.lineWidth = 1.5;
    tc.strokeRect(pX, curY, pW, pH);
    curY += pH + 10;
  } else {
    const fallH = Math.round(h * 0.35);
    tc.fillStyle = `${template.accentColor}18`;
    tc.fillRect(pad * 2, curY, w - pad * 4, fallH);
    tc.font = "bold 48px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText(
      film.title.substring(0, 2).toUpperCase(),
      w / 2,
      curY + fallH / 2 + 16,
    );
    curY += fallH + 10;
  }

  // Shift title block down 5% (same as full-bleed layout)
  curY += Math.round(h * 0.05);

  // Awards badge
  const awards = getAwardsText(film);
  if (awards) {
    tc.font = "bold 10px sans-serif";
    tc.fillStyle = "#ffd700";
    tc.textAlign = "center";
    tc.fillText("\u2605 " + awards + " \u2605", w / 2, curY + 10);
    curY += 18;
  }

  // Capture title position for bump map alignment
  const _titleY = curY;

  // Title (logo or text)
  enableLightTextShadow(tc);
  curY += drawTitleOrLogo(tc, data, {
    x: w / 2,
    y: curY,
    maxW: w - pad * 2,
    fontSize: 28,
    color: template.titleColor,
    align: "center",
  });
  enableTextShadow(tc);

  // Director
  if (data.directors.length > 0) {
    tc.font = "11px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.7)";
    tc.textAlign = "center";
    tc.fillText("Un film de " + data.directors.join(", "), w / 2, curY + 11);
    curY += 16;
  }

  // Stars + year
  drawStars(tc, film.vote_average, w / 2 - 55, curY + 14, 16);
  curY += 24;
  tc.font = "12px sans-serif";
  tc.fillStyle = "rgba(255,255,255,0.55)";
  tc.textAlign = "center";
  const yearCP = film.release_date
    ? new Date(film.release_date).getFullYear()
    : "";
  tc.fillText(yearCP.toString(), w / 2, curY + 12);
  curY += 18;

  // Genres
  if (film.genres.length > 0) {
    tc.font = "11px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText(
      film.genres.map((g) => g.name).join(" \u2022 "),
      w / 2,
      curY + 11,
    );
    curY += 16;
  }

  // Runtime bar
  drawRuntimeBar(
    tc,
    film.runtime,
    pad,
    curY + 2,
    w - pad * 2,
    template.accentColor,
  );

  return {
    x: w / 2,
    y: _titleY,
    maxW: w - pad * 2,
    fontSize: 28,
    align: "center",
    maxLines: 2,
    textOps: [],
  };
}

function drawFrontOffsetLeft(
  tc: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  data: VHSCoverData,
  template: VHSTemplate,
): FrontTitleBumpInfo {
  const { film, posterImg } = data;

  if (posterImg) {
    const posterW = Math.round(w * 0.55);
    coverCropImage(tc, posterImg, 0, 0, posterW, h);
    // Soft fade on right edge
    const fadeGrad = tc.createLinearGradient(posterW - 40, 0, posterW, 0);
    fadeGrad.addColorStop(0, "transparent");
    fadeGrad.addColorStop(1, template.frontBg[1] || template.frontBg[0]);
    tc.fillStyle = fadeGrad;
    tc.fillRect(posterW - 40, 0, 40, h);

    // Right text column
    const textX = posterW + 6;
    const textW = w - posterW - 6 - pad;
    let rY = NOTCH_BOTTOM + 8;

    // Studio (top of right column)
    enableLightTextShadow(tc);
    if (data.studioName) {
      tc.font = "bold 10px sans-serif";
      tc.fillStyle = "rgba(255,255,255,0.5)";
      tc.textAlign = "left";
      tc.fillText(data.studioName.toUpperCase(), textX, rY + 10);
      rY += 16;
    }

    // Actor names vertically
    tc.font = "bold 14px sans-serif";
    tc.fillStyle = "#ffffff";
    tc.textAlign = "left";
    for (const actor of data.actors.slice(0, 4)) {
      tc.fillText(actor.toUpperCase(), textX, rY + 14);
      rY += 18;
    }
    rY += 6;
    enableTextShadow(tc);

    // VHS badge + certification (below studio/actors)
    drawVHSBadge(tc, textX, rY, template.accentColor);
    if (data.certification) {
      drawCertificationBadge(
        tc,
        data.certification,
        textX + 54,
        rY,
        template.accentColor,
      );
    }
    rY += 28;

    // Tagline
    if (template.showTagline && data.tagline) {
      tc.font = "italic 12px sans-serif";
      tc.fillStyle = template.accentColor;
      tc.textAlign = "left";
      const tagLines = wrapText(tc, data.tagline, textW, 3);
      for (const line of tagLines) {
        tc.fillText(line, textX, rY + 12);
        rY += 15;
      }
      rY += 6;
    }

    // Capture title position for bump map alignment
    const _titleY = rY;

    // Title (logo or text)
    enableLightTextShadow(tc);
    rY += drawTitleOrLogo(tc, data, {
      x: textX,
      y: rY,
      maxW: textW,
      fontSize: 20,
      color: template.titleColor,
      align: "left",
      maxLines: 4,
    });
    enableTextShadow(tc);

    // Awards
    const awardsOL = getAwardsText(film);
    if (awardsOL) {
      tc.font = "bold 9px sans-serif";
      tc.fillStyle = "#ffd700";
      tc.textAlign = "left";
      tc.fillText("\u2605 " + awardsOL, textX, rY + 9);
      rY += 14;
    }

    // Director
    if (data.directors.length > 0) {
      tc.font = "10px sans-serif";
      tc.fillStyle = "rgba(255,255,255,0.65)";
      tc.textAlign = "left";
      tc.fillText("R\u00e9al. " + data.directors[0], textX, rY + 10);
      rY += 14;
    }

    // Stars
    drawStars(tc, film.vote_average, textX, rY + 12, 14);
    rY += 22;

    // Year
    tc.font = "11px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.5)";
    tc.textAlign = "left";
    const yearOL = film.release_date
      ? new Date(film.release_date).getFullYear()
      : "";
    tc.fillText(yearOL.toString(), textX, rY + 11);
    rY += 16;

    // Genres
    if (film.genres.length > 0) {
      tc.font = "10px sans-serif";
      tc.fillStyle = template.accentColor;
      tc.textAlign = "left";
      for (const g of film.genres.slice(0, 3)) {
        tc.fillText(g.name, textX, rY + 10);
        rY += 14;
      }
      rY += 4;
    }

    // Runtime bar at bottom of right column
    drawRuntimeBar(tc, film.runtime, textX, rY, textW, template.accentColor);

    return {
      x: textX,
      y: _titleY,
      maxW: textW,
      fontSize: 20,
      align: "left",
      maxLines: 4,
      textOps: [],
    };
  } else {
    tc.fillStyle = `${template.accentColor}18`;
    tc.fillRect(pad, pad, w - pad * 2, h - pad * 2);
    tc.font = "bold 48px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText(film.title.substring(0, 2).toUpperCase(), w / 2, h / 2 + 16);

    return {
      x: w / 2,
      y: h / 2 - 16,
      maxW: w - pad * 2,
      fontSize: 48,
      align: "center",
      maxLines: 1,
      textOps: [],
    };
  }
}

// ============================================================
//  BACK COVER
// ============================================================

function drawBackCover(
  ctx: CanvasRenderingContext2D,
  data: VHSCoverData,
  template: VHSTemplate,
): TextBumpOp[] {
  const textOps: TextBumpOp[] = [];
  blitFlipped(ctx, BACK, (tc, w, h) => {
    // Record all fillText calls for bump map replay
    const origFillText = tc.fillText;
    (tc as any).fillText = (
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) => {
      textOps.push({
        text,
        x,
        y,
        font: tc.font,
        align: tc.textAlign as CanvasTextAlign,
      });
      origFillText.call(tc, text, x, y, maxWidth!);
    };

    const { film, backdropImgs } = data;
    const pad = 14;

    fillGradient(tc, w, h, template.backBg);
    enableTextShadow(tc);

    const topMargin = Math.round(h * 0.02);
    let curY = pad + topMargin;

    // Title header (logo or text)
    enableLightTextShadow(tc);
    curY += drawTitleOrLogo(tc, data, {
      x: pad,
      y: curY,
      maxW: w - pad * 2,
      fontSize: 16,
      color: template.accentColor,
      align: "left",
      maxLines: 1,
    });
    enableTextShadow(tc);

    // Separator
    tc.fillStyle = `${template.accentColor}60`;
    tc.fillRect(pad, curY, w - pad * 2, 1);
    curY += 6;

    // --- Screenshots (creative layouts) ---
    disableShadow(tc);
    const imgs = backdropImgs;
    if (imgs.length > 0) {
      curY = drawScreenshots(tc, imgs, w, pad, curY, template);
      curY += 6;
    }
    enableTextShadow(tc);

    // --- Review quotes ---
    if (data.reviews.length > 0) {
      for (const review of data.reviews.slice(0, 1)) {
        tc.font = "italic 10px sans-serif";
        tc.fillStyle = "rgba(255,255,255,0.75)";
        tc.textAlign = "left";
        const quoteLines = wrapText(
          tc,
          `\u00ab ${review.content} \u00bb`,
          w - pad * 2,
          3,
        );
        for (const line of quoteLines) {
          tc.fillText(line, pad, curY + 10);
          curY += 13;
        }
        tc.font = "9px sans-serif";
        tc.fillStyle = template.accentColor;
        tc.fillText("\u2014 " + review.author, pad + 20, curY + 9);
        curY += 16;
      }
    }

    // --- Synopsis ---
    tc.shadowColor = "rgba(0,0,0,0.5)";
    tc.shadowBlur = 1.5;
    tc.shadowOffsetX = 1;
    tc.shadowOffsetY = 1;
    tc.font = "bold 12px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "left";
    tc.fillText("SYNOPSIS", pad, curY + 12);
    curY += 18;

    tc.font = "15px sans-serif";
    tc.fillStyle = "#ffffff";
    const synText = film.overview || "Aucun synopsis disponible.";
    // Calculate available space for synopsis
    const creditsHeight = estimateCreditsHeight(data);
    const bottomReserved = 62 + creditsHeight; // barcode + branding + credits
    const maxSynY = h - bottomReserved;
    const availableSynLines = Math.max(3, Math.floor((maxSynY - curY) / 16));
    const synLines = wrapText(tc, synText, w - pad * 2, availableSynLines);
    for (const line of synLines) {
      tc.fillText(line, pad, curY + 13);
      curY += 16;
    }
    curY += 6;

    // --- Separator ---
    tc.fillStyle = "rgba(255,255,255,0.12)";
    tc.fillRect(pad, curY, w - pad * 2, 1);
    curY += 8;

    // --- Full credits block ---
    curY = drawCreditsBlock(tc, data, template, w, pad, curY);

    // --- "Soyez aimable, rembobinez" sticker ---
    curY += 2;
    tc.font = "italic 8px sans-serif";
    tc.fillStyle = template.accentColor;
    tc.textAlign = "center";
    tc.fillText("SOYEZ COOL, REMBOBINEZ", w / 2, curY + 8);
    curY += 14;

    // --- Certification + Runtime on back (compact line) ---
    tc.font = "8px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.5)";
    tc.textAlign = "left";
    const backMeta: string[] = [];
    if (data.certification) backMeta.push(data.certification);
    if (film.runtime) backMeta.push(`${film.runtime} min`);
    const yearBack = film.release_date
      ? new Date(film.release_date).getFullYear()
      : "";
    if (yearBack) backMeta.push(`\u00a9 ${yearBack}`);
    if (backMeta.length > 0) {
      tc.fillText(backMeta.join(" \u2022 "), pad, curY + 8);
      curY += 12;
    }

    // --- Production company logos (adaptive contrast — no pills) ---
    disableShadow(tc);
    if (data.studioLogos.length > 0) {
      const logoMaxH = 24;
      const logoGap = 10;
      const logoPad = 4;
      const logoSizes = data.studioLogos.map(({ img }) => {
        const aspect = img.width / img.height;
        return { w: logoMaxH * aspect, h: logoMaxH };
      });
      const totalW =
        logoSizes.reduce((sum, s) => sum + s.w + logoPad * 2, 0) +
        logoGap * (logoSizes.length - 1);
      let lx = (w - totalW) / 2;
      const ly = h - 72;
      const backBgDark = isTemplateBgDark(template.backBg);
      for (let i = 0; i < data.studioLogos.length; i++) {
        const { img: logoImg } = data.studioLogos[i];
        drawLogoAdaptive(
          tc,
          logoImg,
          lx + logoPad,
          ly,
          logoSizes[i].w,
          logoSizes[i].h,
          backBgDark,
        );
        lx += logoSizes[i].w + logoPad * 2 + logoGap;
      }
    }

    // --- Barcode (film-specific) ---
    drawBarcode(tc, w / 2 - 45, h - 50, 90, 28, film.id);

    // --- Bottom branding ---
    tc.font = "bold 9px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.5)";
    tc.textAlign = "center";
    tc.fillText("ZONE CLUB \u00c9DITIONS", w / 2, h - 10);

    // Restore fillText
    delete (tc as any).fillText;
  });
  return textOps;
}

function estimateCreditsHeight(data: VHSCoverData): number {
  let h = 0;
  if (data.actors.length > 0) h += 26; // Starring + actors
  if (data.secondaryActors.length > 0) h += 15;
  if (data.directors.length > 0) h += 14;
  if (data.producers.length > 0) h += 14;
  if (data.writers.length > 0) h += 14;
  if (data.composer) h += 14;
  if (data.studioName) h += 14;
  if (data.productionStudioName) h += 14;
  return h + 8;
}

function drawCreditsBlock(
  tc: CanvasRenderingContext2D,
  data: VHSCoverData,
  template: VHSTemplate,
  w: number,
  pad: number,
  startY: number,
): number {
  let curY = startY;
  const labelColor = template.accentColor;
  const textColor = "rgba(255,255,255,0.8)";
  const maxW = w - pad * 2;

  function creditLine(label: string, value: string) {
    if (!value) return;
    tc.font = "bold 10px sans-serif";
    tc.fillStyle = labelColor;
    tc.textAlign = "left";
    tc.fillText(label, pad, curY + 10);
    const labelW = tc.measureText(label).width + 4;
    tc.font = "10px sans-serif";
    tc.fillStyle = textColor;
    // Wrap value if too long
    const valLines = wrapText(tc, value, maxW - labelW, 2);
    tc.fillText(valLines[0], pad + labelW, curY + 10);
    curY += 13;
    if (valLines.length > 1) {
      tc.fillText(valLines[1], pad + labelW, curY + 10);
      curY += 13;
    }
  }

  // Starring (lead actors)
  if (data.actors.length > 0) {
    creditLine("Avec ", data.actors.join(", "));
  }

  // Secondary actors
  if (data.secondaryActors.length > 0) {
    creditLine("\u00c9galement ", data.secondaryActors.slice(0, 4).join(", "));
  }

  // Director
  if (data.directors.length > 0) {
    creditLine("R\u00e9alis\u00e9 par ", data.directors.join(", "));
  }

  // Distributor + Production studio
  if (data.studioName) {
    creditLine("Distribution ", data.studioName);
  }
  if (data.productionStudioName) {
    creditLine("Production ", data.productionStudioName);
  }

  // Producers
  if (data.producers.length > 0) {
    creditLine("Produit par ", data.producers.join(", "));
  }

  // Writers
  if (data.writers.length > 0) {
    creditLine("\u00c9crit par ", data.writers.join(", "));
  }

  // Composer
  if (data.composer) {
    creditLine("Musique de ", data.composer);
  }

  // Copyright year
  const yearCr = data.film.release_date
    ? new Date(data.film.release_date).getFullYear()
    : "";
  if (yearCr && data.studioName) {
    curY += 2;
    tc.font = "bold 10px sans-serif";
    tc.fillStyle = "rgba(255,255,255,0.5)";
    tc.textAlign = "left";
    tc.fillText(`\u00a9 ${yearCr} ${data.studioName}`, pad, curY + 10);
    curY += 13;
  }

  return curY;
}

// ---- Screenshot layouts (creative, reference-inspired) ----

function drawScreenshots(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  w: number,
  pad: number,
  startY: number,
  template: VHSTemplate,
): number {
  const count = Math.min(imgs.length, 3);
  const frameColor = `${template.accentColor}40`;
  const usableW = w - pad * 2;

  switch (template.screenshotLayout) {
    case "hero-row":
      return layoutHeroRow(
        tc,
        imgs,
        count,
        w,
        pad,
        startY,
        usableW,
        frameColor,
      );
    case "asymmetric":
      return layoutAsymmetric(
        tc,
        imgs,
        count,
        w,
        pad,
        startY,
        usableW,
        frameColor,
      );
    case "sidebar":
      return layoutSidebar(tc, imgs, count, pad, startY, usableW, frameColor);
    case "scattered":
      return layoutScattered(
        tc,
        imgs,
        count,
        w,
        pad,
        startY,
        usableW,
        frameColor,
      );
  }
}

// Layout 0: Panoramic hero image + small images below (Terminator-style)
function layoutHeroRow(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  count: number,
  _w: number,
  pad: number,
  startY: number,
  usableW: number,
  frameColor: string,
): number {
  let curY = startY;
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 150, frameColor);
    curY += 156;
  } else if (count === 2) {
    // Top panoramic
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 120, frameColor);
    curY += 126;
    // Bottom offset right
    const smallW = Math.round(usableW * 0.55);
    drawFramedImage(
      tc,
      imgs[1],
      pad + usableW - smallW,
      curY,
      smallW,
      80,
      frameColor,
    );
    curY += 86;
  } else {
    // Top panoramic
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 120, frameColor);
    curY += 126;
    // Two small images below, different widths
    const gap = 6;
    const w1 = Math.round(usableW * 0.45);
    const w2 = usableW - w1 - gap;
    drawFramedImage(tc, imgs[1], pad, curY, w1, 75, frameColor);
    drawFramedImage(tc, imgs[2], pad + w1 + gap, curY, w2, 75, frameColor);
    curY += 81;
  }
  return curY;
}

// Layout 1: One large + stacked small (Rocky II / RoboCop-style)
function layoutAsymmetric(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  count: number,
  _w: number,
  pad: number,
  startY: number,
  usableW: number,
  frameColor: string,
): number {
  let curY = startY;
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, usableW, 170, frameColor);
    curY += 176;
  } else if (count === 2) {
    // Large left, small right
    const largeW = Math.round(usableW * 0.62);
    const smallW = usableW - largeW - 6;
    drawFramedImage(tc, imgs[0], pad, curY, largeW, 160, frameColor);
    drawFramedImage(
      tc,
      imgs[1],
      pad + largeW + 6,
      curY + 40,
      smallW,
      100,
      frameColor,
    );
    curY += 166;
  } else {
    // Large left, two small stacked right
    const largeW = Math.round(usableW * 0.6);
    const smallW = usableW - largeW - 6;
    const largeH = 170;
    drawFramedImage(tc, imgs[0], pad, curY, largeW, largeH, frameColor);
    const smallH = Math.floor((largeH - 6) / 2);
    drawFramedImage(
      tc,
      imgs[1],
      pad + largeW + 6,
      curY,
      smallW,
      smallH,
      frameColor,
    );
    drawFramedImage(
      tc,
      imgs[2],
      pad + largeW + 6,
      curY + smallH + 6,
      smallW,
      smallH,
      frameColor,
    );
    curY += largeH + 6;
  }
  return curY;
}

// Layout 2: Left column gallery (Jedi / Predator-style)
function layoutSidebar(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  count: number,
  pad: number,
  startY: number,
  usableW: number,
  frameColor: string,
): number {
  let curY = startY;
  const colW = Math.round(usableW * 0.48);
  if (count === 1) {
    drawFramedImage(tc, imgs[0], pad, curY, colW, 175, frameColor);
    curY += 181;
  } else if (count === 2) {
    drawFramedImage(tc, imgs[0], pad, curY, colW, 110, frameColor);
    drawFramedImage(tc, imgs[1], pad, curY + 116, colW, 90, frameColor);
    curY += 212;
  } else {
    // Three images: two tall in left column, one wide spanning bottom
    drawFramedImage(tc, imgs[0], pad, curY, colW, 100, frameColor);
    const rightW = usableW - colW - 6;
    drawFramedImage(
      tc,
      imgs[1],
      pad + colW + 6,
      curY + 20,
      rightW,
      110,
      frameColor,
    );
    curY += 136;
    const wideW = Math.round(usableW * 0.7);
    drawFramedImage(tc, imgs[2], pad, curY, wideW, 70, frameColor);
    curY += 76;
  }
  return curY;
}

// Layout 3: Scattered/diagonal (Back to the Future / Ghostbusters-style)
function layoutScattered(
  tc: CanvasRenderingContext2D,
  imgs: HTMLImageElement[],
  count: number,
  _w: number,
  pad: number,
  startY: number,
  usableW: number,
  frameColor: string,
): number {
  let curY = startY;
  if (count === 1) {
    const imgW = Math.round(usableW * 0.8);
    drawFramedImage(
      tc,
      imgs[0],
      pad + Math.round((usableW - imgW) / 2),
      curY,
      imgW,
      140,
      frameColor,
    );
    curY += 146;
  } else if (count === 2) {
    // Diagonal offset
    const imgW = Math.round(usableW * 0.55);
    drawFramedImage(tc, imgs[0], pad, curY, imgW, 110, frameColor);
    drawFramedImage(
      tc,
      imgs[1],
      pad + usableW - imgW,
      curY + 30,
      imgW,
      110,
      frameColor,
    );
    curY += 146;
  } else {
    // Top-left, top-right (offset down), bottom center (wide)
    const topW = Math.round(usableW * 0.5);
    drawFramedImage(tc, imgs[0], pad, curY, topW, 100, frameColor);
    const rightW = Math.round(usableW * 0.46);
    drawFramedImage(
      tc,
      imgs[1],
      pad + usableW - rightW,
      curY + 20,
      rightW,
      100,
      frameColor,
    );
    curY += 126;
    const botW = Math.round(usableW * 0.65);
    drawFramedImage(
      tc,
      imgs[2],
      pad + Math.round((usableW - botW) / 2),
      curY,
      botW,
      65,
      frameColor,
    );
    curY += 71;
  }
  return curY;
}

// ---- SPINE ----

function drawSpine(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  data: VHSCoverData,
  template: VHSTemplate,
) {
  blitFlipped(ctx, region, (tc, w, h) => {
    const { film } = data;

    // Background gradient
    const grad = tc.createLinearGradient(0, 0, w, 0);
    if (template.spineBg.length >= 3) {
      grad.addColorStop(0, template.spineBg[0]);
      grad.addColorStop(0.5, template.spineBg[1]);
      grad.addColorStop(1, template.spineBg[2]);
    } else {
      grad.addColorStop(0, template.spineBg[0]);
      grad.addColorStop(1, template.spineBg[1] || template.spineBg[0]);
    }
    tc.fillStyle = grad;
    tc.fillRect(0, 0, w, h);

    // Side accent lines
    tc.fillStyle = template.spineAccent;
    tc.fillRect(0, 0, 1, h);
    tc.fillRect(w - 1, 0, 1, h);

    enableTextShadow(tc);

    // Studio logo (top of spine, horizontal)
    if (data.studioLogos.length > 0) {
      const studioLogo = data.studioLogos[0].img;
      tc.save();
      disableShadow(tc);
      tc.translate(w / 2, 50);
      // Horizontal logo — constrained by spine width
      const aspect = studioLogo.width / studioLogo.height;
      const maxLW = w - 12; // fit within spine width
      const maxLH = 50; // don't take too much vertical space
      let lW = maxLW;
      let lH = lW / aspect;
      if (lH > maxLH) {
        lH = maxLH;
        lW = lH * aspect;
      }
      // Adaptive contrast: inverts monochrome logos when invisible on dark spine
      drawLogoAdaptive(tc, studioLogo, -lW / 2, -lH / 2, lW, lH, isTemplateBgDark(template.spineBg));
      enableTextShadow(tc);
      tc.restore();
    } else if (data.studioName) {
      // Fallback: studio name as text
      tc.save();
      tc.translate(w / 2, 50);
      // No rotation — text horizontal
      tc.font = "bold 11px sans-serif";
      tc.fillStyle = template.spineAccent;
      tc.textAlign = "center";
      tc.textBaseline = "middle";
      tc.fillText(data.studioName.toUpperCase(), 0, 0);
      tc.restore();
    }

    // Title (center of spine — logo if available, adaptive text fallback)
    // 20px margin from studio logo zone (top ~95px) and VHS block zone (bottom ~h-117)
    enableLightTextShadow(tc);
    if (data.logoImg) {
      // Draw official movie logo rotated on spine
      tc.save();
      tc.translate(w / 2, h / 2);
      tc.rotate(Math.PI / 2);
      const logoAspect = data.logoImg.width / data.logoImg.height;
      const maxLogoW = h - 212;
      const maxLogoH = w - 16;
      let logoW = maxLogoW;
      let logoH = logoW / logoAspect;
      if (logoH > maxLogoH) {
        logoH = maxLogoH;
        logoW = logoH * logoAspect;
      }
      tc.drawImage(data.logoImg, -logoW / 2, -logoH / 2, logoW, logoH);
      tc.restore();
    } else {
      // Fallback: adaptive font size text with offset-print emboss effect
      tc.save();
      tc.translate(w / 2, h / 2);
      tc.rotate(Math.PI / 2);
      tc.textAlign = "center";
      tc.textBaseline = "middle";
      const spineTitle = film.title.toUpperCase();
      const maxTitleWidth = h - 212;
      const MIN_SPINE_FONT = 14;
      const MAX_SPINE_FONT = 38;
      let spineFontSize = MAX_SPINE_FONT;
      tc.font = `bold ${spineFontSize}px sans-serif`;
      while (
        tc.measureText(spineTitle).width > maxTitleWidth &&
        spineFontSize > MIN_SPINE_FONT
      ) {
        spineFontSize--;
        tc.font = `bold ${spineFontSize}px sans-serif`;
      }

      // Offset-print emboss: shadow pass (depth)
      disableShadow(tc);
      tc.fillStyle = "rgba(0,0,0,0.55)";
      tc.fillText(spineTitle, 1.5, 1.5);

      // Highlight pass (catch light on raised edge)
      tc.fillStyle = "rgba(255,255,255,0.12)";
      tc.fillText(spineTitle, -1, -1);

      // Main text — off-white to prevent bloom blowout under fill lights
      tc.fillStyle = "#d8d8d8";
      tc.fillText(spineTitle, 0, 0);
      tc.restore();
    }

    enableTextShadow(tc);

    // VHS Hi-Fi Stereo logo (bottom of spine)
    drawVHSHiFiBlock(tc, w / 2, h - 72, template.spineAccent, w);
  });
}

// ---- BUMP MAP generators (white = raised, black = flat) ----
// NOTE: Spine bump is captured during drawSpine() via blitFlipped's bumpCtx parameter
function drawSpineBump(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
  data: VHSCoverData,
  _template: VHSTemplate,
) {
  blitFlipped(ctx, region, (tc, w, h) => {
    // Draw on TRANSPARENT canvas (blitFlipped clears for us)
    // Then convert all content to white silhouette for consistent bump height

    const { film } = data;

    // Title (center of spine) — same coords as drawSpine()
    if (data.logoImg) {
      tc.save();
      tc.translate(w / 2, h / 2);
      tc.rotate(Math.PI / 2);
      const logoAspect = data.logoImg.width / data.logoImg.height;
      const maxLogoW = h - 212;
      const maxLogoH = w - 16;
      let logoW = maxLogoW;
      let logoH = logoW / logoAspect;
      if (logoH > maxLogoH) {
        logoH = maxLogoH;
        logoW = logoH * logoAspect;
      }
      tc.drawImage(data.logoImg, -logoW / 2, -logoH / 2, logoW, logoH);
      tc.restore();
    } else {
      tc.save();
      tc.translate(w / 2, h / 2);
      tc.rotate(Math.PI / 2);
      tc.fillStyle = "#ffffff";
      tc.textAlign = "center";
      tc.textBaseline = "middle";
      const spineTitle = film.title.toUpperCase();
      const maxTitleWidth = h - 212;
      const MIN_SPINE_FONT = 14;
      const MAX_SPINE_FONT = 38;
      let spineFontSize = MAX_SPINE_FONT;
      tc.font = `bold ${spineFontSize}px sans-serif`;
      while (
        tc.measureText(spineTitle).width > maxTitleWidth &&
        spineFontSize > MIN_SPINE_FONT
      ) {
        spineFontSize--;
        tc.font = `bold ${spineFontSize}px sans-serif`;
      }
      tc.fillText(spineTitle, 0, 0);
      tc.restore();
    }

    // VHS Hi-Fi Stereo logo (bottom) — same coords as drawSpine()
    drawVHSHiFiBlock(tc, w / 2, h - 72, "#ffffff", w);

    // Studio logo or text (top) — same coords as drawSpine()
    if (data.studioLogos.length > 0) {
      const studioLogo = data.studioLogos[0].img;
      tc.save();
      tc.translate(w / 2, 50);
      const aspect = studioLogo.width / studioLogo.height;
      const maxLW = w - 12;
      const maxLH = 50;
      let lW = maxLW;
      let lH = lW / aspect;
      if (lH > maxLH) {
        lH = maxLH;
        lW = lH * aspect;
      }
      tc.drawImage(studioLogo, -lW / 2, -lH / 2, lW, lH);
      tc.restore();
    } else if (data.studioName) {
      tc.save();
      tc.translate(w / 2, 50);
      tc.font = "bold 11px sans-serif";
      tc.fillStyle = "#ffffff";
      tc.textAlign = "center";
      tc.textBaseline = "middle";
      tc.fillText(data.studioName.toUpperCase(), 0, 0);
      tc.restore();
    }

    // Convert all drawn content to white silhouette (consistent bump regardless of logo colors)
    tc.globalCompositeOperation = "source-atop";
    tc.fillStyle = "#ffffff";
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "source-over";

    // Fill black behind all content (flat = no bump)
    tc.globalCompositeOperation = "destination-over";
    tc.fillStyle = "#000000";
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "source-over";
  });
}

function drawFrontBump(
  ctx: CanvasRenderingContext2D,
  data: VHSCoverData,
  _template: VHSTemplate,
  info: FrontTitleBumpInfo,
) {
  blitFlipped(ctx, FRONT, (tc, w, h) => {
    const studioNameUpper = data.studioName?.toUpperCase();
    const topThreshold = h * 0.2; // top 20% of face = studio + actors zone

    // 1. Draw text at per-zone gray levels (no gradient — discrete per-op)
    for (const op of info.textOps) {
      tc.font = op.font;
      tc.textAlign = op.align;
      if (studioNameUpper && op.text === studioNameUpper) {
        // Studio name: 50% reduction
        tc.fillStyle = "#555555";
      } else if (op.y < topThreshold) {
        // Top section (actors): 30% reduction
        tc.fillStyle = "#777777";
      } else if (op.text.includes("\u2022")) {
        // Genre line (contains bullet separator): 50% reduction + 10% boost
        tc.fillStyle = "#606060";
      } else {
        // Everything else: standard bump
        tc.fillStyle = "#aaaaaa";
      }
      tc.fillText(op.text, op.x, op.y);
    }

    // 4. Overdraw title at full white (#ffffff → full 1.5 effective bump)
    const {
      x: titleX,
      y: titleY,
      maxW: titleMaxW,
      fontSize: titleFontSize,
      align: titleAlign,
      maxLines: titleMaxLines,
    } = info;
    if (data.logoImg) {
      const logoAspect = data.logoImg.width / data.logoImg.height;
      let logoW = titleMaxW;
      let logoH = logoW / logoAspect;
      const maxH = titleFontSize * titleMaxLines * 1.4;
      if (logoH > maxH) {
        logoH = maxH;
        logoW = logoH * logoAspect;
      }
      const drawX = titleAlign === "center" ? titleX - logoW / 2 : titleX;
      tc.drawImage(data.logoImg, drawX, titleY, logoW, logoH);
    } else {
      tc.font = `bold ${titleFontSize}px sans-serif`;
      tc.fillStyle = "#ffffff";
      tc.textAlign = titleAlign;
      const lines = wrapText(
        tc,
        data.film.title.toUpperCase(),
        titleMaxW,
        titleMaxLines,
      );
      let dy = 0;
      const lineH = Math.round(titleFontSize * 1.2);
      for (const line of lines) {
        tc.fillText(line, titleX, titleY + titleFontSize + dy);
        dy += lineH;
      }
    }

    // 5. Black background behind everything (flat = no bump)
    tc.globalCompositeOperation = "destination-over";
    tc.fillStyle = "#000000";
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "source-over";
  });
}

// Credit labels and review markers used to identify low-bump text on the back cover
const CREDIT_PREFIXES = [
  "Avec ",
  "\u00c9galement ",
  "R\u00e9alis\u00e9 par ",
  "Distribution ",
  "Production ",
  "Produit par ",
  "\u00c9crit par ",
  "Musique ",
];

function isBackCreditOrReview(text: string): boolean {
  // Review quote lines (« ... ») and author attribution (— ...)
  if (text.startsWith("\u00ab") || text.startsWith("\u2014")) return true;
  // Credit labels and their values (9px font lines in the credits block)
  for (const prefix of CREDIT_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  return false;
}

function drawBackBump(ctx: CanvasRenderingContext2D, textOps: TextBumpOp[]) {
  blitFlipped(ctx, BACK, (tc, w, h) => {
    // Replay all recorded back cover text with per-op bump levels
    for (const op of textOps) {
      tc.font = op.font;
      tc.textAlign = op.align;
      if (isBackCreditOrReview(op.text)) {
        // Credits + review: 50% of standard back bump (#555555 → #2a2a2a)
        tc.fillStyle = "#2a2a2a";
      } else {
        // Everything else (synopsis, headers, branding): standard back bump
        tc.fillStyle = "#555555";
      }
      tc.fillText(op.text, op.x, op.y);
    }

    // Black background (flat = no bump)
    tc.globalCompositeOperation = "destination-over";
    tc.fillStyle = "#000000";
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "source-over";
  });
}

// ---- EDGES ----

function drawEdge(
  ctx: CanvasRenderingContext2D,
  region: { x: number; y: number; w: number; h: number },
) {
  const grad = ctx.createLinearGradient(
    region.x,
    region.y,
    region.x,
    region.y + region.h,
  );
  grad.addColorStop(0, "#0a0a15");
  grad.addColorStop(1, "#060610");
  ctx.fillStyle = grad;
  ctx.fillRect(region.x, region.y, region.w, region.h);
}

// ---- BARCODE ----

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filmId: number = 0,
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000000";
  let cx = x + 4;
  const endX = x + w - 4;
  // Seed with film ID for unique barcode per film
  let seed = (filmId * 2654435761) & 0x7fffffff || 42;
  while (cx < endX) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const barW = (seed % 3) + 1;
    const gap = (seed % 2) + 1;
    ctx.fillRect(cx, y + 3, barW, h - 10);
    cx += barW + gap;
  }
  // Film-specific EAN number
  const ean = `8 ${String(filmId).padStart(6, "0").substring(0, 6)} ${String((filmId * 7 + 13) % 1000000).padStart(6, "0")}`;
  ctx.font = "8px monospace";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.fillText(ean, x + w / 2, y + h - 1);
}
