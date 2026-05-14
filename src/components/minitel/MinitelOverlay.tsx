'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../../store'
import { searchFilms } from '../../utils/minitelSearch'
import { tmdb } from '../../services/tmdb'
import api from '../../api'
import { AuthModal } from '../auth/AuthModal'
import type { AisleType, Film } from '../../types'

// Must stay in sync with PAGE_SIZE in MinitelScreen.tsx.
const PAGE_SIZE = 7
// RECHERCHE has extra vertical chrome above the list (TITRE input + label)
// so it fits one fewer row than the generic paginated screens.
const RECHERCHE_PAGE_SIZE = 6

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
  const setMinitelIlluminerFlash = useStore((s) => s.setMinitelIlluminerFlash)
  const films = useStore((s) => s.films)
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const minitelSelectedFilm = useStore((s) => s.minitelSelectedFilm)
  const isMobile = useIsMobile()

  // Store-backed TMDB state so MinitelDisplay (which owns the canvas) sees the
  // same results & loading state.
  const tmdbResults = useStore((s) => s.minitelTmdbResults)
  const setTmdbResults = useStore((s) => s.setMinitelTmdbResults)
  const setTmdbState = useStore((s) => s.setMinitelTmdbState)
  const requestedIds = useStore((s) => s.minitelRequestedIds)
  const setRequestedIds = useStore((s) => s.setMinitelRequestedIds)
  const [showAuthModal, setShowAuthModal] = useState(false)
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
  }, [minitelMode, isAuthenticated, setRequestedIds])

  // Debounced TMDB search for commander mode — writes results AND a state
  // marker so the canvas can show "Recherche en cours…" vs "Aucun résultat"
  // vs "Erreur réseau" instead of being stuck on "Recherche en cours…".
  useEffect(() => {
    if (minitelMode !== 'commander') return
    if (!minitelQuery.trim()) {
      setTmdbResults([])
      setTmdbState('idle')
      return
    }
    setTmdbState('pending')
    const t = setTimeout(async () => {
      try {
        const r = await tmdb.search(minitelQuery)
        const slice = r.results.slice(0, 6)
        setTmdbResults(slice)
        setTmdbState(slice.length === 0 ? 'empty' : 'ok')
      } catch {
        setTmdbResults([])
        setTmdbState('error')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [minitelMode, minitelQuery, setTmdbResults, setTmdbState])

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
        }).then(() => {
          const next = new Set(requestedIds)
          next.add(r.id)
          setRequestedIds(next)
        }).catch(() => {})
      }
      return
    }
  }, [
    minitelMode, minitelSelectedAisle, films, minitelPageIndex, minitelQuery,
    tmdbResults, isAuthenticated, requestedIds, buildAllFilms, setRequestedIds,
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
      // Reverse-video flash on the ILLUMINER button so the click feedback is
      // unmistakable before the camera pulls back. setInteractingWithMinitel
      // (false) cleans up the rest of the minitel state via the store middleware.
      setMinitelIlluminerFlash(true)
      setTimeout(() => {
        setMinitelIlluminerFlash(false)
        setInteractingWithMinitel(false)
        // Re-acquire pointer lock so the user can move without an extra click
        // back to FPS controls. Controls.tsx no-ops on mobile.
        useStore.getState().requestPointerLock()
      }, 320)
      return
    }
    if (minitelMode === 'commander' && !isAuthenticated) {
      // Pop the login modal inline so the user doesn't lose their minitel
      // context — once auth succeeds they're back on the search.
      setShowAuthModal(true)
      return
    }
  }, [minitelMode, minitelSelectedFilm, isAuthenticated, setHighlightedCassetteKey, setInteractingWithMinitel, setMinitelIlluminerFlash])

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
  // Number of focusable LIST rows in the current screen. The total focusable
  // count (itemCount) also includes trailing buttons defined below.
  const listItemCount = (() => {
    if (minitelSelectedFilm != null) return 0 // detail mode: no list, only buttons
    if (minitelMode === 'sommaire' || minitelMode === 'idle') return 4
    if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      const nonEmpty = AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).length
      return Math.min(PAGE_SIZE, nonEmpty - minitelPageIndex * PAGE_SIZE)
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
      return Math.min(RECHERCHE_PAGE_SIZE, results.length)
    }
    if (minitelMode === 'commander') {
      if (!isAuthenticated) return 0
      return Math.min(6, tmdbResults.length)
    }
    return 0
  })()

  // Total pages for the current paginated screen — used to decide whether
  // 'prev' / 'next' trailing buttons are reachable in the focus cycle.
  const totalPagesForMode = (() => {
    if (minitelMode === 'alpha') return Math.max(1, Math.ceil(buildAllFilms().length / PAGE_SIZE))
    if (minitelMode === 'rayons' && !minitelSelectedAisle) {
      const nonEmpty = AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).length
      return Math.max(1, Math.ceil(nonEmpty / PAGE_SIZE))
    }
    if (minitelMode === 'rayons' && minitelSelectedAisle) {
      return Math.max(1, Math.ceil((films[minitelSelectedAisle] || []).length / PAGE_SIZE))
    }
    return 1
  })()

  // Trailing buttons reachable AFTER the list (1-based indices continue past
  // listItemCount). Paginated modes also expose 'prev' / 'next' so the user
  // can reach SUIV with ↓ from the last list row instead of being shuttled
  // straight onto RETOUR.
  type TrailingBtn = 'envoi' | 'esc' | 'prev' | 'next'
  const trailingButtons: TrailingBtn[] = (() => {
    if (minitelSelectedFilm != null) return ['envoi', 'esc']            // detail: ILLUMINER + RETOUR
    if (minitelMode === 'commander' && !isAuthenticated) return ['envoi', 'esc']  // SE CONNECTER + RETOUR
    const isPaginated =
      minitelMode === 'alpha' ||
      (minitelMode === 'rayons' /* either aisle list or films list */)
    if (isPaginated) {
      const buttons: TrailingBtn[] = []
      if (minitelPageIndex > 0) buttons.push('prev')
      if (minitelPageIndex < totalPagesForMode - 1) buttons.push('next')
      buttons.push('esc')
      return buttons
    }
    return ['esc']                                                      // every other screen: RETOUR/FERMER
  })()

  const itemCount = listItemCount + trailingButtons.length

  const highlightedItem = useStore((s) => s.minitelHighlightedItem)
  const setHighlightedItem = useStore((s) => s.setMinitelHighlightedItem)

  // Dispatch the focused element (list row or trailing button).
  const dispatchFocused = useCallback(() => {
    if (listItemCount > 0 && highlightedItem <= listItemCount) {
      handleNumberPress(highlightedItem)
      return
    }
    const trailingIdx = highlightedItem - listItemCount - 1
    const btn = trailingButtons[trailingIdx] ?? trailingButtons[trailingButtons.length - 1]
    if (btn === 'envoi') handleEnvoi()
    else if (btn === 'prev') handleRetour() // PREC = previous page
    else if (btn === 'next') handleSuite()  // SUIV = next page
    else handleEsc()
  }, [listItemCount, trailingButtons, highlightedItem, handleNumberPress, handleEnvoi, handleEsc, handleRetour, handleSuite])

  // Reset highlight when mode/page/aisle/query/selectedFilm changes — otherwise
  // Enter would dispatch a stale highlightedItem index from previous results.
  useEffect(() => {
    setHighlightedItem(1)
  }, [minitelMode, minitelSelectedAisle, minitelPageIndex, minitelQuery, minitelSelectedFilm, setHighlightedItem])

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
        dispatchFocused()
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
    setHighlightedItem, handleNumberPress, handleEnvoi, handleEsc, handleSuite, handleRetour, dispatchFocused,
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
    } else if (minitelMode === 'commander' && !isAuthenticated && pendingMinitelPress === 1) {
      // SE CONNECTER pill on the !authed commander screen
      handleEnvoi()
    } else {
      handleNumberPress(pendingMinitelPress)
    }
    consumeMinitelItem()
  }, [pendingMinitelPress, minitelMode, isAuthenticated, handleNumberPress, handleEsc, handleEnvoi, handleSuite, handleRetour, consumeMinitelItem])

  if (!isInteractingWithMinitel) return null

  const showInput = minitelMode === 'recherche' || minitelMode === 'commander'
  const isDetail = minitelSelectedFilm != null
  // RAYONS (aisle list) is now paginated when > PAGE_SIZE aisles exist.
  const rayonsHasMultiplePages = (() => {
    if (minitelMode !== 'rayons' || minitelSelectedAisle) return false
    return AISLES_ORDER.filter((a) => (films[a]?.length ?? 0) > 0).length > PAGE_SIZE
  })()
  const isPaged =
    (minitelMode === 'rayons' && minitelSelectedAisle != null) ||
    minitelMode === 'alpha' ||
    rayonsHasMultiplePages
  const helpLines = buildHelpLines(minitelMode, isDetail, isPaged)

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
            border: '1px solid #4FF0E8',
            color: '#4FA8FF',
            fontFamily: "'VT323', 'Courier New', monospace",
            fontSize: 18,
            outline: 'none',
            pointerEvents: 'auto',
            opacity: isMobile ? 1 : 0.001,
          }}
        />
      )}

      {/* Desktop help panel — keyboard legend on the right of the screen.
          Fades in 200ms when the minitel opens, hidden on mobile (the on-
          screen pad below replaces it). */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            top: '50%', right: '6vw',
            transform: 'translateY(-50%)',
            minWidth: 180,
            padding: '14px 16px',
            background: 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${PILL_COLORS.cyan}`,
            color: PILL_COLORS.blue,
            fontFamily: "'VT323', 'Courier New', monospace",
            fontSize: 18,
            lineHeight: 1.35,
            letterSpacing: '0.04em',
            animation: 'minitel-help-fade 200ms ease-out both',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            fontSize: 18,
            color: PILL_COLORS.bg,
            background: PILL_COLORS.cyan,
            padding: '2px 8px',
            margin: '-14px -16px 10px',
            display: 'inline-block',
            width: 'calc(100% + 32px)',
            boxSizing: 'border-box',
          }}>AIDE CLAVIER</div>
          {helpLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
              <span style={{ color: line.color, minWidth: 56 }}>{line.keys}</span>
              <span>{line.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mobile control pad — replaces the desktop help panel. Cluster bottom-
          right, TVTerminal style. ◀▶ hidden when not in paginated modes. */}
      {isMobile && (
        <div style={{
          position: 'absolute',
          right: 'max(env(safe-area-inset-right), 14px)',
          bottom: showInput
            ? 'calc(env(safe-area-inset-bottom, 0px) + 72px)'
            : 'max(env(safe-area-inset-bottom), 14px)',
          display: 'grid',
          gridTemplateColumns: isPaged ? 'auto auto auto' : 'auto auto',
          gridAutoRows: '56px',
          gap: 8,
          pointerEvents: 'none',
        }}>
          {isPaged && (
            <>
              <PadButton onPress={handleRetour} label="◀" disabled={minitelPageIndex <= 0} />
              <PadButton onPress={handleSuite} label="▶" disabled={false} />
              <div /> {/* spacer column to keep grid alignment */}
            </>
          )}
          <PadButton
            onPress={() => setHighlightedItem(highlightedItem <= 1 ? Math.max(itemCount, 1) : highlightedItem - 1)}
            label="▲"
            disabled={itemCount === 0}
          />
          <PadButton
            onPress={dispatchFocused}
            label="OK"
            primary
          />
          <PadButton
            onPress={() => setHighlightedItem(highlightedItem >= itemCount ? 1 : highlightedItem + 1)}
            label="▼"
            disabled={itemCount === 0}
          />
          <PadButton onPress={handleEsc} label="ESC" />
        </div>
      )}

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => setShowAuthModal(false)}
      />

      {/* Keyframes for the help panel fade-in. */}
      <style>{`
        @keyframes minitel-help-fade {
          from { opacity: 0; transform: translateY(-50%) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
      `}</style>
    </div>
  )
}

// Palette mirrored from MinitelScreen.tsx — kept inline so the overlay doesn't
// import the canvas module just for these constants.
const PILL_COLORS = {
  bg: '#000000',
  blue: '#4FA8FF',
  cyan: '#4FF0E8',
  green: '#4FF04F',
  yellow: '#FFE74C',
  magenta: '#FF52C0',
  red: '#E63B3B',
  white: '#FFFFFF',
} as const

// Build the contextual help legend (desktop). Each line returns the key glyph
// + a short label + the colour applied to the key column.
function buildHelpLines(
  mode: string,
  isDetail: boolean,
  isPaged: boolean,
): Array<{ keys: string; label: string; color: string }> {
  if (isDetail) {
    return [
      { keys: '⏎', label: 'ILLUMINER', color: PILL_COLORS.magenta },
      { keys: 'Esc', label: 'RETOUR', color: PILL_COLORS.red },
    ]
  }
  if (mode === 'recherche' || mode === 'commander') {
    const lines: Array<{ keys: string; label: string; color: string }> = [
      { keys: 'A-Z', label: 'TAPER', color: PILL_COLORS.blue },
      { keys: '⏎', label: mode === 'commander' ? 'COMMANDER' : 'VALIDER', color: PILL_COLORS.cyan },
    ]
    lines.push({ keys: '↑ ↓', label: 'NAVIGUER', color: PILL_COLORS.yellow })
    lines.push({ keys: 'Esc', label: 'RETOUR', color: PILL_COLORS.red })
    return lines
  }
  if (mode === 'sommaire' || mode === 'idle') {
    return [
      { keys: '↑ ↓', label: 'NAVIGUER', color: PILL_COLORS.yellow },
      { keys: '⏎', label: 'VALIDER', color: PILL_COLORS.cyan },
      { keys: 'Esc', label: 'QUITTER', color: PILL_COLORS.red },
    ]
  }
  // rayons / alpha
  const lines: Array<{ keys: string; label: string; color: string }> = [
    { keys: '↑ ↓', label: 'NAVIGUER', color: PILL_COLORS.yellow },
  ]
  if (isPaged) lines.push({ keys: 'PgUp/Dn', label: 'PAGE', color: PILL_COLORS.cyan })
  lines.push({ keys: '⏎', label: 'VALIDER', color: PILL_COLORS.cyan })
  lines.push({ keys: 'Esc', label: 'RETOUR', color: PILL_COLORS.red })
  return lines
}

interface PadBtnProps { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }
function PadButton({ label, onPress, disabled, primary }: PadBtnProps) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onPress() }}
      style={{
        width: 56, height: 56,
        background: disabled
          ? 'rgba(0,0,0,0.4)'
          : primary
            ? PILL_COLORS.cyan
            : 'rgba(0,0,0,0.78)',
        border: `1px solid ${primary ? PILL_COLORS.cyan : '#4FA8FF'}`,
        color: disabled
          ? 'rgba(79,168,255,0.35)'
          : primary
            ? PILL_COLORS.bg
            : PILL_COLORS.blue,
        fontFamily: "'VT323', 'Courier New', monospace",
        fontSize: 26,
        lineHeight: 1,
        borderRadius: 4,
        cursor: disabled ? 'default' : 'pointer',
        pointerEvents: 'auto',
        touchAction: 'manipulation',
        userSelect: 'none',
      }}
    >
      {label}
    </button>
  )
}

