# Mobile Controls for Three.js R3F — Reference

## Architecture

```
Desktop: PointerLockControls + WASD keyboard + mouse click
Mobile:  VirtualJoystick (ref) + TouchLookArea (drag) + tap interaction
Shared:  MobileInput ref consumed by single useFrame loop
```

## Dual-Input Controls Pattern

The `Controls` component accepts optional `isMobile` + `mobileInputRef` props. When `isMobile=false`, the existing desktop code path is completely unchanged — zero regression risk.

### MobileInput Ref (Zero Re-renders)

```typescript
interface MobileInput {
  moveX: number           // -1..1 joystick horizontal
  moveZ: number           // -1..1 joystick vertical (forward/backward)
  cameraYawDelta: number  // accumulated between frames
  cameraPitchDelta: number
  tapInteraction: boolean // consumed once per frame
}
```

UI components write directly to the ref. useFrame reads and resets deltas each frame. No React state, no re-renders.

### Mobile Camera (No PointerLockControls)

PointerLock API doesn't exist on mobile. Camera rotation is done manually via Euler decomposition:

```typescript
const _euler = new THREE.Euler(0, 0, 0, 'YXZ') // MUST be YXZ for FPS
_euler.setFromQuaternion(camera.quaternion, 'YXZ')
_euler.y += input.cameraYawDelta   // yaw
_euler.x = clamp(_euler.x + input.cameraPitchDelta, -MAX_PITCH, MAX_PITCH)
camera.quaternion.setFromEuler(_euler)
```

### Mobile Movement (No moveRight/moveForward)

Without PointerLockControls, extract camera axes from Euler yaw:

```typescript
_euler.setFromQuaternion(camera.quaternion, 'YXZ')
const yaw = _euler.y
_forward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
_right.set(Math.cos(yaw), 0, -Math.sin(yaw))
camera.position.addScaledVector(_right, -velocity.x)
camera.position.addScaledVector(_forward, -velocity.z)
```

### isActive Abstraction

```typescript
const isActive = isMobile ? true : !!controlsRef.current?.isLocked
```

On mobile, the scene is always active — no "click to lock" step. Set `setPointerLocked(true)` on mount so all existing `isPointerLocked` UI conditions work without changes.

## Virtual Joystick

- **Sizes**: 120px outer ring, 44px knob (Apple HIG min 44px tap target)
- **Dead zone**: 15% magnitude threshold
- **DOM-ref animation**: `knobRef.current.style.transform = ...` — zero React re-renders
- **Multi-touch**: Track by `touch.identifier` — separate from camera touch
- **Normalization**: `scale = (mag - DEAD_ZONE) / (1 - DEAD_ZONE) / mag`
- **Position**: `bottom: calc(24px + env(safe-area-inset-bottom))`

## Touch Look Area

- Full-screen invisible div at z-index 49 (behind joystick at 50)
- Sensitivity: `dx * 0.004` — natural thumb-drag feel
- Tap detection: touch < 200ms + displacement < 10px = interaction

## Mobile-Specific Tuning

- `RAYCAST_INTERVAL = 3` (20/sec vs 30/sec desktop) — save mobile GPU
- Crosshair: 6px dot (vs 20px cross on desktop) — less visual clutter
- Hide "CLIQUEZ" lock prompt + WASD help overlay on mobile
- VHS overlay: horizontal scrollable pill buttons at bottom (vs side columns)

## Viewport Meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
```

```css
canvas { touch-action: none; }
```

- `viewport-fit=cover` enables `env(safe-area-inset-*)` for notch/Dynamic Island
- `user-scalable=no` prevents pinch-zoom breaking 3D interaction
- `touch-action: none` prevents browser default gestures on canvas

## isMobile Detection

```typescript
matchMedia('(pointer: coarse)') || matchMedia('(max-width: 768px)')
```

Hook (`useIsMobile`) re-evaluates on `change` event. Static getter (`getIsMobile()`) for non-React code.

## WebGPU Mobile Support

- Chrome Android 113+ (stable since late 2023)
- Safari 18+ (iOS 18+, Sep 2024)
- No WebGL fallback needed for modern targets
