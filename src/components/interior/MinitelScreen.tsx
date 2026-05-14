import { useMemo, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { searchFilms } from '../../utils/minitelSearch'
import { aisleLabel, cassetteKeyToHumanLocation } from '../../utils/cassetteLocation'
import { getCassetteWorldPosition } from '../../utils/cassetteRegistry'
import type { AisleType, Film } from '../../types'

const SCREEN_W = 512
const SCREEN_H = 384 // 4:3
// Object_73 wraps around the whole CRT tube: the bezel + visible face share
// the SAME texture. Anything drawn past the visible-face UV bounds re-appears
// on the side curve and zigzags off the screen. Empirically the visible face
// covers roughly canvas x ∈ [0, 300]; PADDING_R = 210 keeps wide strokes
// (header rule, input border) inside that band.
const PADDING_R = 210

// Authentic Videotex palette — 8 colors, saturated, period-faithful. Drawn
// from the real Minitel character set (cf. screens like CLUB MEDITERRANEE).
// Buttons reuse these via inverse-video (solid block + black text).
const PALETTE = {
  BG:      '#000000',
  WHITE:   '#FFFFFF',
  BLUE:    '#4FA8FF', // phosphor-blue — main text, body copy
  CYAN:    '#4FF0E8', // title bars, focus accent
  GREEN:   '#4FF04F', // numbered badges, DISPO status
  YELLOW:  '#FFE74C', // section labels, focus row
  MAGENTA: '#FF52C0', // COMMANDER, nouveauté
  RED:     '#E63B3B', // DEMANDE, error
} as const

// Backward-compat aliases for any draw code still referencing the old names.
// New code should read PALETTE.* directly.
const COLOR_BG = PALETTE.BG
const COLOR_TEXT = PALETTE.BLUE       // main body text → phosphor-blue
const COLOR_ACCENT = PALETTE.CYAN
const COLOR_DIM = 'rgba(79, 168, 255, 0.55)' // dimmed blue (kept as rgba for canvas)

// Visual tokens tuned per input type. Mobile gets larger touch targets, more
// vertical spacing between selectable items, and a bigger font so tapping
// isn't ambiguous when the camera is zoomed in (dist 0.13m).
interface Tokens {
  padding: number
  safeRight: number
  lineH: number
  font: string
  headerFont: string
  smallFont: string
  pillPadX: number
  pillPadY: number
  itemGap: number   // extra px between selectable list items
  navGap: number    // gap between pills in the nav row
}
// VT323 is a CRT-style bitmap-like font; we keep Courier as a fallback for
// the first paint before document.fonts.load resolves.
const VT_STACK = "'VT323', 'Courier New', monospace"
const DESKTOP_TOKENS: Tokens = {
  padding: 18,
  safeRight: SCREEN_W - PADDING_R,
  lineH: 18,
  font: `18px ${VT_STACK}`,
  headerFont: `18px ${VT_STACK}`,
  smallFont: `14px ${VT_STACK}`,
  pillPadX: 10,
  pillPadY: 4,
  itemGap: 2,
  navGap: 10,
}
const MOBILE_TOKENS: Tokens = {
  padding: 22,
  safeRight: SCREEN_W - PADDING_R,
  lineH: 22,
  font: `22px ${VT_STACK}`,
  headerFont: `22px ${VT_STACK}`,
  smallFont: `16px ${VT_STACK}`,
  pillPadX: 14,
  pillPadY: 8,
  itemGap: 6,
  navGap: 14,
}
// Active tokens — mutated by useMinitelScreenTexture once per render based on
// pointer-coarse media query. There is a single MinitelScreen instance and we
// re-render the whole canvas in one effect, so this avoids the noise of
// threading a Tokens object through every draw function.
let TOK: Tokens = DESKTOP_TOKENS
// Legacy constant aliases — kept as getter-like vars so existing draw code
// reads the active value without explicit `TOK.` everywhere.
let PADDING = TOK.padding
let SAFE_RIGHT = TOK.safeRight
let LINE_H = TOK.lineH
let FONT = TOK.font
let HEADER_FONT = TOK.headerFont
let SMALL_FONT = TOK.smallFont
function setTokens(t: Tokens) {
  TOK = t
  PADDING = t.padding
  SAFE_RIGHT = t.safeRight
  LINE_H = t.lineH
  FONT = t.font
  HEADER_FONT = t.headerFont
  SMALL_FONT = t.smallFont
}

function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(pointer: coarse)')?.matches ?? false
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return coarse
}

// Each clickable item's canvas range. `index` is 1-based (0 reserved for
// back/exit) and matches what handleNumberPress expects in MinitelOverlay.
// xStart/xEnd are optional — when present (e.g. side-by-side buttons), the
// click must match both the Y AND X bands.
export interface HitBox {
  index: number
  yStart: number
  yEnd: number
  xStart?: number
  xEnd?: number
}

// 7 fits comfortably above the bezel curve (visible bottom of the CRT mesh
// is ≈ y=305). 8 was overflowing the pagination strip into the curve.
const PAGE_SIZE = 7
// RECHERCHE shows fewer rows because the TITRE input + label above push the
// list start ~40 px lower than the generic paginated screens.
const RECHERCHE_PAGE_SIZE = 6
const AISLES_ORDER: AisleType[] = [
  'action', 'aventure', 'bizarre', 'classiques', 'comedie',
  'drame', 'horreur', 'policier', 'romance', 'sf',
  'thriller', 'animation', 'nouveautes',
] as AisleType[]

