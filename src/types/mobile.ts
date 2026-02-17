export interface MobileInput {
  moveX: number           // -1..1 joystick horizontal
  moveZ: number           // -1..1 joystick vertical (forward/backward)
  cameraYawDelta: number  // accumulated between frames
  cameraPitchDelta: number
  tapInteraction: boolean // consumed once per frame
  tapScreenX: number      // screen X of tap (pixels) — for direct raycast
  tapScreenY: number      // screen Y of tap (pixels) — for direct raycast
}

export function createMobileInput(): MobileInput {
  return {
    moveX: 0,
    moveZ: 0,
    cameraYawDelta: 0,
    cameraPitchDelta: 0,
    tapInteraction: false,
    tapScreenX: 0,
    tapScreenY: 0,
  }
}
