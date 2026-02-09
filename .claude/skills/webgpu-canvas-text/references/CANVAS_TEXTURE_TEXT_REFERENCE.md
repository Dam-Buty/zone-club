# Canvas Texture Text - Full Reference

## Complete createTextTexture Function

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

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}
```

---

## R3F Usage: Basic Text Label

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

---

## R3F Usage: Neon Sign with Glow

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

## Auto-Sizing Text

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

## Dynamic / Animated Text

For text that updates frequently (counters, scores, etc.):

```tsx
function DynamicText({ value, position }) {
  const canvasRef = useRef<HTMLCanvasElement>()
  const textureRef = useRef<THREE.CanvasTexture>()

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    canvasRef.current = canvas
    textureRef.current = new THREE.CanvasTexture(canvas)
    textureRef.current.colorSpace = THREE.SRGBColorSpace
    return () => textureRef.current?.dispose()
  }, [])

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

## Neon Colors

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
