// Render activity tracker — drives the adaptive frame throttle in PostProcessingEffects.
//
// Problem: with R3F's default frameloop="always", the interior re-renders the full
// post-processing chain (~15 passes, measured) at the display refresh (120 fps on
// ProMotion) even when the player stands perfectly still — disproportionate GPU for
// an essentially static frame. It is NOT shadows (caching already freezes them) nor
// texture refresh; it is the render loop redrawing identical frames.
//
// Strategy: keep frameloop="always" (so the few ambient micro-animations — dust,
// breathing, neon/TV flicker — keep ticking and instant input stays instant), but
// THROTTLE the expensive render() to ACTIVE_FPS while the player is doing something
// and to IDLE_FPS once they've been idle past ACTIVE_GRACE_MS.
//
// This module records the timestamp of the last user activity. The render driver
// reads getLastRenderActivity() to decide the current frame budget.

let lastActivity = typeof performance !== 'undefined' ? performance.now() : 0
let installed = false

/** Mark "the user did something" — bumps the scene back to full framerate. */
export function markRenderActivity(): void {
  lastActivity = typeof performance !== 'undefined' ? performance.now() : 0
}

/** Timestamp (performance.now() domain) of the last recorded activity. */
export function getLastRenderActivity(): number {
  return lastActivity
}

// Discrete + continuous input that should keep the scene at full framerate.
// pointermove fires during pointer-lock (FPS look) with movementX/Y, so desktop
// look is covered here; held-key walking is marked from Controls' useFrame.
const ACTIVITY_EVENTS = [
  'pointermove',
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'wheel',
  'touchstart',
  'touchmove',
] as const

/**
 * Install the window-level activity listeners once for the session. Idempotent —
 * safe to call on every mount. Listeners are passive/capture and session-lifetime
 * (cleared on page unload), so no teardown is needed.
 */
export function installRenderActivityListeners(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true
  const mark = () => markRenderActivity()
  const opts: AddEventListenerOptions = { passive: true, capture: true }
  for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, mark, opts)
}
