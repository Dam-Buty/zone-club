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
const COLOR_BG = '#000010'
const COLOR_TEXT = '#f0f4ff'
const COLOR_ACCENT = '#00fff7'
const COLOR_DIM = 'rgba(240, 244, 255, 0.55)'

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
const DESKTOP_TOKENS: Tokens = {
  padding: 18,
  safeRight: SCREEN_W - PADDING_R,
  lineH: 14,
  font: "bold 13px 'Courier New', monospace",
  headerFont: "bold 11px 'Courier New', monospace",
  smallFont: "10px 'Courier New', monospace",
  pillPadX: 10,
  pillPadY: 4,
  itemGap: 0,
  navGap: 8,
}
const MOBILE_TOKENS: Tokens = {
  padding: 22,
  safeRight: SCREEN_W - PADDING_R,
  lineH: 18,
  font: "bold 16px 'Courier New', monospace",
  headerFont: "bold 13px 'Courier New', monospace",
  smallFont: "12px 'Courier New', monospace",
  pillPadX: 14,
  pillPadY: 8,
  itemGap: 4,
  navGap: 12,
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

const PAGE_SIZE = 8
const AISLES_ORDER: AisleType[] = [
  'action', 'aventure', 'bizarre', 'classiques', 'comedie',
  'drame', 'horreur', 'policier', 'romance', 'sf',
  'thriller', 'animation', 'nouveautes',
] as AisleType[]

function drawHeader(ctx: CanvasRenderingContext2D, title: string) {
  ctx.fillStyle = COLOR_ACCENT
  ctx.font = HEADER_FONT
  ctx.textBaseline = 'top'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 8
  ctx.fillText(title, PADDING, PADDING)
  ctx.shadowBlur = 0
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PADDING, PADDING + 18)
  ctx.lineTo(SAFE_RIGHT, PADDING + 18)
  ctx.stroke()
}

function drawFooter(ctx: CanvasRenderingContext2D, text: string) {
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'center'
  ctx.fillText(text, SCREEN_W / 2, SCREEN_H - 8)
  ctx.textAlign = 'left'
}

// Draws a clickable pill with explicit X+Y hitbox bounds. Used for RETOUR,
// pagination (PREC/SUIV) and other inline controls.
function drawPillButton(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  opts: { x: number; y: number; index: number; fillAlpha?: number },
): { w: number; h: number } {
  const padX = TOK.pillPadX
  const padY = TOK.pillPadY
  ctx.font = FONT
  const textW = ctx.measureText(label).width
  const btnW = textW + padX * 2
  const btnH = LINE_H + padY * 2
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.fillStyle = `rgba(0, 255, 247, ${opts.fillAlpha ?? 0.10})`
  ctx.fillRect(opts.x, opts.y, btnW, btnH)
  ctx.strokeRect(opts.x, opts.y, btnW, btnH)
  ctx.fillStyle = COLOR_ACCENT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 6
  ctx.fillText(label, opts.x + padX, opts.y + padY)
  ctx.shadowBlur = 0
  hitboxes.push({
    index: opts.index,
    yStart: opts.y - 2, yEnd: opts.y + btnH + 2,
    xStart: opts.x - 2, xEnd: opts.x + btnW + 2,
  })
  return { w: btnW, h: btnH }
}

// Back-compat wrapper for the old API used by sommaire/recherche.
function drawBackButton(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  yPos?: number,
  xPos?: number,
) {
  // Approximate the legacy size by computing it first.
  ctx.font = FONT
  const textW = ctx.measureText(label).width
  const btnH = LINE_H + 4 * 2
  const x = xPos ?? (PADDING + 16)
  const y = yPos ?? (SCREEN_H - PADDING - btnH - 36)
  drawPillButton(ctx, label, hitboxes, { x, y, index: 0 })
  // Silence unused warnings for textW (kept for parity).
  void textW
}

