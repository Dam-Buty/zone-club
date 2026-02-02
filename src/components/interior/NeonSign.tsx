import { useMemo, useRef, useEffect } from 'react'
import * as THREE from 'three'

interface NeonSignProps {
  text: string
  position: [number, number, number]
  rotation?: [number, number, number]
  color?: string
  size?: number
  glowIntensity?: number
}

// Créer une texture de texte via Canvas 2D
function createTextTexture(
  text: string,
  color: string,
  fontSize: number = 64
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Configurer la police
  const font = `bold ${fontSize}px "Arial Black", Arial, sans-serif`
  ctx.font = font

  // Mesurer le texte
  const metrics = ctx.measureText(text)
  const textWidth = metrics.width
  const textHeight = fontSize * 1.2

  // Dimensionner le canvas avec marge
  canvas.width = Math.ceil(textWidth + 40)
  canvas.height = Math.ceil(textHeight + 20)

  // Fond transparent
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Dessiner le glow (plusieurs passes)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Glow externe
  ctx.shadowColor = color
  ctx.shadowBlur = 20
  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  // Glow moyen
  ctx.shadowBlur = 10
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  // Texte principal
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

export function NeonSign({
  text,
  position,
  rotation = [0, 0, 0],
  color = '#ff2d95',
  size = 0.2,
  glowIntensity = 2,
}: NeonSignProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  const { texture, aspectRatio } = useMemo(() => {
    const tex = createTextTexture(text, color, 64)
    const aspect = tex.image.width / tex.image.height
    return { texture: tex, aspectRatio: aspect }
  }, [text, color])

  // Cleanup texture on unmount
  useEffect(() => {
    return () => {
      texture.dispose()
    }
  }, [texture])

  const width = size * aspectRatio * 1.5
  const height = size * 1.5

  return (
    <group position={position} rotation={rotation}>
      {/* Panneau de fond sombre */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[width + 0.05, height + 0.03]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
      </mesh>

      {/* Texte néon via texture */}
      <mesh ref={meshRef}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          transparent
          emissive={color}
          emissiveIntensity={glowIntensity}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Halo lumineux */}
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

// Panneau avec fond pour les sections (genre labels)
interface SectionSignProps {
  text: string
  position: [number, number, number]
  rotation?: [number, number, number]
  color?: string
  bgColor?: string
  width?: number
  height?: number
}

export function SectionSign({
  text,
  position,
  rotation = [0, 0, 0],
  color = '#ffffff',
  bgColor = '#1a1a2a',
  width = 1,
  height = 0.25,
}: SectionSignProps) {
  const { texture, aspectRatio } = useMemo(() => {
    const tex = createTextTexture(text, color, 48)
    const aspect = tex.image.width / tex.image.height
    return { texture: tex, aspectRatio: aspect }
  }, [text, color])

  useEffect(() => {
    return () => {
      texture.dispose()
    }
  }, [texture])

  const textWidth = Math.min(width * 0.9, height * aspectRatio * 2)
  const textHeight = height * 0.8

  return (
    <group position={position} rotation={rotation}>
      {/* Panneau de fond */}
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[width, height, 0.03]} />
        <meshStandardMaterial color={bgColor} roughness={0.8} />
      </mesh>

      {/* Bordure lumineuse */}
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[width + 0.02, height + 0.02, 0.01]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Texte via texture */}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[textWidth, textHeight]} />
        <meshStandardMaterial
          map={texture}
          transparent
          emissive={color}
          emissiveIntensity={1}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