// Cyan inverse-video title bar that spans the full safe width. The black "F"
// in the top-right is a small nod to the real Minitel screens (TF1's France
// channel indicator on the original videotex pages).
function drawHeader(ctx: CanvasRenderingContext2D, title: string) {
  const x = PADDING - 4
  const w = SAFE_RIGHT - x + 4
  const padY = 3
  const h = LINE_H + padY * 2
  ctx.fillStyle = PALETTE.CYAN
  ctx.fillRect(x, PADDING, w, h)
  ctx.fillStyle = PALETTE.BG
  ctx.font = HEADER_FONT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(title, x + 8, PADDING + padY)
  // Right-aligned "F" identifier.
  ctx.textAlign = 'right'
  ctx.fillText('F', x + w - 8, PADDING + padY)
  ctx.textAlign = 'left'
}

function drawFooter(ctx: CanvasRenderingContext2D, text: string) {
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'center'
  ctx.fillText(text, SCREEN_W / 2, SCREEN_H - 8)
  ctx.textAlign = 'left'
}

// Inverse-video pill button: solid colored block + black label, no border.
// `bg` drives the visual semantics (cyan = primary action, green = available,
// magenta = order, red = request, yellow = focus). Hitboxes preserved for
// backward compatibility (no longer wired to the raycaster).
function drawInversePill(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  opts: { x: number; y: number; index: number; bg: string; fg?: string; font?: string },
): { w: number; h: number } {
  const padX = TOK.pillPadX
  const padY = TOK.pillPadY
  ctx.font = opts.font ?? FONT
  const textW = ctx.measureText(label).width
  const btnW = textW + padX * 2
  const btnH = LINE_H + padY * 2
  ctx.fillStyle = opts.bg
  ctx.fillRect(opts.x, opts.y, btnW, btnH)
  ctx.fillStyle = opts.fg ?? PALETTE.BG
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(label, opts.x + padX, opts.y + padY)
  hitboxes.push({
    index: opts.index,
    yStart: opts.y - 2, yEnd: opts.y + btnH + 2,
    xStart: opts.x - 2, xEnd: opts.x + btnW + 2,
  })
  return { w: btnW, h: btnH }
}

// Back-compat: old call sites still ask for "the default cyan pill". Route
// them through drawInversePill with CYAN bg.
function drawPillButton(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  opts: { x: number; y: number; index: number; fillAlpha?: number; bg?: string },
): { w: number; h: number } {
  void opts.fillAlpha
  return drawInversePill(ctx, label, hitboxes, { x: opts.x, y: opts.y, index: opts.index, bg: opts.bg ?? PALETTE.CYAN })
}

function drawBackButton(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  yPos?: number,
  xPos?: number,
  focused?: boolean,
) {
  ctx.font = FONT
  const btnH = LINE_H + TOK.pillPadY * 2
  const x = xPos ?? PADDING
  const y = yPos ?? (SCREEN_H - PADDING - btnH - 36)
  drawInversePill(ctx, label, hitboxes, { x, y, index: 0, bg: focused ? PALETTE.YELLOW : PALETTE.GREEN })
}

// Square green badge with a centered digit, à la Minitel 1-8 menu marker.
// Active = yellow background to signal current focus.
function drawNumberBadge(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: number, y: number,
  active: boolean,
): { w: number; h: number } {
  const w = Math.max(LINE_H + 4, 20)
  // h was LINE_H+4 = 22 → tighter (LINE_H+2 = 20) shaves ~16 px off an 8-row
  // list, keeping the pagination strip above the CRT bezel curve.
  const h = LINE_H + 2
  ctx.fillStyle = active ? PALETTE.YELLOW : PALETTE.GREEN
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = PALETTE.BG
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillText(String(n), x + w / 2, y + 2)
  ctx.textAlign = 'left'
  return { w, h }
}

function drawScanlines(ctx: CanvasRenderingContext2D) {
  // Subtler than before (0.04 → 0.025) — the new VT323 stack is already
  // pixelated enough that aggressive scanlines turn the text muddy.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)'
  for (let y = 0; y < SCREEN_H; y += 3) {
    ctx.fillRect(0, y, SCREEN_W, 1)
  }
}

