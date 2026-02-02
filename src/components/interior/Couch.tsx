import { useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store'

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)

  // Couleurs du canapé vintage
  const fabricColor = '#6b2d5c' // Violet foncé rétro
  const woodColor = '#3a2a1a'

  const handleClick = () => {
    if (onSit) {
      onSit()
    }
  }

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Base/Structure */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.1, 0.5]} />
        <meshStandardMaterial color={woodColor} roughness={0.7} />
      </mesh>

      {/* Assise (coussin) */}
      <mesh
        position={[0, 0.28, 0.02]}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.85, 0.12, 0.45]} />
        <meshStandardMaterial color={fabricColor} roughness={0.9} />
      </mesh>

      {/* Dossier */}
      <mesh position={[0, 0.45, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 0.35, 0.1]} />
        <meshStandardMaterial color={fabricColor} roughness={0.9} />
      </mesh>

      {/* Accoudoir gauche */}
      <mesh position={[-0.4, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.25, 0.5]} />
        <meshStandardMaterial color={fabricColor} roughness={0.9} />
      </mesh>

      {/* Accoudoir droit */}
      <mesh position={[0.4, 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.25, 0.5]} />
        <meshStandardMaterial color={fabricColor} roughness={0.9} />
      </mesh>

      {/* Pieds en bois */}
      {[
        [-0.35, 0.05, 0.18],
        [0.35, 0.05, 0.18],
        [-0.35, 0.05, -0.18],
        [0.35, 0.05, -0.18],
      ].map((pos, i) => (
        <mesh key={`foot-${i}`} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.03, 0.025, 0.1, 8]} />
          <meshStandardMaterial color={woodColor} roughness={0.6} />
        </mesh>
      ))}

      {/* Coussin décoratif */}
      <mesh position={[-0.25, 0.38, 0.05]} rotation={[0.2, 0.3, 0.1]} castShadow>
        <boxGeometry args={[0.18, 0.15, 0.08]} />
        <meshStandardMaterial color="#ff6b9d" roughness={0.95} />
      </mesh>

      {/* Zone de clic invisible pour s'asseoir */}
      <mesh position={[0, 0.35, 0]} onClick={handleClick} visible={false}>
        <boxGeometry args={[0.9, 0.3, 0.5]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