// Pagination + back row. Indices: -1 = prev page, -2 = next page, 0 = back.
// Placed on a single row starting at `x` and Y, returns the row height so the
// caller can advance its cursor.
function drawNavRow(
  ctx: CanvasRenderingContext2D,
  hitboxes: HitBox[],
  opts: { x: number; y: number; currentPage: number; totalPages: number; backLabel?: string },
): number {
  const backLabel = opts.backLabel ?? 'RETOUR'
  let cursorX = opts.x
  let rowH = 0
  const gap = TOK.navGap
  if (opts.currentPage > 0) {
    const r = drawPillButton(ctx, '<< PREC', hitboxes, { x: cursorX, y: opts.y, index: -1 })
    cursorX += r.w + gap
    rowH = Math.max(rowH, r.h)
  }
  if (opts.currentPage < opts.totalPages - 1) {
    const r = drawPillButton(ctx, 'SUIV >>', hitboxes, { x: cursorX, y: opts.y, index: -2 })
    cursorX += r.w + gap
    rowH = Math.max(rowH, r.h)
  }
  const r = drawPillButton(ctx, backLabel, hitboxes, { x: cursorX, y: opts.y, index: 0 })
  rowH = Math.max(rowH, r.h)
  return rowH
}

function drawScanlines(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
  for (let y = 0; y < SCREEN_H; y += 3) {
    ctx.fillRect(0, y, SCREEN_W, 1)
  }
}

function drawHighlightChevron(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = COLOR_ACCENT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 6
  ctx.fillText('>', x, y)
  ctx.shadowBlur = 0
}

function drawSommaire(ctx: CanvasRenderingContext2D, highlight: number, hitboxes: HitBox[]) {
  drawHeader(ctx, '> ZONE CLUB - VIDEOTHEQUE')
  ctx.font = FONT
  ctx.textBaseline = 'top'
  let y = PADDING + 50
  const items = [
    'RECHERCHER UN FILM',
    'PARCOURIR LES RAYONS',
    'LISTE ALPHABETIQUE',
    'COMMANDER UN FILM',
  ]
  items.forEach((label, i) => {
    const itemNum = i + 1
    const isHl = itemNum === highlight
    if (isHl) drawHighlightChevron(ctx, PADDING, y)
    ctx.fillStyle = isHl ? COLOR_ACCENT : COLOR_TEXT
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillText(label, PADDING + 16, y)
    const pad = Math.round(TOK.itemGap / 2)
    hitboxes.push({ index: itemNum, yStart: y - pad, yEnd: y + LINE_H + pad })
    y += LINE_H + 6 + TOK.itemGap
  })
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.fillText('Tap / clic sur une ligne', PADDING + 16, y + 12)
  // Place FERMER just below the menu items and hint text
  drawBackButton(ctx, 'FERMER', hitboxes, y + 36)
}

function drawRecherche(ctx: CanvasRenderingContext2D, query: string, results: Film[], highlight: number, hitboxes: HitBox[]) {
  drawHeader(ctx, '> RECHERCHE - TITRE')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillText('Titre :', PADDING, PADDING + 32)
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(PADDING, PADDING + 56, SAFE_RIGHT - PADDING, 28)
  ctx.fillStyle = COLOR_ACCENT
  ctx.fillText(`> ${query || ''}_`, PADDING + 8, PADDING + 60)

  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  if (!query) {
    ctx.fillText('La saisie apparait ici en direct', PADDING, PADDING + 100)
  } else if (results.length === 0) {
    ctx.fillStyle = COLOR_TEXT
    ctx.fillText('AUCUN RESULTAT', PADDING, PADDING + 100)
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('Essayez COMMANDER UN FILM', PADDING, PADDING + 118)
  } else {
    ctx.fillStyle = COLOR_DIM
    ctx.fillText(`${results.length} resultat(s) — tap pour ouvrir :`, PADDING, PADDING + 100)
    let y = PADDING + 122
    ctx.font = FONT
    results.slice(0, 8).forEach((f, i) => {
      const num = i + 1
      const isHl = num === highlight
      if (isHl) drawHighlightChevron(ctx, PADDING - 14, y)
      ctx.fillStyle = isHl ? COLOR_ACCENT : COLOR_TEXT
      ctx.font = FONT
      ctx.textBaseline = 'top'
      ctx.fillText(f.title.slice(0, 40), PADDING, y)
      const pad = Math.round(TOK.itemGap / 2)
      hitboxes.push({ index: num, yStart: y - pad, yEnd: y + LINE_H + pad })
      y += LINE_H + TOK.itemGap
    })
    drawBackButton(ctx, 'RETOUR', hitboxes, y + 16)
    return
  }
  drawBackButton(ctx, 'RETOUR', hitboxes)
}

