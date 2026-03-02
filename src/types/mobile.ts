export interface MobileInput {
  moveX: number           // -1..1 joystick horizontal
  moveZ: number           // -1..1 joystick vertical (forward/backward)
  cameraYawDelta: number  // accumulated between frames
  cameraPitchDelta: number
  tapInteraction: boolean // consumed once per frame
  tapScreenX: number      // screen X of tap (pixels) — for direct raycast
  tapScreenY: number      // screen Y of tap (pixels) — for direct raycast
  pinchZoomDelta: number  // 0 = no pinch, >0 = zoom in, <0 = zoom out
  pinchActive: boolean    // true during 2-finger gesture
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
    pinchZoomDelta: 0,
    pinchActive: false,
  }
}
