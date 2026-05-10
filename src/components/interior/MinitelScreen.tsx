import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'
import { searchFilms } from '../../utils/minitelSearch'
import { aisleLabel, cassetteKeyToHumanLocation } from '../../utils/cassetteLocation'
import { getCassetteWorldPosition } from '../../utils/cassetteRegistry'
import type { AisleType, Film } from '../../types'

const SCREEN_W = 512
const SCREEN_H = 384 // 4:3
const PADDING = 18
const LINE_H = 18
const FONT = "bold 16px 'Courier New', monospace"
const HEADER_FONT = "bold 14px 'Courier New', monospace"
const SMALL_FONT = "12px 'Courier New', monospace"
const COLOR_BG = '#000010'
const COLOR_TEXT = '#f0f4ff'
const COLOR_ACCENT = '#00fff7'
const COLOR_DIM = 'rgba(240, 244, 255, 0.55)'

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
  ctx.lineTo(SCREEN_W - PADDING, PADDING + 18)
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

function drawScanlines(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
  for (let y = 0; y < SCREEN_H; y += 3) {
    ctx.fillRect(0, y, SCREEN_W, 1)
  }
}

function drawSommaire(ctx: CanvasRenderingContext2D) {
  drawHeader(ctx, '> ZONE CLUB - VIDEOTHEQUE')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  let y = PADDING + 50
  const lines = [
    '[1] RECHERCHER UN FILM',
    '[2] PARCOURIR LES RAYONS',
    '[3] LISTE ALPHABETIQUE',
    '[4] COMMANDER UN FILM',
    '    SI NON DISPO',
  ]
  for (const l of lines) {
    ctx.fillText(l, PADDING + 16, y)
    y += LINE_H + 4
  }
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.fillText('Tapez le numero + ENVOI', PADDING + 16, y + 12)
  drawFooter(ctx, '[ESC] sortir')
}

function drawRecherche(ctx: CanvasRenderingContext2D, query: string, results: Film[]) {
  drawHeader(ctx, '> RECHERCHE - TITRE')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.fillText('Tapez un titre :', PADDING, PADDING + 32)
  // Input box
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(PADDING, PADDING + 56, SCREEN_W - PADDING * 2, 28)
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
    ctx.fillText('Essayez le mode 4 pour commander', PADDING, PADDING + 118)
  } else {
    ctx.fillStyle = COLOR_DIM
    ctx.fillText(`${results.length} resultat(s) :`, PADDING, PADDING + 100)
    let y = PADDING + 122
    ctx.fillStyle = COLOR_TEXT
    ctx.font = FONT
    results.slice(0, 8).forEach((f, i) => {
      const label = `[${i + 1}] ${f.title.slice(0, 36)}`
      ctx.fillText(label, PADDING, y)
      y += LINE_H
    })
  }
  drawFooter(ctx, '[1-9] selectionner | [ESC] sommaire')
}

function drawRayons(ctx: CanvasRenderingContext2D, films: Record<string, Film[]>) {
  drawHeader(ctx, '> RAYONS')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  let y = PADDING + 32
  AISLES_ORDER.forEach((a, i) => {
    const count = (films[a]?.length ?? 0)
    if (count === 0) return
    const num = i + 1
    const numLabel = num <= 9 ? `[${num}]` : `[${num}]`
    ctx.fillText(`${numLabel} ${aisleLabel(a).padEnd(12)} (${count})`, PADDING, y)
    y += LINE_H
  })
  drawFooter(ctx, '[1-9] selectionner | [ESC] sommaire')
}

function drawAlpha(ctx: CanvasRenderingContext2D, films: Film[], page: number) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `> FILMS A-Z   PAGE ${safePage + 1}/${totalPages}`)
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 32
  slice.forEach((f, i) => {
    ctx.fillText(`[${i + 1}] ${f.title.slice(0, 36)}`, PADDING, y)
    y += LINE_H
  })
  drawFooter(ctx, '[1-9] choisir | [SUITE] page+ | [ESC] sommaire')
}

function drawAisleList(ctx: CanvasRenderingContext2D, aisle: AisleType, films: Film[], page: number) {
  const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE))
  const safePage = Math.max(0, Math.min(page, totalPages - 1))
  drawHeader(ctx, `> ${aisleLabel(aisle)}   PAGE ${safePage + 1}/${totalPages}`)
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  const slice = films.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  let y = PADDING + 32
  slice.forEach((f, i) => {
    ctx.fillText(`[${i + 1}] ${f.title.slice(0, 36)}`, PADDING, y)
    y += LINE_H
  })
  drawFooter(ctx, '[1-9] choisir | [SUITE] page+ | [ESC] retour')
}

