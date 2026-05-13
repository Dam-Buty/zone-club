'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store'
import { searchFilms } from '../../utils/minitelSearch'
import { tmdb, type TMDBSearchResult } from '../../services/tmdb'
import api from '../../api'
import type { AisleType, Film } from '../../types'

const PAGE_SIZE = 8

const AISLES_ORDER: AisleType[] = [
  'action', 'aventure', 'bizarre', 'classiques', 'comedie',
  'drame', 'horreur', 'policier', 'romance', 'sf',
  'thriller', 'animation', 'nouveautes',
] as AisleType[]

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(pointer: coarse)')?.matches ?? false
  })
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function MinitelOverlay() {
  const isInteractingWithMinitel = useStore((s) => s.isInteractingWithMinitel)
  const setInteractingWithMinitel = useStore((s) => s.setInteractingWithMinitel)
  const minitelMode = useStore((s) => s.minitelMode)
  const setMinitelMode = useStore((s) => s.setMinitelMode)
  const minitelQuery = useStore((s) => s.minitelQuery)
  const setMinitelQuery = useStore((s) => s.setMinitelQuery)
  const minitelSelectedAisle = useStore((s) => s.minitelSelectedAisle)
  const setMinitelSelectedAisle = useStore((s) => s.setMinitelSelectedAisle)
  const setMinitelSelectedFilm = useStore((s) => s.setMinitelSelectedFilm)
  const minitelPageIndex = useStore((s) => s.minitelPageIndex)
  const setMinitelPageIndex = useStore((s) => s.setMinitelPageIndex)
  const setHighlightedCassetteKey = useStore((s) => s.setHighlightedCassetteKey)
  const films = useStore((s) => s.films)
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const minitelSelectedFilm = useStore((s) => s.minitelSelectedFilm)
  const isMobile = useIsMobile()

  // Local: TMDB search results (mode 4) + requested IDs
  const [tmdbResults, setTmdbResults] = useState<TMDBSearchResult[]>([])
  const [requestedIds, setRequestedIds] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Auto-focus input on mount + mode change to recherche/commander
  useEffect(() => {
    if (!isInteractingWithMinitel) return
    if (minitelMode === 'recherche' || minitelMode === 'commander') {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isInteractingWithMinitel, minitelMode])

  // Load existing requested film IDs when entering commander mode
  useEffect(() => {
    if (minitelMode !== 'commander' || !isAuthenticated) return
    api.filmRequests.getAll()
      .then((requests) => setRequestedIds(new Set(requests.map((r: { tmdb_id: number }) => r.tmdb_id))))
      .catch(() => {})
  }, [minitelMode, isAuthenticated])

  // Debounced TMDB search for commander mode
  useEffect(() => {
    if (minitelMode !== 'commander' || !minitelQuery.trim()) {
      setTmdbResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = await tmdb.search(minitelQuery)
        setTmdbResults(r.results.slice(0, 6))
      } catch {
        setTmdbResults([])
      }
    }, 500)
    return () => clearTimeout(t)
  }, [minitelMode, minitelQuery])

  // Build flat A→Z list of all films (deduped)
  const buildAllFilms = useCallback((): Film[] => {
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

  // Handle a numeric selection [1..9] in current screen
  const handleNumberPress = useCallback((n: number) => {
    if (minitelMode === 'sommaire' || minitelMode === 'idle') {
      if (n === 1) { setMinitelMode('recherche'); setMinitelQuery(''); setMinitelPageIndex(0) }
      else if (n === 2) { setMinitelMode('rayons'); setMinitelSelectedAisle(null); setMinitelPageIndex(0) }
      else if (n === 3) { setMinitelMode('alpha'); setMinitelPageIndex(0) }
      else if (n === 4) { setMinitelMode('commander'); setMinitelQuery('') }
      return
    }
    if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      const visible = AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0)
      const aisle = visible[n - 1]
      if (aisle) { setMinitelSelectedAisle(aisle); setMinitelPageIndex(0) }
      return
    }
    if (minitelMode === 'rayons' && minitelSelectedAisle) {
      const list = [...(films[minitelSelectedAisle] || [])].sort((a, b) => a.title.localeCompare(b.title))
      const slice = list.slice(minitelPageIndex * PAGE_SIZE, (minitelPageIndex + 1) * PAGE_SIZE)
      const film = slice[n - 1]
      if (film) { setMinitelSelectedFilm(film.id); setMinitelMode('detail') }
      return
    }
    if (minitelMode === 'alpha') {
      const all = buildAllFilms()
      const slice = all.slice(minitelPageIndex * PAGE_SIZE, (minitelPageIndex + 1) * PAGE_SIZE)
      const film = slice[n - 1]
      if (film) { setMinitelSelectedFilm(film.id); setMinitelMode('detail') }
      return
    }
    if (minitelMode === 'recherche') {
      const all = buildAllFilms()
      const results = searchFilms(all, minitelQuery)
      const film = results[n - 1]
      if (film) { setMinitelSelectedFilm(film.id); setMinitelMode('detail') }
      return
    }
    if (minitelMode === 'commander') {
      const r = tmdbResults[n - 1]
      if (r && isAuthenticated && !requestedIds.has(r.id)) {
        api.filmRequests.create({
          tmdb_id: r.id,
          title: r.title,
          poster_url: r.poster_path ? tmdb.posterUrl(r.poster_path, 'w342') : null,
        }).then(() => setRequestedIds((prev) => new Set([...prev, r.id]))).catch(() => {})
      }
      return
    }
  }, [
    minitelMode, minitelSelectedAisle, films, minitelPageIndex, minitelQuery,
    tmdbResults, isAuthenticated, requestedIds, buildAllFilms,
    setMinitelMode, setMinitelQuery, setMinitelSelectedAisle, setMinitelSelectedFilm, setMinitelPageIndex,
  ])

  // ENVOI: contextual action
  const handleEnvoi = useCallback(() => {
    if (minitelMode === 'detail' && minitelSelectedFilm != null) {
      // Find cassette key for this film via global registry
      const map = (window as unknown as { __cassetteFilmIdToKey?: Map<number, string> }).__cassetteFilmIdToKey
      const key = map?.get(minitelSelectedFilm) ?? null
      if (!key) {
        // No cassette → nothing to highlight, leave the user on the detail
        // screen so they know the action did not point them anywhere.
        return
      }
      setHighlightedCassetteKey(key)
      // Eject the user from the minitel so they can walk the aisles and spot
      // the now-glowing K7. Short delay so the canvas redraws once with the
      // ILLUMINER click registered (button stays cyan, but the user gets a
      // beat to register the interaction before the camera pulls back).
      setTimeout(() => {
        setMinitelMode('idle')
        setMinitelSelectedFilm(null)
        setInteractingWithMinitel(false)
      }, 320)
      return
    }
    if (minitelMode === 'commander' && !isAuthenticated) {
      // Open AuthModal? We just exit minitel and let user handle login
      setInteractingWithMinitel(false)
      return
    }
  }, [minitelMode, minitelSelectedFilm, isAuthenticated, setHighlightedCassetteKey, setInteractingWithMinitel, setMinitelMode, setMinitelSelectedFilm])

  // ESC: contextual back navigation
  const handleEsc = useCallback(() => {
    if (minitelMode === 'detail') { setMinitelMode('sommaire'); setMinitelSelectedFilm(null); return }
    if (minitelMode === 'rayons' && minitelSelectedAisle) { setMinitelSelectedAisle(null); setMinitelPageIndex(0); return }
    if (minitelMode === 'recherche' || minitelMode === 'rayons' || minitelMode === 'alpha' || minitelMode === 'commander') {
      setMinitelMode('sommaire')
      setMinitelQuery('')
      setMinitelPageIndex(0)
      return
    }
    // Sommaire → exit minitel
    setInteractingWithMinitel(false)
    setMinitelMode('idle')
  }, [
    minitelMode, minitelSelectedAisle, setMinitelMode, setMinitelSelectedAisle,
    setMinitelPageIndex, setMinitelQuery, setMinitelSelectedFilm, setInteractingWithMinitel,
  ])

  // SUITE / RETOUR pagination
  const handleSuite = useCallback(() => setMinitelPageIndex(minitelPageIndex + 1), [minitelPageIndex, setMinitelPageIndex])
  const handleRetour = useCallback(() => setMinitelPageIndex(Math.max(0, minitelPageIndex - 1)), [minitelPageIndex, setMinitelPageIndex])

  // Desktop keyboard handler
  // Compute the number of selectable items for arrow navigation bounds.
  const itemCount = (() => {
    if (minitelMode === 'sommaire' || minitelMode === 'idle') return 4
    if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      return AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).length
    }
    if (minitelMode === 'rayons' && minitelSelectedAisle) {
      const list = films[minitelSelectedAisle] || []
      return Math.min(PAGE_SIZE, list.length - minitelPageIndex * PAGE_SIZE)
    }
    if (minitelMode === 'alpha') {
      return Math.min(PAGE_SIZE, buildAllFilms().length - minitelPageIndex * PAGE_SIZE)
    }
    if (minitelMode === 'recherche') {
      const results = searchFilms(buildAllFilms(), minitelQuery)
      return Math.min(8, results.length)
    }
    if (minitelMode === 'commander') return Math.min(6, tmdbResults.length)
    return 0
  })()

  const highlightedItem = useStore((s) => s.minitelHighlightedItem)
  const setHighlightedItem = useStore((s) => s.setMinitelHighlightedItem)

  // Reset highlight when mode/page/aisle/query changes — otherwise Enter would
  // dispatch a stale highlightedItem index from previous results.
  useEffect(() => {
    setHighlightedItem(1)
  }, [minitelMode, minitelSelectedAisle, minitelPageIndex, minitelQuery, setHighlightedItem])

  useEffect(() => {
    if (!isInteractingWithMinitel) return
    const onKey = (e: KeyboardEvent) => {
      const inInput = document.activeElement === inputRef.current
      // Number keys (only when not typing in an input)
      if (/^[1-9]$/.test(e.key)) {
        if (!inInput || (minitelMode !== 'recherche' && minitelMode !== 'commander')) {
          e.preventDefault()
          handleNumberPress(parseInt(e.key, 10))
          return
        }
      }
      // Arrow Up/Down work even when typing in the search input, so the user
      // can pick a result without leaving the keyboard. Left/Right stay
      // text-edit-only when input is focused.
      if (itemCount > 0) {
        if (e.key === 'ArrowDown' || (!inInput && e.key === 'ArrowRight')) {
          e.preventDefault()
          setHighlightedItem(highlightedItem >= itemCount ? 1 : highlightedItem + 1)
          return
        }
        if (e.key === 'ArrowUp' || (!inInput && e.key === 'ArrowLeft')) {
          e.preventDefault()
          setHighlightedItem(highlightedItem <= 1 ? itemCount : highlightedItem - 1)
          return
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (minitelMode === 'detail') { handleEnvoi(); return }
        if (itemCount > 0) { handleNumberPress(highlightedItem); return }
        handleEnvoi()
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); handleEsc(); return }
      if (e.key === 'Backspace' && !inInput) { e.preventDefault(); handleEsc(); return }
      if (e.key === 'PageDown') { e.preventDefault(); handleSuite(); return }
      if (e.key === 'PageUp') { e.preventDefault(); handleRetour(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    isInteractingWithMinitel, minitelMode, itemCount, highlightedItem,
    setHighlightedItem, handleNumberPress, handleEnvoi, handleEsc, handleSuite, handleRetour,
  ])

  // Bridge: consume direct-clicks on the 3D screen plane forwarded by
  // MinitelDisplay via pendingMinitelPress.
  // index 0 = back/exit button (drawBackButton), other index = item selection
  // detail mode + index=1 = ILLUMINER button (rendered inside the canvas)
  const pendingMinitelPress = useStore((s) => s.pendingMinitelPress)
  const consumeMinitelItem = useStore((s) => s.consumeMinitelItem)
  useEffect(() => {
    if (pendingMinitelPress == null) return
    if (pendingMinitelPress === 0) {
      handleEsc()
    } else if (pendingMinitelPress === -1) {
      handleRetour() // previous page
    } else if (pendingMinitelPress === -2) {
      handleSuite() // next page
    } else if (minitelMode === 'detail' && pendingMinitelPress === 1) {
      handleEnvoi()
    } else {
      handleNumberPress(pendingMinitelPress)
    }
    consumeMinitelItem()
  }, [pendingMinitelPress, minitelMode, handleNumberPress, handleEsc, handleEnvoi, handleSuite, handleRetour, consumeMinitelItem])

  if (!isInteractingWithMinitel) return null

  const showInput = minitelMode === 'recherche' || minitelMode === 'commander'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 800,
      pointerEvents: 'none',
    }}>
      {/* Hidden input for desktop typing (mode recherche/commander). On mobile
          it stays slightly visible so the OS keyboard opens; on desktop it's
          fully transparent — keystrokes still update minitelQuery via onChange,
          which gets rendered live inside the 3D screen canvas. */}
      {showInput && (
        <input
          ref={inputRef}
          type="text"
          value={minitelQuery}
          onChange={(e) => setMinitelQuery(e.target.value)}
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          style={{
            position: 'absolute',
            bottom: 'max(env(safe-area-inset-bottom), 12px)', left: '50%',
            transform: 'translateX(-50%)',
            width: 280, padding: '8px 12px',
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #00fff7',
            color: '#00fff7',
            fontFamily: "'Courier New', monospace",
            fontSize: 16,
            outline: 'none',
            pointerEvents: 'auto',
            opacity: isMobile ? 1 : 0.001,
          }}
        />
      )}
    </div>
  )
}

function mtBtnStyle(extra: Record<string, string | number> = {}): React.CSSProperties {
  return {
    background: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid #00fff7',
    color: '#00fff7',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    fontSize: '0.85rem',
    padding: '10px 6px',
    borderRadius: 4,
    cursor: 'pointer',
    letterSpacing: '0.05em',
    minHeight: 44,
    ...extra,
  } as React.CSSProperties
}
