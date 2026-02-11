import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface CRTMonitorProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  screenColor?: string
}

export function CRTMonitor({
  position,
  rotation = [0, 0, 0],
  scale = 1,
  screenColor = '#0033aa',
}: CRTMonitorProps) {
  const screenRef = useRef<THREE.Mesh>(null)
  const timeRef = useRef(0)

  // Animation subtile de l'écran (effet de scan lines / flicker)
  useFrame((_, delta) => {
    timeRef.current += delta
    if (screenRef.current) {
      const material = screenRef.current.material as THREE.MeshStandardMaterial
      // Légère variation d'intensité pour simuler le flicker CRT
      material.emissiveIntensity = 0.8 + Math.sin(timeRef.current * 10) * 0.1
    }
  })

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* Corps du moniteur (boîtier plastique beige/gris) */}
      <mesh position={[0, 0, -0.15]}>
        <boxGeometry args={[0.5, 0.45, 0.35]} />
        <meshStandardMaterial color="#c4b8a8" roughness={0.7} />
      </mesh>

      {/* Partie avant avec bords arrondis (simulé) */}
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[0.48, 0.43, 0.05]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.5} />
      </mesh>

      {/* Écran CRT (légèrement bombé visuellement) */}
      <mesh ref={screenRef} position={[0, 0.02, 0.05]}>
        <planeGeometry args={[0.36, 0.28]} />
        <meshStandardMaterial
          color={screenColor}
          emissive={screenColor}
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>

      {/* Reflet sur l'écran */}
      <mesh position={[0, 0.02, 0.051]}>
        <planeGeometry args={[0.36, 0.28]} />
        <meshStandardMaterial
          color="#ffffff"
          transparent
          opacity={0.08}
          roughness={0.1}
        />
      </mesh>

      {/* Panneau de contrôle sous l'écran */}
      <mesh position={[0, -0.17, 0.03]}>
        <boxGeometry args={[0.44, 0.06, 0.02]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.6} />
      </mesh>

      {/* Boutons de contrôle */}
      {[-0.12, -0.04, 0.04, 0.12].map((x, i) => (
        <mesh key={`btn-${i}`} position={[x, -0.17, 0.045]}>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 8]} />
          <meshStandardMaterial
            color={i === 0 ? '#00aa00' : '#444444'}
            emissive={i === 0 ? '#00aa00' : '#000000'}
            emissiveIntensity={i === 0 ? 0.5 : 0}
          />
        </mesh>
      ))}

      {/* Ventilation arrière */}
      <mesh position={[0, 0, -0.33]}>
        <boxGeometry args={[0.35, 0.25, 0.02]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
      </mesh>

      {/* Lumière émise par l'écran */}
      <pointLight
        position={[0, 0, 0.2]}
        color={screenColor}
        intensity={0.3}
        distance={1.5}
        decay={2}
      />
    </group>
  )
}

// TV sur pied/meuble pour affichage promotionnel
interface TVDisplayProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function TVDisplay({ position, rotation = [0, 0, 0] }: TVDisplayProps) {
  return (
    <group position={position} rotation={rotation}>
      {/* Meuble/support */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.6, 0.8, 0.4]} />
        <meshStandardMaterial color="#2a2018" roughness={0.7} />
      </mesh>

      {/* Plateau supérieur */}
      <mesh position={[0, 0.82, 0]}>
        <boxGeometry args={[0.65, 0.04, 0.45]} />
        <meshStandardMaterial color="#1a1a12" roughness={0.5} />
      </mesh>

      {/* TV CRT sur le meuble */}
      <CRTMonitor
        position={[0, 1.1, 0]}
        screenColor="#001166"
      />

      {/* Magnétoscope sous la TV */}
      <mesh position={[0, 0.92, 0.1]}>
        <boxGeometry args={[0.4, 0.08, 0.3]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* LED du magnétoscope */}
      <mesh position={[0.12, 0.92, 0.26]}>
        <boxGeometry args={[0.06, 0.02, 0.01]} />
        <meshStandardMaterial
          color="#00ff00"
          emissive="#00ff00"
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Cassettes VHS empilées à côté */}
      <group position={[-0.22, 0.86, 0.1]}>
        {[0, 1, 2].map((i) => (
          <mesh key={`vhs-${i}`} position={[0, i * 0.025, 0]}>
            <boxGeometry args={[0.1, 0.02, 0.18]} />
            <meshStandardMaterial
              color={['#1a1a2e', '#2e1a1a', '#1a2e1a'][i]}
              roughness={0.5}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}