function drawSommaire(ctx: CanvasRenderingContext2D, highlight: number, hitboxes: HitBox[], focusedTrailing: number) {
  // 1 trailing button (FERMER). 1-based focusedTrailing → boolean.
  const focusBack = focusedTrailing === 1
  drawHeader(ctx, 'VIDEOCLUB SOMMAIRE')
  ctx.textBaseline = 'top'
  let y = PADDING + 44
  const items = [
    'RECHERCHER UN FILM',
    'PARCOURIR LES RAYONS',
    'LISTE ALPHABETIQUE',
    'COMMANDER UN FILM',
  ]
  items.forEach((label, i) => {
    const itemNum = i + 1
    const isHl = itemNum === highlight
    const badge = drawNumberBadge(ctx, itemNum, PADDING, y, isHl)
    // Active row gets a yellow rail behind the label to read as a focus bar.
    const rowH = badge.h
    if (isHl) {
      ctx.fillStyle = PALETTE.YELLOW
      ctx.fillRect(PADDING + badge.w + 4, y, SAFE_RIGHT - (PADDING + badge.w + 4), rowH)
    }
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillStyle = isHl ? PALETTE.BG : PALETTE.BLUE
    ctx.fillText(label, PADDING + badge.w + 10, y + 2)
    hitboxes.push({ index: itemNum, yStart: y - 2, yEnd: y + rowH + 2 })
    y += rowH + 4 + TOK.itemGap
  })
  // Tagline under the menu — phosphor blue, small.
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.fillText('VIDEOCLUB EN LIGNE', PADDING, y + 14)
  // FERMER kept for parity with the bridge (index 0 = back). Focused = yellow.
  drawBackButton(ctx, 'FERMER', hitboxes, y + 36, undefined, focusBack)
}

function drawRecherche(ctx: CanvasRenderingContext2D, query: string, results: Film[], highlight: number, hitboxes: HitBox[], focusedTrailing: number) {
  // 1 trailing button (RETOUR). 1-based focusedTrailing → boolean.
  const focusBack = focusedTrailing === 1
  drawHeader(ctx, 'VIDEOCLUB RECHERCHE')
  // "TITRE :" yellow label, phosphor input on the same row.
  ctx.fillStyle = PALETTE.YELLOW
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillText('TITRE :', PADDING, PADDING + 38)
  ctx.fillStyle = PALETTE.BLUE
  const labelW = ctx.measureText('TITRE :').width + 8
  // Phosphor-blue underline acts as the input field — no border, more period.
  ctx.fillText(`${query || ''}_`, PADDING + labelW, PADDING + 38)
  ctx.fillStyle = PALETTE.BLUE
  ctx.fillRect(PADDING + labelW, PADDING + 38 + LINE_H + 1, SAFE_RIGHT - (PADDING + labelW), 1)

  // RETOUR bg flashes yellow when focused via ↑/↓, red otherwise.
  const retourBg = focusBack ? PALETTE.YELLOW : PALETTE.RED
  const retourFg = focusBack ? PALETTE.BG : PALETTE.WHITE
  ctx.font = SMALL_FONT
  if (!query) {
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('TAPEZ LE TITRE D UN FILM', PADDING, PADDING + 80)
    drawInversePill(ctx, 'RETOUR', hitboxes, { x: PADDING, y: PADDING + 110, index: 0, bg: retourBg, fg: retourFg })
    return
  }
  if (results.length === 0) {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.fillText('AUCUN RESULTAT', PADDING, PADDING + 80)
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('ESSAYEZ COMMANDER UN FILM', PADDING, PADDING + 98)
    drawInversePill(ctx, 'RETOUR', hitboxes, { x: PADDING, y: PADDING + 128, index: 0, bg: retourBg, fg: retourFg })
    return
  }
  ctx.fillStyle = COLOR_DIM
  ctx.fillText(`${results.length} RESULTATS`, PADDING, PADDING + 80)
  let y = PADDING + 100
  results.slice(0, RECHERCHE_PAGE_SIZE).forEach((f, i) => {
    const num = i + 1
    const isHl = num === highlight
    const badge = drawNumberBadge(ctx, num, PADDING, y, isHl)
    const rowH = badge.h
    if (isHl) {
      ctx.fillStyle = PALETTE.YELLOW
      ctx.fillRect(PADDING + badge.w + 4, y, SAFE_RIGHT - (PADDING + badge.w + 4), rowH)
    }
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillStyle = isHl ? PALETTE.BG : PALETTE.BLUE
    ctx.fillText(f.title.slice(0, 28), PADDING + badge.w + 10, y + 2)
    hitboxes.push({ index: num, yStart: y - 2, yEnd: y + rowH + 2 })
    y += rowH + 1 + TOK.itemGap
  })
  drawInversePill(ctx, 'RETOUR', hitboxes, { x: PADDING, y: y + 8, index: 0, bg: retourBg, fg: retourFg })
}

// Shared row renderer for the paginated lists: green numbered badge + label
// + optional right-aligned suffix (count for rayons, year for film lists).
function drawListRow(
  ctx: CanvasRenderingContext2D,
  num: number,
  label: string,
  suffix: string,
  isHl: boolean,
  y: number,
  hitboxes: HitBox[],
): number {
  const badge = drawNumberBadge(ctx, num, PADDING, y, isHl)
  const rowH = badge.h
  const labelX = PADDING + badge.w + 10
  if (isHl) {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.fillRect(PADDING + badge.w + 4, y, SAFE_RIGHT - (PADDING + badge.w + 4), rowH)
  }
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillStyle = isHl ? PALETTE.BG : PALETTE.BLUE
  ctx.fillText(label.slice(0, 22), labelX, y + 2)
  if (suffix) {
    ctx.textAlign = 'right'
    ctx.fillStyle = isHl ? PALETTE.BG : COLOR_DIM
    ctx.fillText(suffix, SAFE_RIGHT - 4, y + 2)
    ctx.textAlign = 'left'
  }
  hitboxes.push({ index: num, yStart: y - 2, yEnd: y + rowH + 2 })
  return rowH
}

