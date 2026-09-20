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
// held-key walking / joystick is marked from Controls' useFrame (no repeated DOM
// event), touch look is covered by touchmove below.
//
// ⚠️ pointermove n'est PAS dans cette liste : il est traité à part, voir
// markFromPointerMove. Le mettre ici faisait tourner la scène à plein régime dès
// qu'un pointeur SURVOLAIT la fenêtre, sans le moindre déplacement de caméra.
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'wheel',
  'touchstart',
  'touchmove',
] as const

/**
 * pointermove ne vaut « activité » que s'il fait réellement bouger quelque chose.
 *
 * En pointer lock, pointermove EST le regard : on compte toujours.
 * Hors pointer lock, la caméra ne suit pas la souris — un pointeur posé sur la
 * fenêtre, un trackpad effleuré ou une souris qui dérive maintenaient la scène à
 * plein régime indéfiniment. On ne garde alors que le glissement bouton enfoncé
 * (drag d'un overlay), qui lui anime bien quelque chose.
 *
 * Mesuré avant correctif, scène intérieure au repos : des pointermove synthétiques
 * — donc SANS déplacement réel — faisaient passer le rendu de 20,0 à 59,3 images
 * par seconde. À 5,71 Mpx le GPU sature dès 38,3 images/s : la scène restait donc
 * bloquée à 100 % de GPU tant que le pointeur traînait sur la fenêtre.
 */
function markFromPointerMove(event: Event): void {
  if (typeof document !== 'undefined' && document.pointerLockElement !== null) {
    markRenderActivity()
    return
  }
  if ((event as PointerEvent).buttons) markRenderActivity()
}

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
  window.addEventListener('pointermove', markFromPointerMove, opts)
}