function drawRayons(ctx: CanvasRenderingContext2D, films: Record<string, Film[]>, highlight: number, hitboxes: HitBox[]) {
  drawHeader(ctx, '> RAYONS')
  ctx.font = FONT
  ctx.textBaseline = 'top'
  let y = PADDING + 32
  let visibleIdx = 0
  AISLES_ORDER.forEach((a) => {
    const count = (films[a]?.length ?? 0)
    if (count === 0) return
    visibleIdx++
    const num = visibleIdx
    const isHl = num === highlight
    if (isHl) drawHighlightChevron(ctx, PADDING - 14, y)
    ctx.fillStyle = isHl ? COLOR_ACCENT : COLOR_TEXT
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillText(`${aisleLabel(a).padEnd(14)} ${count} films`, PADDING, y)
    const pad = Math.round(TOK.itemGap / 2)
    hitboxes.push({ index: num, yStart: y - pad, yEnd: y + LINE_H + pad })
    y += LINE_H + TOK.itemGap
  })
  drawNavRow(ctx, hitboxes, { x: PADDING, y: y + 8, currentPage: 0, totalPages: 1 })
}

function drawAlpha(ctx: CanvasRenderingContext2D, films: Film[], page: number, highlight: number, hitboxes: HitBox[]) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `> FILMS A-Z   PAGE ${safePage + 1}/${totalPages}`)
  ctx.font = FONT
  ctx.textBaseline = 'top'
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 32
  slice.forEach((f, i) => {
    const num = i + 1
    const isHl = num === highlight
    if (isHl) drawHighlightChevron(ctx, PADDING - 14, y)
    ctx.fillStyle = isHl ? COLOR_ACCENT : COLOR_TEXT
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillText(f.title.slice(0, 40), PADDING, y)
    const pad = Math.round(TOK.itemGap / 2)
    hitboxes.push({ index: num, yStart: y - pad, yEnd: y + LINE_H + pad })
    y += LINE_H + TOK.itemGap
  })
  drawNavRow(ctx, hitboxes, { x: PADDING, y: y + 8, currentPage: safePage, totalPages })
}

function drawAisleList(ctx: CanvasRenderingContext2D, aisle: AisleType, films: Film[], page: number, highlight: number, hitboxes: HitBox[]) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `> ${aisleLabel(aisle)}   PAGE ${safePage + 1}/${totalPages}`)
  ctx.font = FONT
  ctx.textBaseline = 'top'
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 32
  slice.forEach((f, i) => {
    const num = i + 1
    const isHl = num === highlight
    if (isHl) drawHighlightChevron(ctx, PADDING - 14, y)
    ctx.fillStyle = isHl ? COLOR_ACCENT : COLOR_TEXT
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillText(f.title.slice(0, 40), PADDING, y)
    const pad = Math.round(TOK.itemGap / 2)
    hitboxes.push({ index: num, yStart: y - pad, yEnd: y + LINE_H + pad })
    y += LINE_H + TOK.itemGap
  })
  drawNavRow(ctx, hitboxes, { x: PADDING, y: y + 8, currentPage: safePage, totalPages })
}