function drawPaginationStrip(ctx: CanvasRenderingContext2D, page: number, totalPages: number, y: number, hitboxes: HitBox[], focusedTrailing: number) {
  // Trailing buttons rendered for this page: PREC (if page>0), SUIV (if not
  // last), RETOUR (always). focusedTrailing is 1-based and indexes into the
  // same order, so ↓ from the last list row lands on the first trailing
  // button (PREC if any, otherwise SUIV, otherwise RETOUR).
  const order: Array<'prev' | 'next' | 'back'> = []
  if (page > 0) order.push('prev')
  if (page < totalPages - 1) order.push('next')
  order.push('back')
  const focused = order[focusedTrailing - 1] // undefined when a list row is focused

  let x = PADDING
  if (page > 0) {
    const bg = focused === 'prev' ? PALETTE.YELLOW : PALETTE.CYAN
    const r = drawInversePill(ctx, '< PREC', hitboxes, { x, y, index: -1, bg })
    x += r.w + TOK.navGap
  }
  if (page < totalPages - 1) {
    const bg = focused === 'next' ? PALETTE.YELLOW : PALETTE.CYAN
    const r = drawInversePill(ctx, 'SUIV >', hitboxes, { x, y, index: -2, bg })
    x += r.w + TOK.navGap
  }
  ctx.font = FONT
  const retourW = ctx.measureText('RETOUR').width + TOK.pillPadX * 2
  const bg = focused === 'back' ? PALETTE.YELLOW : PALETTE.RED
  const fg = focused === 'back' ? PALETTE.BG : PALETTE.WHITE
  drawInversePill(ctx, 'RETOUR', hitboxes, { x: SAFE_RIGHT - retourW, y, index: 0, bg, fg })
}

function drawRayons(ctx: CanvasRenderingContext2D, films: Record<string, Film[]>, page: number, highlight: number, hitboxes: HitBox[], focusedTrailing: number) {
  // Build the list of non-empty aisles first so pagination math is correct
  // (some aisles might have 0 films at this point in the catalogue lifecycle).
  const nonEmpty = AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0)
  const totalPages = Math.max(1, Math.ceil(nonEmpty.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  const slice = nonEmpty.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  drawHeader(ctx, `VIDEOCLUB RAYONS ${safePage + 1}/${totalPages}`)
  let y = PADDING + 40
  slice.forEach((a, i) => {
    const num = i + 1
    const count = films[a]!.length
    const rowH = drawListRow(ctx, num, aisleLabel(a).toUpperCase(), `${count} FILMS`, num === highlight, y, hitboxes)
    y += rowH + 1 + TOK.itemGap
  })
  drawPaginationStrip(ctx, safePage, totalPages, y + 8, hitboxes, focusedTrailing)
}

function drawAlpha(ctx: CanvasRenderingContext2D, films: Film[], page: number, highlight: number, hitboxes: HitBox[], focusedTrailing: number) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `VIDEOCLUB A-Z ${safePage + 1}/${totalPages}`)
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 40
  slice.forEach((f, i) => {
    const num = i + 1
    const year = f.release_date ? f.release_date.slice(0, 4) : ''
    const rowH = drawListRow(ctx, num, f.title, year, num === highlight, y, hitboxes)
    y += rowH + 1 + TOK.itemGap
  })
  drawPaginationStrip(ctx, safePage, totalPages, y + 8, hitboxes, focusedTrailing)
}

function drawAisleList(ctx: CanvasRenderingContext2D, aisle: AisleType, films: Film[], page: number, highlight: number, hitboxes: HitBox[], focusedTrailing: number) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `VIDEOCLUB ${aisleLabel(aisle).toUpperCase()} ${safePage + 1}/${totalPages}`)
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 40
  slice.forEach((f, i) => {
    const num = i + 1
    const year = f.release_date ? f.release_date.slice(0, 4) : ''
    const rowH = drawListRow(ctx, num, f.title, year, num === highlight, y, hitboxes)
    y += rowH + 1 + TOK.itemGap
  })
  drawPaginationStrip(ctx, safePage, totalPages, y + 8, hitboxes, focusedTrailing)
}

