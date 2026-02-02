import { useMemo, useEffect } from 'react'
import * as THREE from 'three'

interface PosterProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  posterPath?: string
  width?: number
  height?: number
  frameColor?: string
  index?: number
}

const FALLBACK_COLORS = ['#2a1a3a', '#1a2a3a', '#3a2a1a', '#1a3a2a', '#3a1a2a', '#1a3a3a']

export function Poster({
  position,
  rotation = [0, 0, 0],
  posterPath,
  width = 0.4,
  height = 0.6,
  frameColor = '#1a1a1a',
  index = 0,
}: PosterProps) {
  const texture = useMemo(() => {
    if (!posterPath) return null
    const loader = new THREE.TextureLoader()
    const tex = loader.load(`https://image.tmdb.org/t/p/w500${posterPath}`)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [posterPath])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  const fallbackColor = FALLBACK_COLORS[index % FALLBACK_COLORS.length]

  return (
    <group position={position} rotation={rotation}>
      {/* Cadre */}
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.02]} />
        <meshStandardMaterial color={frameColor} roughness={0.4} metalness={0.2} />
      </mesh>

      {/* Affiche */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          color={texture ? '#ffffff' : fallbackColor}
          roughness={0.6}
        />
      </mesh>

      {/* Effet de verre/protection */}
      <mesh position={[0, 0, 0.002]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#ffffff"
          transparent
          opacity={0.05}
          roughness={0.1}
        />
      </mesh>
    </group>
  )
}

// Ensemble d'affiches pour décorer les murs
interface PosterWallProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  posterPaths?: (string | null)[]
  spacing?: number
}

export function PosterWall({
  position,
  rotation = [0, 0, 0],
  posterPaths = [],
  spacing = 0.5,
  posterWidth = 0.42,
  posterHeight = 0.6,
}: PosterWallProps & { posterWidth?: number; posterHeight?: number }) {
  return (
    <group position={position} rotation={rotation}>
      {posterPaths.map((path, i) => (
        <Poster
          key={`poster-${i}`}
          position={[(i - (posterPaths.length - 1) / 2) * spacing, 0, 0]}
          posterPath={path || undefined}
          width={posterWidth}
          height={posterHeight}
          index={i}
        />
      ))}
    </group>
  )
}
