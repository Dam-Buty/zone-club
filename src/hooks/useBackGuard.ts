import { useEffect, useRef } from 'react'

// Centralized back-gesture guard for overlays/modals/zoomed states.
//
// PROBLEM: on mobile, the system back gesture (Android / iOS edge-swipe) calls
// `history.back()` which, for a SPA at a single URL, exits the page entirely.
// Users expect back to close the current overlay/menu/zoom (TV menu, VHS case,
// player, manager chat, etc.) before leaving the site.
//
// PATTERN: at overlay open we push a synthetic history entry. The system back
// then pops that entry, fires `popstate`, and our global handler closes the
// most recently registered overlay. If the user closes the overlay via a UI
// button instead (no back gesture), the extra history entry stays around — it
// just means one extra back press is eventually needed to leave the page,
// which is harmless and avoids cascade-close bugs from manually rewinding
// the history during React cleanup.

type Handler = { id: number; close: () => void }

const handlers: Handler[] = []
let nextId = 0
let globalListenerInstalled = false

function ensureGlobalListener(): void {
  if (globalListenerInstalled || typeof window === 'undefined') return
  globalListenerInstalled = true
  window.addEventListener('popstate', () => {
    const top = handlers.pop()
    if (top) {
      try { top.close() } catch { /* swallow — never block back nav */ }
    }
  })
}

/**
 * When `isOpen` is true, register a back-gesture handler that calls `onClose`
 * when the user presses the system back button. The hook handles its own
 * lifecycle — no manual cleanup needed.
 */
export function useBackGuard(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    ensureGlobalListener()
    const id = ++nextId
    const h: Handler = { id, close: () => onCloseRef.current() }
    handlers.push(h)
    try {
      window.history.pushState({ overlayGuard: id }, '')
    } catch {
      // History API may throw in private contexts — degrade gracefully.
      const idx = handlers.indexOf(h)
      if (idx >= 0) handlers.splice(idx, 1)
      return
    }
    return () => {
      const idx = handlers.findIndex(x => x.id === id)
      if (idx >= 0) handlers.splice(idx, 1)
    }
  }, [isOpen])
}
