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

  useEffect(() => {
    const area = areaRef.current
    if (!area) return

    const handleTouchStart = (e: TouchEvent) => {
      if (activeTouchRef.current !== null) return
      const touch = e.changedTouches[0]
      activeTouchRef.current = touch.identifier
      lastPosRef.current = { x: touch.clientX, y: touch.clientY }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: performance.now() }
    }

    const handleTouchMove = (e: TouchEvent) => {
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
