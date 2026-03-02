import { useRef, useEffect, type MutableRefObject } from 'react'
import type { MobileInput } from '../../types/mobile'

const SENSITIVITY = 0.005
const TAP_MAX_DURATION = 200  // ms
const TAP_MAX_DISTANCE = 10  // px

interface TouchLookAreaProps {
  mobileInputRef: MutableRefObject<MobileInput>
}

export function TouchLookArea({ mobileInputRef }: TouchLookAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const activeTouchRef = useRef<number | null>(null)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 })
  // Pinch state
  const pinchStartDistRef = useRef(0)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return

    const getTouchDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)

    const handleTouchStart = (e: TouchEvent) => {
      // 2+ fingers → enter pinch mode
      if (e.touches.length >= 2) {
        const dist = getTouchDist(e.touches[0], e.touches[1])
        pinchStartDistRef.current = dist
        mobileInputRef.current.pinchActive = true
        mobileInputRef.current.pinchZoomDelta = 0
        // Cancel single-finger look tracking
        activeTouchRef.current = null
        return
      }

      // Single finger → normal look (only if not already tracking)
      if (activeTouchRef.current !== null) return
      const touch = e.changedTouches[0]
      activeTouchRef.current = touch.identifier
      lastPosRef.current = { x: touch.clientX, y: touch.clientY }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: performance.now() }
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Pinch mode — compute cumulative distance delta
      if (e.touches.length >= 2 && mobileInputRef.current.pinchActive) {
        const dist = getTouchDist(e.touches[0], e.touches[1])
        // Positive = fingers spread = zoom in, normalized by screen height
        mobileInputRef.current.pinchZoomDelta =
          (dist - pinchStartDistRef.current) / window.innerHeight
        return
      }

      // Single finger look
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === activeTouchRef.current) {
          const dx = touch.clientX - lastPosRef.current.x
          const dy = touch.clientY - lastPosRef.current.y

          mobileInputRef.current.cameraYawDelta += -dx * SENSITIVITY
          mobileInputRef.current.cameraPitchDelta += -dy * SENSITIVITY

          lastPosRef.current = { x: touch.clientX, y: touch.clientY }
          break
        }
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      // Exiting pinch mode (was 2+ fingers, now < 2)
      if (mobileInputRef.current.pinchActive && e.touches.length < 2) {
        mobileInputRef.current.pinchActive = false
        mobileInputRef.current.pinchZoomDelta = 0
        activeTouchRef.current = null
        // If one finger remains, re-init look tracking from its current position (no jerk)
        if (e.touches.length === 1) {
          const remaining = e.touches[0]
          activeTouchRef.current = remaining.identifier
          lastPosRef.current = { x: remaining.clientX, y: remaining.clientY }
        }
        return
      }

      // Normal single-finger end
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === activeTouchRef.current) {
          activeTouchRef.current = null

          // Tap detection
          const dt = performance.now() - touchStartRef.current.time
          const ddx = touch.clientX - touchStartRef.current.x
          const ddy = touch.clientY - touchStartRef.current.y
          const dist = Math.sqrt(ddx * ddx + ddy * ddy)

          if (dt < TAP_MAX_DURATION && dist < TAP_MAX_DISTANCE) {
            mobileInputRef.current.tapInteraction = true
            mobileInputRef.current.tapScreenX = touch.clientX
            mobileInputRef.current.tapScreenY = touch.clientY
          }
          break
        }
      }
    }

    area.addEventListener('touchstart', handleTouchStart, { passive: true })
    area.addEventListener('touchmove', handleTouchMove, { passive: true })
    area.addEventListener('touchend', handleTouchEnd, { passive: true })
    area.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      area.removeEventListener('touchstart', handleTouchStart)
      area.removeEventListener('touchmove', handleTouchMove)
      area.removeEventListener('touchend', handleTouchEnd)
      area.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [mobileInputRef])

  return (
    <div
      ref={areaRef}
      style={{
        position: 'fixed',
        inset: 0,
        touchAction: 'none',
        zIndex: 49,
      }}
    />
  )
}