function drawDetail(ctx: CanvasRenderingContext2D, film: Film, location: string, hitboxes: HitBox[], illuminerPressed: boolean, focusPrimary: boolean, focusBack: boolean) {
  drawHeader(ctx, 'VIDEOCLUB DETAIL')
  // Title in cyan, year + cert in dim phosphor underneath.
  ctx.fillStyle = PALETTE.CYAN
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillText(film.title.slice(0, 28), PADDING, PADDING + 38)
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  const year = film.release_date ? film.release_date.slice(0, 4) : ''
  if (year) ctx.fillText(year, PADDING, PADDING + 60)

  let yCursor = PADDING + 80
  // AVEC : label yellow, actor list phosphor blue. Wrap kept 32 because the
  // "AVEC " prefix already eats 40 px of horizontal space.
  if (film.actors && film.actors.length > 0) {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.font = SMALL_FONT
    ctx.fillText('AVEC', PADDING, yCursor)
    ctx.fillStyle = PALETTE.BLUE
    const wrapped = wrapText(film.actors.slice(0, 3).join(', '), 32)
    let yy = yCursor
    for (const l of wrapped.slice(0, 2)) {
      ctx.fillText(l, PADDING + 40, yy)
      yy += 14
    }
    yCursor = yy + 6
  }
  // SYNOPSIS yellow label, body phosphor blue.
  // Detail view exclusively uses a wider wrap (46 vs 32 chars) and shows up
  // to 5 lines instead of 3 — VT323 at 14 px is narrow enough that 46 chars
  // (~+20 % horizontal vs the previous 38) stays within the visible face of
  // the CRT mesh. Past ≈48 chars the texture starts wrapping onto the bezel.
  const pitch = (film.tagline && film.tagline.trim()) || (film.overview ? film.overview : '')
  if (pitch) {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.font = SMALL_FONT
    ctx.fillText('SYNOPSIS', PADDING, yCursor)
    yCursor += 16
    ctx.fillStyle = PALETTE.BLUE
    const wrapped = wrapText(pitch, 46)
    for (const l of wrapped.slice(0, 5)) {
      ctx.fillText(l, PADDING, yCursor)
      yCursor += 16
    }
  }
  yCursor += 6
  // LOCALISATION yellow label, value cyan.
  ctx.fillStyle = PALETTE.YELLOW
  ctx.font = SMALL_FONT
  ctx.fillText('RAYON', PADDING, yCursor)
  yCursor += 16
  ctx.fillStyle = PALETTE.CYAN
  const locLines = wrapText(location, 38)
  for (const l of locLines.slice(0, 2)) {
    ctx.fillText(l, PADDING, yCursor)
    yCursor += 16
  }
  // ILLUMINER (magenta) + RETOUR (red) — inverse-video pills side by side.
  // ILLUMINER flashes to yellow on press AND on keyboard focus so the active
  // pill is unmistakable. RETOUR also turns yellow when focused.
  yCursor += 8
  const illumBg = (illuminerPressed || focusPrimary) ? PALETTE.YELLOW : PALETTE.MAGENTA
  const r1 = drawInversePill(ctx, 'ILLUMINER LA K7', hitboxes, {
    x: PADDING, y: yCursor, index: 1, bg: illumBg, fg: PALETTE.BG,
  })
  const retourBg = focusBack ? PALETTE.YELLOW : PALETTE.RED
  const retourFg = focusBack ? PALETTE.BG : PALETTE.WHITE
  drawInversePill(ctx, 'RETOUR', hitboxes, {
    x: PADDING + r1.w + 8, y: yCursor, index: 0, bg: retourBg, fg: retourFg,
  })
}

type TmdbState = 'idle' | 'pending' | 'ok' | 'empty' | 'error'
// Compact pill drawn on the right of each commander row. Smaller than
// drawPillButton (no shadow, tighter padding) so it fits within SAFE_RIGHT.
function drawRowPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  opts: { x: number; y: number; index: number | null; clickable: boolean; bg: string; fg?: string },
): { w: number; h: number } {
  const padX = 6
  const padY = 2
  ctx.font = SMALL_FONT
  const textW = ctx.measureText(label).width
  const btnW = textW + padX * 2
  const btnH = 16
  ctx.fillStyle = opts.clickable ? opts.bg : 'rgba(79, 168, 255, 0.18)'
  ctx.fillRect(opts.x, opts.y, btnW, btnH)
  ctx.fillStyle = opts.clickable ? (opts.fg ?? PALETTE.BG) : COLOR_DIM
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(label, opts.x + padX, opts.y + padY)
  if (opts.clickable && opts.index != null) {
    hitboxes.push({
      index: opts.index,
      yStart: opts.y - 2, yEnd: opts.y + btnH + 2,
      xStart: opts.x - 2, xEnd: opts.x + btnW + 2,
    })
  }
  return { w: btnW, h: btnH }
}

