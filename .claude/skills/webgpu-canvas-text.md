---
name: webgpu-canvas-text
description: "Skill for rendering text in WebGPU/Three.js WebGPU scenes using CanvasTexture. Use this skill when implementing 3D text, neon signs, labels, UI text in any WebGPU or Three.js WebGPU project. IMPORTANT: Troika-three-text and @react-three/drei Text components are NOT compatible with WebGPU - always use this CanvasTexture technique instead."
---

# WebGPU Canvas Text Rendering

## CRITICAL: Why This Technique is Required

**Problem**: The standard text solutions for Three.js/R3F do NOT work with WebGPU:
- `@react-three/drei` Text component uses Troika-three-text
- Troika uses GLSL shaders that are incompatible with WebGPU's WGSL
- Result: Text simply doesn't render (invisible or error)

**Source**: https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737

**Solution**: Use HTML5 Canvas 2D to render text, then convert to THREE.CanvasTexture

---

## Complete Implementation

### Basic createTextTexture Function

```typescript
import * as THREE from 'three' // or 'three/webgpu'

function createTextTexture(
  text: string,
  options: {
    fontSize?: number
    fontFamily?: string
    color?: string
    backgroundColor?: string
    width?: number
    height?: number
    glowColor?: string
    align?: CanvasTextAlign
  } = {}
): THREE.CanvasTexture {
  const {
    fontSize = 32,
    fontFamily = 'Arial, sans-serif',
    color = '#ffffff',
    backgroundColor = 'transparent',
    width = 256,
    height = 64,
    glowColor,
    align = 'center',
  } = options

  // Create canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Background
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)
  } else {
    ctx.clearRect(0, 0, width, height)
  }

  // Text configuration
  ctx.font = `bold ${fontSize}px ${fontFamily}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'

  // Glow effect (for neon-style text)
  if (glowColor) {
    ctx.shadowColor = glowColor
    ctx.shadowBlur = 15
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  // Draw text (handles multiline)
  const lines = text.split('\n')
  const lineHeight = fontSize * 1.2
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2

  ctx.fillStyle = color
  lines.forEach((line, i) => {
    const x = align === 'center' ? width / 2 : align === 'left' ? 10 : width - 10
    ctx.fillText(line, x, startY + i * lineHeight)
  })

  // Create Three.js texture
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}
```

---

## Usage in React Three Fiber

### Basic Text Plane

```tsx
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'

function TextLabel({ text, position, color = '#ffffff' }) {
  const texture = useMemo(() => {
    return createTextTexture(text, {
      fontSize: 32,
      color: color,
      width: 256,
      height: 64,
    })
  }, [text, color])

  // Cleanup on unmount
  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  return (
    <mesh position={position}>
      <planeGeometry args={[2, 0.5]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  )
}
```

### Neon Sign with Glow

```tsx
function NeonSign({ text, position, color = '#ff2d95', size = 0.2 }) {
  const { texture, aspectRatio } = useMemo(() => {
    const tex = createTextTexture(text, {
      fontSize: 64,
      color: '#ffffff',
      glowColor: color,
      width: 512,
      height: 128,
    })
    const aspect = tex.image.width / tex.image.height
    return { texture: tex, aspectRatio: aspect }
  }, [text, color])

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  const width = size * aspectRatio * 1.5
  const height = size * 1.5

  return (
    <group position={position}>
      {/* Dark background panel */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[width + 0.05, height + 0.03]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
      </mesh>

      {/* Neon text */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          transparent
          emissive={color}
          emissiveIntensity={2}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Glow light */}
      <pointLight
        position={[0, 0, 0.1]}
        color={color}
        intensity={0.4}
        distance={1.5}
        decay={2}
      />
    </group>
  )
}
```

---

## Advanced: Auto-Sizing Text

```typescript
function createAutoSizedTextTexture(
  text: string,
  color: string,
  fontSize: number = 64
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Measure text first
  const font = `bold ${fontSize}px "Arial Black", Arial, sans-serif`
  ctx.font = font
  const metrics = ctx.measureText(text)
  const textWidth = metrics.width
  const textHeight = fontSize * 1.2

  // Size canvas to fit text with margin
  canvas.width = Math.ceil(textWidth + 40)
  canvas.height = Math.ceil(textHeight + 20)

  // Clear and setup
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Multiple glow passes for neon effect
  ctx.shadowColor = color
  ctx.shadowBlur = 20
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  ctx.shadowBlur = 10
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  // Core white text
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}
```

---

## Dynamic/Animated Text

For text that updates frequently (counters, scores, etc.):

```tsx
function DynamicText({ value, position }) {
  const canvasRef = useRef<HTMLCanvasElement>()
  const textureRef = useRef<THREE.CanvasTexture>()

  // Initialize once
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    canvasRef.current = canvas
    textureRef.current = new THREE.CanvasTexture(canvas)
    textureRef.current.colorSpace = THREE.SRGBColorSpace

    return () => textureRef.current?.dispose()
  }, [])

  // Update when value changes
  useEffect(() => {
    if (!canvasRef.current || !textureRef.current) return

    const ctx = canvasRef.current.getContext('2d')!
    ctx.clearRect(0, 0, 256, 64)
    ctx.font = 'bold 32px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#00ff00'
    ctx.fillText(String(value), 128, 32)

    textureRef.current.needsUpdate = true
  }, [value])

  return (
    <mesh position={position}>
      <planeGeometry args={[2, 0.5]} />
      <meshBasicMaterial map={textureRef.current} transparent />
    </mesh>
  )
}
```

---

## Common Neon Colors

```typescript
const NEON_COLORS = {
  pink: '#ff2d95',
  cyan: '#00fff7',
  purple: '#b026ff',
  yellow: '#fff600',
  green: '#00ff00',
  orange: '#ff8800',
  red: '#ff4444',
  blue: '#0088ff',
}
```

---

## Best Practices

### DO:
- Always dispose textures on component unmount
- Use `toneMapped={false}` for emissive/glowing text
- Use `THREE.SRGBColorSpace` for correct color rendering
- Use `useMemo` to avoid recreating textures on every render
- Calculate aspect ratio from canvas dimensions for proper sizing

### DON'T:
- Don't use @react-three/drei Text component with WebGPU
- Don't use Troika-three-text with WebGPU
- Don't create textures in render/useFrame loops
- Don't forget to handle multiline text with `\n`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Text invisible | Check `transparent={true}` on material |
| Colors washed out | Add `toneMapped={false}` |
| Text pixelated | Increase canvas width/height and fontSize |
| Text too small | Adjust plane geometry size |
| Memory leak | Add `texture.dispose()` in useEffect cleanup |
| Wrong orientation | Use `side={THREE.DoubleSide}` |

---

## References

- Three.js CanvasTexture: https://threejs.org/docs/#api/en/textures/CanvasTexture
- HTML5 Canvas Text API: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
- Troika WebGPU Issue: https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737
