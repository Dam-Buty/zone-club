import { useMemo, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface StoreSignProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

// Créer la texture de l'enseigne VIDEO CLUB
function createStoreSignTexture(): THREE.CanvasTexture {
  const width = 1024
  const height = 256
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // Fond très sombre
  ctx.fillStyle = '#050510'
  ctx.fillRect(0, 0, width, height)

  // Bordure néon extérieure
  ctx.strokeStyle = '#00ffff'
  ctx.lineWidth = 6
  ctx.shadowColor = '#00ffff'
  ctx.shadowBlur = 30
  ctx.strokeRect(10, 10, width - 20, height - 20)

  // Bordure néon intérieure
  ctx.strokeStyle = '#ff2d95'
  ctx.lineWidth = 3
  ctx.shadowColor = '#ff2d95'
  ctx.shadowBlur = 20
  ctx.strokeRect(20, 20, width - 40, height - 40)

  // Texte VIDEO
  const videoFontSize = 90
  ctx.font = `bold ${videoFontSize}px "Impact", "Arial Black", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Glow pour VIDEO
  ctx.shadowColor = '#00ffff'
  ctx.shadowBlur = 25
  ctx.fillStyle = '#00ffff'
  ctx.fillText('VIDEO', width * 0.3, height / 2)

  // Core blanc pour VIDEO
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ffffff'
  ctx.fillText('VIDEO', width * 0.3, height / 2)

  // Texte CLUB
  ctx.shadowColor = '#ff2d95'
  ctx.shadowBlur = 25
  ctx.fillStyle = '#ff2d95'
  ctx.fillText('CLUB', width * 0.7, height / 2)

  // Core blanc pour CLUB
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ffffff'
  ctx.fillText('CLUB', width * 0.7, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return texture
}

export function StoreSign({ position, rotation = [0, 0, 0] }: StoreSignProps) {
  const groupRef = useRef<THREE.Group>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const timeRef = useRef(0)

  const texture = useMemo(() => createStoreSignTexture(), [])

  useEffect(() => {
    return () => texture.dispose()
  }, [texture])

  // Animation subtile de l'enseigne
  useFrame((_, delta) => {
    timeRef.current += delta

    // Flicker subtil de la lumière
    if (lightRef.current) {
      lightRef.current.intensity = 0.8 + Math.sin(timeRef.current * 8) * 0.1
    }
  })

  const signWidth = 3.5
  const signHeight = 0.8

  return (
    <group position={position} rotation={rotation} ref={groupRef}>
      {/* Support métallique */}
      <mesh position={[0, signHeight * 0.6, -0.1]}>
        <boxGeometry args={[signWidth + 0.2, 0.05, 0.15]} />
        <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* Câbles de suspension */}
      {[-signWidth * 0.4, signWidth * 0.4].map((x, i) => (
        <mesh key={`cable-${i}`} position={[x, signHeight * 0.7, -0.05]}>
          <cylinderGeometry args={[0.01, 0.01, 0.3, 6]} />
          <meshStandardMaterial color="#666666" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}

      {/* Boîtier de l'enseigne */}
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[signWidth + 0.1, signHeight + 0.1, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>

      {/* Face de l'enseigne avec texture */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[signWidth, signHeight]} />
        <meshStandardMaterial
          map={texture}
          emissive="#ffffff"
          emissiveIntensity={0.5}
          emissiveMap={texture}
          toneMapped={false}
        />
      </mesh>

      {/* Lumières néon autour */}
      <pointLight
        ref={lightRef}
        position={[0, 0, 0.5]}
        color="#00ffff"
        intensity={0.8}
        distance={4}
        decay={2}
      />
      <pointLight
        position={[-1, 0, 0.3]}
        color="#ff2d95"
        intensity={0.4}
        distance={2}
        decay={2}
      />
      <pointLight
        position={[1, 0, 0.3]}
        color="#ff2d95"
        intensity={0.4}
        distance={2}
        decay={2}
      />

      {/* Tubes néon décoratifs sur les côtés */}
      {[-1, 1].map((side, i) => (
        <mesh key={`tube-${i}`} position={[side * (signWidth / 2 + 0.08), 0, 0]}>
          <boxGeometry args={[0.03, signHeight - 0.1, 0.03]} />
          <meshStandardMaterial
            color={side === -1 ? '#00ffff' : '#ff2d95'}
            emissive={side === -1 ? '#00ffff' : '#ff2d95'}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
