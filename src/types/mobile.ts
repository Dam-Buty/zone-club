export interface MobileInput {
  moveX: number           // -1..1 joystick horizontal
  moveZ: number           // -1..1 joystick vertical (forward/backward)
  cameraYawDelta: number  // accumulated between frames
  cameraPitchDelta: number
  tapInteraction: boolean // consumed once per frame
}

export function createMobileInput(): MobileInput {
  return {
    moveX: 0,
    moveZ: 0,
    cameraYawDelta: 0,
    cameraPitchDelta: 0,
    tapInteraction: false,
  }
}
