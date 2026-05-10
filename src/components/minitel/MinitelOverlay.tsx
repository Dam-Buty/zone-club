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
    if (minitelMode === 'sommaire') {
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
      if (key) setHighlightedCassetteKey(key)
      // Stay on detail screen; let the user ESC out to see the cassette
      return
    }
    if (minitelMode === 'commander' && !isAuthenticated) {
      // Open AuthModal? We just exit minitel and let user handle login
      setInteractingWithMinitel(false)
      return
    }
  }, [minitelMode, minitelSelectedFilm, isAuthenticated, setHighlightedCassetteKey, setInteractingWithMinitel])

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
  useEffect(() => {
    if (!isInteractingWithMinitel) return
    const onKey = (e: KeyboardEvent) => {
      // Number keys
      if (/^[1-9]$/.test(e.key)) {
        // In input modes, the input handles digit insertion when focused.
        // But [1-9] always selects an item if not in an input mode OR if no selectable input is focused.
        const inInput = document.activeElement === inputRef.current
        if (!inInput || (minitelMode !== 'recherche' && minitelMode !== 'commander')) {
          e.preventDefault()
          handleNumberPress(parseInt(e.key, 10))
          return
        }
      }
      if (e.key === 'Enter') { e.preventDefault(); handleEnvoi(); return }
      if (e.key === 'Escape') { e.preventDefault(); handleEsc(); return }
      if (e.key === 'PageDown') { e.preventDefault(); handleSuite(); return }
      if (e.key === 'PageUp') { e.preventDefault(); handleRetour(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isInteractingWithMinitel, minitelMode, handleNumberPress, handleEnvoi, handleEsc, handleSuite, handleRetour])

  if (!isInteractingWithMinitel) return null

  const showInput = minitelMode === 'recherche' || minitelMode === 'commander'
  const showNumbers = minitelMode !== 'detail'
  const showEnvoi = minitelMode === 'detail' || (minitelMode === 'commander' && !isAuthenticated)
  const showSuite = (minitelMode === 'alpha') || (minitelMode === 'rayons' && minitelSelectedAisle != null)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 800,
      pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      {/* Invisible input for desktop typing (mode recherche/commander) */}
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
            top: '40%', left: '50%',
            transform: 'translate(-50%, 0)',
            width: 320, padding: '8px 12px',
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #00fff7',
            color: '#00fff7',
            fontFamily: "'Courier New', monospace",
            fontSize: 18,
            outline: 'none',
            pointerEvents: 'auto',
            opacity: isMobile ? 1 : 0.001, // visible on mobile (so the OS keyboard opens), hidden on desktop
          }}
        />
      )}

      {/* Bottom button bar */}
      <div style={{
        pointerEvents: 'auto',
        background: 'linear-gradient(180deg, rgba(0,8,16,0.85) 0%, rgba(0,8,16,0.95) 100%)',
        borderTop: '2px solid #00fff7',
        padding: '12px 10px max(env(safe-area-inset-bottom), 12px)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Numbers row */}
        {showNumbers && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 6 }}>
            {[1,2,3,4,5,6,7,8,9].map((n) => (
              <button
                key={n}
                onClick={() => handleNumberPress(n)}
                style={mtBtnStyle()}
              >{n}</button>
            ))}
          </div>
        )}
        {/* Action row */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
          <button onClick={handleEsc} style={mtBtnStyle({ flex: '0 0 auto', minWidth: 92, color: '#ff6b6b', borderColor: '#ff6b6b' })}>SOMMAIRE</button>
          <div style={{ flex: 1, display: 'flex', gap: 6, justifyContent: 'center' }}>
            {showSuite && (
              <>
                <button onClick={handleRetour} style={mtBtnStyle({ flex: '0 0 auto', minWidth: 70 })}>RETOUR</button>
                <button onClick={handleSuite} style={mtBtnStyle({ flex: '0 0 auto', minWidth: 70 })}>SUITE</button>
              </>
            )}
          </div>
          {showEnvoi && (
            <button
              onClick={handleEnvoi}
              style={mtBtnStyle({ flex: '0 0 auto', minWidth: 92, background: '#00fff7', color: '#000814', borderColor: '#00fff7' })}
            >ENVOI</button>
          )}
        </div>
      </div>
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
