import { useEffect, useRef } from 'react'
import { createBackGuardStack } from './back-guard-stack'

// Centralized back-gesture guard for overlays/modals/zoomed states.
//
// Each call to useBackGuard registers one guard while its `isOpen` flag is true. When the user
// triggers the system back gesture, the most recently opened guard is closed (LIFO). When the
// overlay is closed via a UI button instead, its history entry is rewound quietly, without
// cascade-closing other overlays.
//
// The bookkeeping lives in back-guard-stack.ts (no React, no window) so it can be tested:
// tests/domain/back-guard.test.mjs.

const stack = createBackGuardStack({
  history: () => window.history,
  defer: (task) => { window.setTimeout(task, 0) },
})

let globalListenerInstalled = false

function ensureGlobalListener(): void {
  if (globalListenerInstalled || typeof window === 'undefined') return
  globalListenerInstalled = true
  window.addEventListener('popstate', () => stack.handlePop())
}

/**
 * Retient ou libère l'historique pour toutes les gardes (voir « RETENUE » dans back-guard-stack.ts). Appelé par la
 * tranche du Cast : vrai tant que le sélecteur d'appareils est ouvert.
 */
export function holdBackGuards(held: boolean): void {
  stack.hold(held)
}

/**
 * Register a back-gesture handler while `isOpen` is true. On system back press `onClose` is
 * called and the guard's history entry is consumed by the browser. On UI-button close (state
 * changes externally), the entry is rewound so entries don't accumulate across open/close cycles.
 */
export function useBackGuard(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  // Toujours la dernière fonction reçue, sans rouvrir la garde à chaque rendu.
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    ensureGlobalListener()
    return stack.open(() => onCloseRef.current())
  }, [isOpen])
}