function drawDetail(ctx: CanvasRenderingContext2D, film: Film, location: string, hitboxes: HitBox[]) {
  drawHeader(ctx, '> DETAIL FILM')
  // Title
  ctx.fillStyle = COLOR_ACCENT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 6
  ctx.fillText(film.title.slice(0, 30), PADDING, PADDING + 30)
  ctx.shadowBlur = 0
  // Year
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  if (film.release_date) {
    ctx.fillText(`(${film.release_date.slice(0, 4)})`, PADDING, PADDING + 52)
  }
  // Actors
  let yCursor = PADDING + 72
  if (film.actors && film.actors.length > 0) {
    ctx.fillStyle = COLOR_TEXT
    ctx.font = SMALL_FONT
    const line = `AVEC : ${film.actors.slice(0, 3).join(', ')}`
    const wrapped = wrapText(line, 36)
    for (const l of wrapped.slice(0, 2)) {
      ctx.fillText(l, PADDING, yCursor)
      yCursor += 14
    }
  }
  // Pitch — tagline first, else first part of overview
  yCursor += 4
  const pitch = (film.tagline && film.tagline.trim()) || (film.overview ? film.overview : '')
  if (pitch) {
    ctx.fillStyle = COLOR_DIM
    ctx.font = SMALL_FONT
    const wrapped = wrapText(pitch, 36)
    for (const l of wrapped.slice(0, 3)) {
      ctx.fillText(l, PADDING, yCursor)
      yCursor += 14
    }
  }
  // Location
  yCursor += 6
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.fillText('LOCALISATION :', PADDING, yCursor)
  yCursor += LINE_H
  ctx.fillStyle = COLOR_ACCENT
  // FONT is ~16px Courier (~9.6px/char). SAFE_RIGHT-PADDING ≈ 284px → ~28 chars.
  const locLines = wrapText(location, 28)
  for (const l of locLines.slice(0, 2)) {
    ctx.fillText(l, PADDING, yCursor)
    yCursor += LINE_H
  }
  // ILLUMINER LA K7 + RETOUR — side by side so RETOUR stays on the flat face
  // (the default bottom position lands on the bezel curve and warps).
  yCursor += 8
  ctx.font = FONT
  const illumLabel = 'ILLUMINER LA K7'
  const illumPadX = 12
  const illumPadY = 8
  const illumW = ctx.measureText(illumLabel).width + illumPadX * 2
  const illumH = LINE_H + illumPadY * 2
  const illumX = PADDING
  const illumY = yCursor
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.fillStyle = 'rgba(0, 255, 247, 0.15)'
  ctx.fillRect(illumX, illumY, illumW, illumH)
  ctx.strokeRect(illumX, illumY, illumW, illumH)
  ctx.fillStyle = COLOR_ACCENT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 8
  ctx.fillText(illumLabel, illumX + illumPadX, illumY + illumPadY)
  ctx.shadowBlur = 0
  hitboxes.push({
    index: 1,
    yStart: illumY - 2, yEnd: illumY + illumH + 2,
    xStart: illumX - 2, xEnd: illumX + illumW + 2,
  })
  // RETOUR pill — same Y as ILLUMINER, just to the right. Needs X bounds so a
  // click on RETOUR isn't swallowed by ILLUMINER's hitbox.
  const retourLabel = 'RETOUR'
  const retourPadX = 12
  const retourPadY = 6
  const retourTextW = ctx.measureText(retourLabel).width
  const retourW = retourTextW + retourPadX * 2
  const retourH = LINE_H + retourPadY * 2
  const retourX = illumX + illumW + 12
  // Vertically center RETOUR on ILLUMINER's box (they have different heights).
  const retourY = illumY + Math.round((illumH - retourH) / 2)
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.fillStyle = 'rgba(0, 255, 247, 0.10)'
  ctx.fillRect(retourX, retourY, retourW, retourH)
  ctx.strokeRect(retourX, retourY, retourW, retourH)
  ctx.fillStyle = COLOR_ACCENT
  ctx.textBaseline = 'top'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 6
  ctx.fillText(retourLabel, retourX + retourPadX, retourY + retourPadY)
  ctx.shadowBlur = 0
  hitboxes.push({
    index: 0,
    yStart: retourY - 2, yEnd: retourY + retourH + 2,
    xStart: retourX - 2, xEnd: retourX + retourW + 2,
  })
}