function drawDetail(ctx: CanvasRenderingContext2D, film: Film, location: string) {
  drawHeader(ctx, '> DETAIL FILM')
  ctx.fillStyle = COLOR_ACCENT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.shadowColor = COLOR_ACCENT
  ctx.shadowBlur = 6
  ctx.fillText(film.title.slice(0, 40), PADDING, PADDING + 40)
  ctx.shadowBlur = 0
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  if (film.release_date) {
    ctx.fillText(`(${film.release_date.slice(0, 4)})`, PADDING, PADDING + 64)
  }
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  let y = PADDING + 110
  // Wrap location on 2 lines if needed
  const locLines = wrapText(location, 40)
  locLines.forEach((line, i) => {
    if (i === 0) ctx.fillText('LOCALISATION :', PADDING, y)
    else ctx.fillText(line, PADDING, y)
    y += LINE_H
  })
  ctx.fillStyle = COLOR_ACCENT
  ctx.fillText(locLines[0] ?? '', PADDING, PADDING + 110 + LINE_H)
  ctx.fillStyle = COLOR_TEXT
  ctx.fillText('[ENVOI] ILLUMINER LA K7', PADDING, PADDING + 200)
  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  ctx.fillText('[ESC] retour sommaire', PADDING, PADDING + 230)
  drawFooter(ctx, '')
}

function drawCommander(ctx: CanvasRenderingContext2D, query: string, results: Array<{ id: number; title: string; release_date?: string }>, requested: Set<number>, authed: boolean) {
  drawHeader(ctx, '> COMMANDER UN FILM')
  ctx.fillStyle = COLOR_TEXT
  ctx.font = FONT
  ctx.textBaseline = 'top'
  if (!authed) {
    ctx.fillText('CONNECTEZ-VOUS POUR', PADDING, PADDING + 60)
    ctx.fillText('COMMANDER UN FILM', PADDING, PADDING + 80)
    ctx.fillStyle = COLOR_DIM
    ctx.font = SMALL_FONT
    ctx.fillText('[ENVOI] ouvrir la fenetre de connexion', PADDING, PADDING + 110)
    drawFooter(ctx, '[ESC] sommaire')
    return
  }
  ctx.fillText('Recherche TMDB :', PADDING, PADDING + 32)
  ctx.strokeStyle = COLOR_ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(PADDING, PADDING + 56, SCREEN_W - PADDING * 2, 28)
  ctx.fillStyle = COLOR_ACCENT
  ctx.fillText(`> ${query || ''}_`, PADDING + 8, PADDING + 60)

  ctx.fillStyle = COLOR_DIM
  ctx.font = SMALL_FONT
  if (!query) {
    ctx.fillText('Recherche dans la base TMDB', PADDING, PADDING + 100)
  } else if (results.length === 0) {
    ctx.fillText('Recherche en cours...', PADDING, PADDING + 100)
  } else {
    ctx.fillText(`${results.length} resultat(s) :`, PADDING, PADDING + 100)
    let y = PADDING + 122
    ctx.fillStyle = COLOR_TEXT
    ctx.font = FONT
    results.slice(0, 6).forEach((r, i) => {
      const isReq = requested.has(r.id)
      const year = r.release_date ? ` (${r.release_date.slice(0, 4)})` : ''
      const tag = isReq ? ' [DEJA]' : ''
      const text = `[${i + 1}] ${r.title.slice(0, 28)}${year}${tag}`
      ctx.fillStyle = isReq ? COLOR_DIM : COLOR_TEXT
      ctx.fillText(text, PADDING, y)
      y += LINE_H
    })
  }
  drawFooter(ctx, '[1-9] commander | [ESC] sommaire')
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
  const films = useStore((s) => s.films)
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const tmdbResults = props.tmdbResults ?? []
  const requestedIds = props.requestedIds ?? new Set<number>()

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
    return { canvas: c, texture: t }
  }, [])

  useEffect(() => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = COLOR_BG
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    if (minitelMode === 'idle' || minitelMode === 'sommaire') drawSommaire(ctx)
    else if (minitelMode === 'recherche') drawRecherche(ctx, minitelQuery, searchResults)
    else if (minitelMode === 'rayons') {
      if (minitelSelectedAisle) drawAisleList(ctx, minitelSelectedAisle, aisleFilms, minitelPageIndex)
      else drawRayons(ctx, films)
    }
    else if (minitelMode === 'alpha') drawAlpha(ctx, allFilms, minitelPageIndex)
    else if (minitelMode === 'commander') drawCommander(ctx, minitelQuery, tmdbResults, requestedIds, isAuthenticated)
    else if (minitelMode === 'detail') {
      if (detailFilm) drawDetail(ctx, detailFilm, detailLocation)
      else drawSommaire(ctx)
    }
    drawScanlines(ctx)
    texture.needsUpdate = true
  }, [
    canvas, texture, minitelMode, minitelQuery, minitelSelectedAisle,
    minitelPageIndex, searchResults, aisleFilms, allFilms, films, detailFilm,
    detailLocation, tmdbResults, requestedIds, isAuthenticated,
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

  return { texture, detailCassetteKey, totalPages, selectableItems, getCassetteWorldPosition }
}
