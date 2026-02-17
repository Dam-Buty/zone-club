import { type MutableRefObject } from 'react'
import { VirtualJoystick } from './VirtualJoystick'
import { TouchLookArea } from './TouchLookArea'
import type { MobileInput } from '../../types/mobile'

interface MobileControlsProps {
  mobileInputRef: MutableRefObject<MobileInput>
}

export function MobileControls({ mobileInputRef }: MobileControlsProps) {
  return (
    <>
      <TouchLookArea mobileInputRef={mobileInputRef} />
      <VirtualJoystick mobileInputRef={mobileInputRef} />
    </>
  )
}
