import { useRef, useEffect, useState, type MutableRefObject } from 'react'
import { VirtualJoystick } from './VirtualJoystick'
import { TouchLookArea } from './TouchLookArea'
import { useStore } from '../../store'
import type { MobileInput } from '../../types/mobile'

interface MobileControlsProps {
  mobileInputRef: MutableRefObject<MobileInput>
}

export function MobileControls({ mobileInputRef }: MobileControlsProps) {
  const [showInteract, setShowInteract] = useState(false)
  const prevKeyRef = useRef<string | null>(null)

  // Imperative subscription to targetedCassetteKey — no React re-renders from raycast
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      const key = state.targetedCassetteKey
      if (key !== prevKeyRef.current) {
        prevKeyRef.current = key
        setShowInteract(key !== null)
      }
    })
    return unsub
  }, [])

  const handleInteractTap = () => {
    mobileInputRef.current.tapInteraction = true
  }

  return (
    <>
      <TouchLookArea mobileInputRef={mobileInputRef} />
      <VirtualJoystick mobileInputRef={mobileInputRef} />

      {/* Interact button — bottom right, only when targeting a cassette */}
      {showInteract && (
        <button
          onTouchStart={handleInteractTap}
          style={{
            position: 'fixed',
            right: '20px',
            bottom: `calc(20px + env(safe-area-inset-bottom, 0px))`,
            width: 76,
            height: 76,
            borderRadius: '50%',
            border: '3px solid rgba(255, 45, 149, 0.9)',
            background: 'rgba(255, 45, 149, 0.35)',
            boxShadow: '0 0 20px rgba(255, 45, 149, 0.6)',
            color: '#fff',
            fontSize: '1.5rem',
            fontFamily: 'Orbitron, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
            zIndex: 51,
            cursor: 'pointer',
          }}
        >
          E
        </button>
      )}
    </>
  )
}
