import { useEffect, useRef } from 'react'

// Centralized back-gesture guard for overlays/modals/zoomed states.
//
// Each call to useBackGuard pushes one synthetic history entry when its
// `isOpen` flag flips true. When the user triggers the system back gesture,
// the entry is popped and our global popstate handler closes the most
// recently registered overlay (LIFO). When the overlay is closed via a UI
// button instead, the hook's cleanup quietly rewinds its own entry — gated
// by a `suppressedPops` counter so the resulting popstate event doesn't
// trigger the global handler and cascade-close other overlays.

type Handler = { id: number; close: () => void; consumed: boolean }

const handlers: Handler[] = []
let nextId = 0
let globalListenerInstalled = false
let suppressedPops = 0

function ensureGlobalListener(): void {
  if (globalListenerInstalled || typeof window === 'undefined') return
  globalListenerInstalled = true
  window.addEventListener('popstate', () => {
    if (suppressedPops > 0) {
      suppressedPops--
      return
    }
    const top = handlers.pop()
    if (top) {
      top.consumed = true
      try { top.close() } catch { /* swallow — never block back nav */ }
    }
  })
}

/**
 * Register a back-gesture handler while `isOpen` is true. On system back press
 * `onClose` is called and our synthetic history entry is consumed by the
 * browser. On UI-button close (state changes externally), the hook's cleanup
 * silently rewinds its history entry so entries don't accumulate across many
 * open/close cycles.
 */
export function useBackGuard(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    ensureGlobalListener()
    const id = ++nextId
    const h: Handler = { id, close: () => onCloseRef.current(), consumed: false }
    handlers.push(h)
    try {
      window.history.pushState({ overlayGuard: id }, '')
    } catch {
      const idx = handlers.indexOf(h)
      if (idx >= 0) handlers.splice(idx, 1)
      return
    }
    return () => {
      const idx = handlers.findIndex(x => x.id === id)
      if (idx >= 0) handlers.splice(idx, 1)
      if (!h.consumed) {
        // Closed via UI / state change — pop our entry silently.
        suppressedPops++
        try {
          window.history.back()
        } catch {
          suppressedPops = Math.max(0, suppressedPops - 1)
        }
      }
    }
  }, [isOpen])
}