function drawCommander(
  ctx: CanvasRenderingContext2D,
  query: string,
  results: Array<{ id: number; title: string; release_date?: string }>,
  requested: Set<number>,
  authed: boolean,
  tmdbState: TmdbState,
  localTmdbIds: Set<number>,
  hitboxes: HitBox[],
  highlight: number,
  focusPrimary: boolean,
  focusBack: boolean,
) {
  void highlight // results row focus is already handled via the per-row drawRowPill highlight
  drawHeader(ctx, 'VIDEOCLUB COMMANDER')
  ctx.font = FONT
  ctx.textBaseline = 'top'
  if (!authed) {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.fillText('CONNECTEZ-VOUS POUR', PADDING, PADDING + 44)
    ctx.fillText('COMMANDER UN FILM', PADDING, PADDING + 64)
    ctx.fillStyle = COLOR_DIM
    ctx.font = SMALL_FONT
    ctx.fillText('SE CONNECTER OUVRE LA FENETRE', PADDING, PADDING + 96)
    ctx.fillText('DE LOGIN INLINE.', PADDING, PADDING + 112)
    const connectBg = focusPrimary ? PALETTE.YELLOW : PALETTE.MAGENTA
    const retourBg = focusBack ? PALETTE.YELLOW : PALETTE.RED
    const retourFg = focusBack ? PALETTE.BG : PALETTE.WHITE
    const r = drawInversePill(ctx, 'SE CONNECTER', hitboxes, { x: PADDING, y: PADDING + 132, index: 1, bg: connectBg })
    drawInversePill(ctx, 'RETOUR', hitboxes, { x: PADDING + r.w + 8, y: PADDING + 132, index: 0, bg: retourBg, fg: retourFg })
    return
  }
  // TITRE: label + phosphor input on the same line as recherche.
  ctx.fillStyle = PALETTE.YELLOW
  ctx.font = FONT
  ctx.fillText('TITRE :', PADDING, PADDING + 38)
  const labelW = ctx.measureText('TITRE :').width + 8
  ctx.fillStyle = PALETTE.BLUE
  ctx.fillText(`${query || ''}_`, PADDING + labelW, PADDING + 38)
  ctx.fillRect(PADDING + labelW, PADDING + 38 + LINE_H + 1, SAFE_RIGHT - (PADDING + labelW), 1)

  // RETOUR pinned top-right — yellow on focus, red otherwise.
  ctx.font = FONT
  const retourPillW = ctx.measureText('RETOUR').width + TOK.pillPadX * 2
  const retourBgAuth = focusBack ? PALETTE.YELLOW : PALETTE.RED
  const retourFgAuth = focusBack ? PALETTE.BG : PALETTE.WHITE
  drawInversePill(ctx, 'RETOUR', hitboxes, {
    x: SAFE_RIGHT - retourPillW,
    y: PADDING + LINE_H + 12,
    index: 0,
    bg: retourBgAuth,
    fg: retourFgAuth,
  })

  ctx.font = SMALL_FONT
  if (tmdbState === 'idle' || !query) {
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('TAPEZ LE TITRE A COMMANDER', PADDING, PADDING + 78)
    return
  }
  if (tmdbState === 'pending') {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.fillText('RECHERCHE EN COURS...', PADDING, PADDING + 78)
    return
  }
  if (tmdbState === 'error') {
    ctx.fillStyle = PALETTE.RED
    ctx.fillText('ERREUR DE CONNEXION TMDB', PADDING, PADDING + 78)
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('REESSAYEZ PLUS TARD.', PADDING, PADDING + 94)
    return
  }
  if (tmdbState === 'empty') {
    ctx.fillStyle = PALETTE.YELLOW
    ctx.fillText('AUCUN RESULTAT', PADDING, PADDING + 78)
    return
  }
  // tmdbState === 'ok'
  ctx.fillStyle = COLOR_DIM
  ctx.fillText(`${results.length} RESULTATS`, PADDING, PADDING + 78)
  let y = PADDING + 100
  // Pre-compute the pill width to know where to clip the title.
  ctx.font = SMALL_FONT
  const pillSlotW = Math.max(
    ctx.measureText('DISPO').width,
    ctx.measureText('DEMANDE').width,
    ctx.measureText('COMMANDER').width,
  ) + 6 * 2
  const titleMaxX = SAFE_RIGHT - pillSlotW - 8
  results.slice(0, 6).forEach((r, i) => {
    const inLocal = localTmdbIds.has(r.id)
    const isReq = requested.has(r.id)
    const yr = r.release_date ? ` ${r.release_date.slice(0, 4)}` : ''
    ctx.font = FONT
    let text = `${r.title}${yr}`
    while (ctx.measureText(text).width > titleMaxX - PADDING - 4 && text.length > 4) {
      text = text.slice(0, -2)
    }
    if (text !== `${r.title}${yr}`) text = text.slice(0, -1) + '…'
    const dim = inLocal || isReq
    ctx.fillStyle = dim ? COLOR_DIM : PALETTE.BLUE
    ctx.textBaseline = 'top'
    ctx.fillText(text, PADDING, y + 2)
    // Right-aligned status pill: DISPO = green, DEMANDE = red,
    // COMMANDER = magenta. Inverse-video, black text.
    const label = inLocal ? 'DISPO' : isReq ? 'DEMANDE' : 'COMMANDER'
    const bg = inLocal ? PALETTE.GREEN : isReq ? PALETTE.RED : PALETTE.MAGENTA
    const fg = isReq ? PALETTE.WHITE : PALETTE.BG
    ctx.font = SMALL_FONT
    const measuredW = ctx.measureText(label).width + 6 * 2
    drawRowPill(ctx, label, hitboxes, {
      x: SAFE_RIGHT - measuredW,
      y: y,
      index: !inLocal && !isReq ? i + 1 : null,
      clickable: !inLocal && !isReq,
      bg, fg,
    })
    y += LINE_H + 4 + TOK.itemGap
  })
}

function wrapText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).length > max) {
      lines.push(line)
      line = w
    } else {
      line = line ? line + ' ' + w : w
    }
  }
  if (line) lines.push(line)
  return lines
}

// MinitelScreenProps is kept for back-compat — TMDB state now lives in the
// store (minitelTmdbResults / minitelTmdbState / minitelRequestedIds) so the
// canvas sees the same data as MinitelOverlay.
interface MinitelScreenProps {
  tmdbResults?: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null }>
  requestedIds?: Set<number>
}