type TmdbState = 'idle' | 'pending' | 'ok' | 'empty' | 'error'
// Compact pill drawn on the right of each commander row. Smaller than
// drawPillButton (no shadow, tighter padding) so it fits within SAFE_RIGHT.
function drawRowPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  hitboxes: HitBox[],
  opts: { x: number; y: number; index: number | null; clickable: boolean },
): { w: number; h: number } {
  const padX = 6
  const padY = 1
  ctx.font = SMALL_FONT
  const textW = ctx.measureText(label).width
  const btnW = textW + padX * 2
  const btnH = 14
  ctx.strokeStyle = opts.clickable ? COLOR_ACCENT : COLOR_DIM
  ctx.lineWidth = 1
  ctx.fillStyle = opts.clickable ? 'rgba(0, 255, 247, 0.12)' : 'rgba(240, 244, 255, 0.04)'
  ctx.fillRect(opts.x, opts.y, btnW, btnH)
  ctx.strokeRect(opts.x, opts.y, btnW, btnH)
  ctx.fillStyle = opts.clickable ? COLOR_ACCENT : COLOR_DIM
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(label, opts.x + padX, opts.y + padY + 1)
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
) {
  drawHeader(ctx, '> COMMANDER UN FILM')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  if (!authed) {
    ctx.fillText('CONNECTEZ-VOUS POUR', PADDING, PADDING + 40)
    ctx.fillText('COMMANDER UN FILM', PADDING, PADDING + 60)
    ctx.fillStyle = COLOR_DIM
    ctx.font = SMALL_FONT
    ctx.fillText('Tap SE CONNECTER pour ouvrir', PADDING, PADDING + 90)
    ctx.fillText('la fenetre de login.', PADDING, PADDING + 104)
    // SE CONNECTER pill — index=1 routed to handleEnvoi by the bridge,
    // which opens the AuthModal inline (no minitel exit).
    drawPillButton(ctx, 'SE CONNECTER', hitboxes, { x: PADDING, y: PADDING + 124, index: 1 })
    // RETOUR pill — back to sommaire
    ctx.font = FONT
    const connTextW = ctx.measureText('SE CONNECTER').width + TOK.pillPadX * 2
    drawPillButton(ctx, 'RETOUR', hitboxes, { x: PADDING + connTextW + 12, y: PADDING + 124, index: 0 })
    return
  }
  ctx.fillText('Recherche TMDB :', PADDING, PADDING + 32)
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(PADDING, PADDING + 56, SAFE_RIGHT - PADDING, 28)
  ctx.fillStyle = COLOR_ACCENT
  ctx.fillText(`> ${query || ''}_`, PADDING + 8, PADDING + 60)

  // RETOUR pinned at the top-right of the screen — always visible regardless
  // of how many results we draw below. The previous bottom placement was
  // landing in the bezel curve and felt "unresponsive".
  ctx.font = FONT
  const retourPillW = ctx.measureText('RETOUR').width + TOK.pillPadX * 2
  drawPillButton(ctx, 'RETOUR', hitboxes, {
    x: SAFE_RIGHT - retourPillW,
    y: PADDING,
    index: 0,
  })

  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  if (tmdbState === 'idle' || !query) {
    ctx.fillText('Tapez le titre du film a commander.', PADDING, PADDING + 100)
    return
  }
  if (tmdbState === 'pending') {
    ctx.fillText('Recherche en cours...', PADDING, PADDING + 100)
    return
  }
  if (tmdbState === 'error') {
    ctx.fillStyle = COLOR_TEXT
    ctx.fillText('ERREUR DE CONNEXION TMDB', PADDING, PADDING + 100)
    ctx.fillStyle = COLOR_DIM
    ctx.fillText('Reessayez plus tard.', PADDING, PADDING + 118)
    return
  }
  if (tmdbState === 'empty') {
    ctx.fillStyle = COLOR_TEXT
    ctx.fillText('AUCUN RESULTAT', PADDING, PADDING + 100)
    return
  }
  // tmdbState === 'ok'
  ctx.fillText(`${results.length} resultat(s) — tap COMMANDER :`, PADDING, PADDING + 100)
  let y = PADDING + 122
  // Pre-compute the pill width to know where to clip the title.
  ctx.font = SMALL_FONT
  const pillSlotW = Math.max(
    ctx.measureText('DISPO').width,
    ctx.measureText('DEMANDE').width,
    ctx.measureText('COMMANDER').width,
  ) + 6 * 2 // padX*2
  const titleMaxX = SAFE_RIGHT - pillSlotW - 6
  results.slice(0, 6).forEach((r, i) => {
    const inLocal = localTmdbIds.has(r.id)
    const isReq = requested.has(r.id)
    const year = r.release_date ? ` (${r.release_date.slice(0, 4)})` : ''
    // Truncate the title to fit before the pill column.
    ctx.font = FONT
    let text = `${r.title}${year}`
    while (ctx.measureText(text).width > titleMaxX - PADDING - 4 && text.length > 4) {
      text = text.slice(0, -2)
    }
    if (text !== `${r.title}${year}`) text = text.slice(0, -1) + '…'
    const dim = inLocal || isReq
    ctx.fillStyle = dim ? COLOR_DIM : COLOR_TEXT
    ctx.textBaseline = 'top'
    ctx.fillText(text, PADDING, y)
    // Status / action pill on the right
    const label = inLocal ? 'DISPO' : isReq ? 'DEMANDE' : 'COMMANDER'
    ctx.font = SMALL_FONT
    const measuredW = ctx.measureText(label).width + 6 * 2
    drawRowPill(ctx, label, hitboxes, {
      x: SAFE_RIGHT - measuredW,
      y: y - 1,
      index: !inLocal && !isReq ? i + 1 : null,
      clickable: !inLocal && !isReq,
    })
    y += LINE_H + TOK.itemGap
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
  const films = useStore((s) => s.films)
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const isMobile = useIsCoarsePointer()
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
    if (minitelMode === 'idle' || minitelMode === 'sommaire') drawSommaire(ctx, minitelHighlightedItem, hits)
    else if (minitelMode === 'recherche') drawRecherche(ctx, minitelQuery, searchResults, minitelHighlightedItem, hits)
    else if (minitelMode === 'rayons') {
      if (minitelSelectedAisle) drawAisleList(ctx, minitelSelectedAisle, aisleFilms, minitelPageIndex, minitelHighlightedItem, hits)
      else drawRayons(ctx, films, minitelHighlightedItem, hits)
    }
    else if (minitelMode === 'alpha') drawAlpha(ctx, allFilms, minitelPageIndex, minitelHighlightedItem, hits)
    else if (minitelMode === 'commander') drawCommander(ctx, minitelQuery, tmdbResults, requestedIds, isAuthenticated, storeTmdbState, localTmdbIds, hits)
    else if (minitelMode === 'detail') {
      if (detailFilm) drawDetail(ctx, detailFilm, detailLocation, hits)
      else drawSommaire(ctx, minitelHighlightedItem, hits)
    }
    drawScanlines(ctx)
    texture.needsUpdate = true
    hitboxesRef.current = hits
  }, [
    canvas, texture, minitelMode, minitelQuery, minitelSelectedAisle,
    minitelPageIndex, minitelHighlightedItem, searchResults, aisleFilms, allFilms, films, detailFilm,
    detailLocation, tmdbResults, requestedIds, storeTmdbState, localTmdbIds, isAuthenticated, isMobile,
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
