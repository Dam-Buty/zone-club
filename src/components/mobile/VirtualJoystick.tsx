import { useRef, useEffect, useCallback, type MutableRefObject } from 'react'
import type { MobileInput } from '../../types/mobile'

const OUTER_SIZE = 160
const KNOB_SIZE = 60
const MAX_OFFSET = (OUTER_SIZE - KNOB_SIZE) / 2
const DEAD_ZONE = 0.15

interface VirtualJoystickProps {
  mobileInputRef: MutableRefObject<MobileInput>
}

export function VirtualJoystick({ mobileInputRef }: VirtualJoystickProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const activeTouchRef = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })

  const resetKnob = useCallback(() => {
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(-50%, -50%)'
    }
    mobileInputRef.current.moveX = 0
    mobileInputRef.current.moveZ = 0
  }, [mobileInputRef])

  const updateKnob = useCallback((clientX: number, clientY: number) => {
    let dx = clientX - centerRef.current.x
    let dy = clientY - centerRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Clamp to outer ring
    if (dist > MAX_OFFSET) {
      dx = (dx / dist) * MAX_OFFSET
      dy = (dy / dist) * MAX_OFFSET
    }

    // Move knob via DOM ref (zero re-renders)
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }

    // Normalize to -1..1
    const nx = dx / MAX_OFFSET
    const ny = dy / MAX_OFFSET

    // Apply dead zone + power curve for precision near shelves
    const mag = Math.sqrt(nx * nx + ny * ny)
    if (mag < DEAD_ZONE) {
      mobileInputRef.current.moveX = 0
      mobileInputRef.current.moveZ = 0
    } else {
      const linear = (mag - DEAD_ZONE) / (1 - DEAD_ZONE)
      // Power curve: slow at small deflection, fast at full throw
      const curved = Math.pow(linear, 1.5)
      const scale = curved / mag
      mobileInputRef.current.moveX = nx * scale
      mobileInputRef.current.moveZ = -ny * scale // inverted: drag up = move forward = positive Z
    }
  }, [mobileInputRef])

  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return

    const handleTouchStart = (e: TouchEvent) => {
      if (activeTouchRef.current !== null) return
      const touch = e.changedTouches[0]
      activeTouchRef.current = touch.identifier

      const rect = outer.getBoundingClientRect()
      centerRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
      updateKnob(touch.clientX, touch.clientY)
    }

    const handleTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === activeTouchRef.current) {
          updateKnob(touch.clientX, touch.clientY)
          break
        }
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchRef.current) {
          activeTouchRef.current = null
          resetKnob()
          break
        }
      }
    }

    outer.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      outer.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [updateKnob, resetKnob])

  return (
    <div
      ref={outerRef}
      style={{
        position: 'fixed',
        left: '24px',
        bottom: `calc(24px + env(safe-area-inset-bottom, 0px))`,
        width: OUTER_SIZE,
        height: OUTER_SIZE,
        borderRadius: '50%',
        border: '2px solid rgba(0, 255, 247, 0.3)',
        background: 'rgba(0, 0, 0, 0.25)',
        touchAction: 'none',
        zIndex: 50,
      }}
    >
      <div
        ref={knobRef}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: '50%',
          background: 'rgba(255, 45, 149, 0.6)',
          border: '2px solid rgba(255, 45, 149, 0.8)',
          boxShadow: '0 0 12px rgba(255, 45, 149, 0.4)',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