// Hook for parent components to obtain just the texture without rendering JSX
export function useMinitelScreenTexture(props: MinitelScreenProps = {}) {
  const minitelMode = useStore((s) => s.minitelMode)
  const minitelQuery = useStore((s) => s.minitelQuery)
  const minitelSelectedAisle = useStore((s) => s.minitelSelectedAisle)
  const minitelSelectedFilm = useStore((s) => s.minitelSelectedFilm)
  const minitelPageIndex = useStore((s) => s.minitelPageIndex)
  const minitelHighlightedItem = useStore((s) => s.minitelHighlightedItem)
  const minitelIlluminerFlash = useStore((s) => s.minitelIlluminerFlash)
  const films = useStore((s) => s.films)
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const isMobile = useIsCoarsePointer()
  // VT323 ships from Google Fonts via the <link> in app/layout.tsx. Canvas
  // `ctx.font = '...VT323...'` falls back to monospace until the woff2 is in
  // the document's FontFaceSet, so we explicitly await it and bump a counter
  // that re-triggers the draw effect once it's ready.
  const [fontReadyTick, setFontReadyTick] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    document.fonts.load('18px "VT323"').then(() => {
      if (!cancelled) setFontReadyTick((n) => n + 1)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const storeTmdbResults = useStore((s) => s.minitelTmdbResults)
  const storeRequestedIds = useStore((s) => s.minitelRequestedIds)
  const storeTmdbState = useStore((s) => s.minitelTmdbState)
  const tmdbResults = props.tmdbResults ?? storeTmdbResults
  const requestedIds = props.requestedIds ?? storeRequestedIds

  const allFilms = useMemo<Film[]>(() => {
    const seen = new Set<number>()
    const out: Film[] = []
    for (const list of Object.values(films)) {
      for (const f of list) {
        if (!seen.has(f.id)) { seen.add(f.id); out.push(f) }
      }
    }
    out.sort((a, b) => a.title.localeCompare(b.title))
    return out
  }, [films])

  // Set of TMDB IDs already in the local catalogue — used by commander mode
  // to label rows DISPO vs COMMANDER.
  const localTmdbIds = useMemo<Set<number>>(() => {
    const s = new Set<number>()
    for (const f of allFilms) {
      if (f.tmdb_id) s.add(f.tmdb_id)
    }
    return s
  }, [allFilms])

  const searchResults = useMemo<Film[]>(() => {
    if (minitelMode !== 'recherche' || !minitelQuery.trim()) return []
    return searchFilms(allFilms, minitelQuery)
  }, [minitelMode, minitelQuery, allFilms])

  const detailFilm = useMemo<Film | null>(() => {
    if (minitelSelectedFilm == null) return null
    return allFilms.find((f) => f.id === minitelSelectedFilm) ?? null
  }, [minitelSelectedFilm, allFilms])

  const detailLocation = useMemo<string>(() => {
    if (!detailFilm) return ''
    let inAisle: AisleType | null = null
    let cassetteKey: string | null = null
    for (const [a, list] of Object.entries(films)) {
      if (list.some((f) => f.id === detailFilm.id)) { inAisle = a as AisleType; break }
    }
    if (typeof window !== 'undefined') {
      const map = (window as unknown as { __cassetteFilmIdToKey?: Map<number, string> }).__cassetteFilmIdToKey
      cassetteKey = map?.get(detailFilm.id) ?? null
    }
    if (!inAisle) return 'POSITION INCONNUE'
    if (!cassetteKey) return aisleLabel(inAisle) + ' - POSITION INCONNUE'
    return cassetteKeyToHumanLocation(cassetteKey, inAisle)
  }, [detailFilm, films])

  const aisleFilms = useMemo<Film[]>(() => {
    if (!minitelSelectedAisle) return []
    return [...(films[minitelSelectedAisle] || [])].sort((a, b) => a.title.localeCompare(b.title))
  }, [minitelSelectedAisle, films])

  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = SCREEN_W
    c.height = SCREEN_H
    const t = new THREE.CanvasTexture(c)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.colorSpace = THREE.SRGBColorSpace
    t.flipY = true
    // Without explicit ClampToEdge, the texture repeats — combined with our
    // -0.10 / +0.10 offset that pushed sampling out of [0,1], the same hitbox
    // band can match in several UV regions (visible "ghost" rows on the mesh).
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    return { canvas: c, texture: t }
  }, [])

  const hitboxesRef = useRef<HitBox[]>([])

  useEffect(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Lock the active tokens for this draw pass. All draw helpers read from
    // module-level TOK / aliases (PADDING / LINE_H / FONT etc.).
    setTokens(isMobile ? MOBILE_TOKENS : DESKTOP_TOKENS)
    ctx.fillStyle = COLOR_BG
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    const hits: HitBox[] = []
    // Compute how many list rows the current screen has so we can tell apart
    // a list highlight from a trailing-button highlight (RETOUR / FERMER /
    // SE CONNECTER / ILLUMINER) when drawing focus state.
    let listCount = 0
    if (detailFilm) listCount = 0
    else if (minitelMode === 'sommaire' || minitelMode === 'idle') listCount = 4
    else if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      const nonEmpty = AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).length
      listCount = Math.min(PAGE_SIZE, nonEmpty - minitelPageIndex * PAGE_SIZE)
    }
    else if (minitelMode === 'rayons' && minitelSelectedAisle) listCount = Math.min(PAGE_SIZE, aisleFilms.length - minitelPageIndex * PAGE_SIZE)
    else if (minitelMode === 'alpha') listCount = Math.min(PAGE_SIZE, allFilms.length - minitelPageIndex * PAGE_SIZE)
    else if (minitelMode === 'recherche') listCount = Math.min(RECHERCHE_PAGE_SIZE, searchResults.length)
    else if (minitelMode === 'commander') listCount = isAuthenticated ? Math.min(6, tmdbResults.length) : 0
    // 1-based trailing index of the focused button (0 means a list row is
    // focused). Each draw fn decodes this against its own trailing list.
    const focusedTrailing = Math.max(0, minitelHighlightedItem - listCount)
    // For draws with 2 fixed trailing buttons (detail, commander-unauthed)
    // we keep the simpler focusPrimary / focusBack booleans.
    const focusPrimary = focusedTrailing === 1
    const focusBackSimple = focusedTrailing === 1 && !(detailFilm) && !(minitelMode === 'commander' && !isAuthenticated)
      ? true
      : focusedTrailing === 2

    if (minitelMode === 'idle' || minitelMode === 'sommaire') drawSommaire(ctx, minitelHighlightedItem, hits, focusedTrailing)
    else if (minitelMode === 'recherche') drawRecherche(ctx, minitelQuery, searchResults, minitelHighlightedItem, hits, focusedTrailing)
    else if (minitelMode === 'rayons') {
      if (minitelSelectedAisle) drawAisleList(ctx, minitelSelectedAisle, aisleFilms, minitelPageIndex, minitelHighlightedItem, hits, focusedTrailing)
      else drawRayons(ctx, films, minitelPageIndex, minitelHighlightedItem, hits, focusedTrailing)
    }
    else if (minitelMode === 'alpha') drawAlpha(ctx, allFilms, minitelPageIndex, minitelHighlightedItem, hits, focusedTrailing)
    else if (minitelMode === 'commander') drawCommander(ctx, minitelQuery, tmdbResults, requestedIds, isAuthenticated, storeTmdbState, localTmdbIds, hits, minitelHighlightedItem, focusPrimary, focusBackSimple)
    else if (minitelMode === 'detail') {
      if (detailFilm) drawDetail(ctx, detailFilm, detailLocation, hits, minitelIlluminerFlash, focusPrimary, focusBackSimple)
      else drawSommaire(ctx, minitelHighlightedItem, hits, focusedTrailing)
    }
    drawScanlines(ctx)
    texture.needsUpdate = true
    hitboxesRef.current = hits
  }, [
    canvas, texture, minitelMode, minitelQuery, minitelSelectedAisle,
    minitelPageIndex, minitelHighlightedItem, searchResults, aisleFilms, allFilms, films, detailFilm,
    detailLocation, tmdbResults, requestedIds, storeTmdbState, localTmdbIds, isAuthenticated, isMobile,
    minitelIlluminerFlash, fontReadyTick,
  ])

  // Reference helper for cassette position (used by overlay's "ILLUMINER")
  // Returns the cassetteKey for the currently shown detail film.
  const detailCassetteKey = useMemo<string | null>(() => {
    if (!detailFilm) return null
    if (typeof window === 'undefined') return null
    const map = (window as unknown as { __cassetteFilmIdToKey?: Map<number, string> }).__cassetteFilmIdToKey
    return map?.get(detailFilm.id) ?? null
  }, [detailFilm])

  // Used by overlay "Suite" key to know if more pages exist
  const totalPages = useMemo(() => {
    if (minitelMode === 'alpha') return Math.max(1, Math.ceil(allFilms.length / PAGE_SIZE))
    if (minitelMode === 'rayons' && minitelSelectedAisle) return Math.max(1, Math.ceil(aisleFilms.length / PAGE_SIZE))
    return 1
  }, [minitelMode, minitelSelectedAisle, allFilms, aisleFilms])

  // Used by overlay number-press to map to actual selection
  const selectableItems = useMemo<Array<{ kind: 'film' | 'aisle' | 'tmdb'; id: number | string; title: string }>>(() => {
    if (minitelMode === 'recherche') {
      return searchResults.slice(0, 8).map((f) => ({ kind: 'film' as const, id: f.id, title: f.title }))
    }
    if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      return AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).map((a) => ({ kind: 'aisle' as const, id: a, title: aisleLabel(a) }))
    }
    if (minitelMode === 'rayons' && minitelSelectedAisle) {
      const slice = aisleFilms.slice(minitelPageIndex * PAGE_SIZE, (minitelPageIndex + 1) * PAGE_SIZE)
      return slice.map((f) => ({ kind: 'film' as const, id: f.id, title: f.title }))
    }
    if (minitelMode === 'alpha') {
      const slice = allFilms.slice(minitelPageIndex * PAGE_SIZE, (minitelPageIndex + 1) * PAGE_SIZE)
      return slice.map((f) => ({ kind: 'film' as const, id: f.id, title: f.title }))
    }
    if (minitelMode === 'commander') {
      return tmdbResults.slice(0, 6).map((r) => ({ kind: 'tmdb' as const, id: r.id, title: r.title }))
    }
    return []
  }, [minitelMode, searchResults, aisleFilms, allFilms, minitelPageIndex, minitelSelectedAisle, films, tmdbResults])

  return { texture, detailCassetteKey, totalPages, selectableItems, getCassetteWorldPosition, hitboxesRef, screenWidth: SCREEN_W, screenHeight: SCREEN_H }
}
