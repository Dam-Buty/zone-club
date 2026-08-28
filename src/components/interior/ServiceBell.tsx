import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { createTextTexture } from '../../utils/createTextTexture'

interface ServiceBellProps {
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function ServiceBell({ position, rotation = [0, 0, 0] }: ServiceBellProps) {
  const bellRef = useRef<THREE.Group>(null)
  const arrowRef = useRef<THREE.Group>(null)
  const [isPressed, setIsPressed] = useState(false)
  // setIsHovered n'a pas d'appelant : le survol de la clochette n'est pas branché sur le raycaster de
  // Controls (leçon « Ciblage FPS » d'AGENTS.md), donc isHovered reste false et le glow ne s'allume jamais.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isHovered, setIsHovered] = useState(false)

  const timeRef = useRef(0)

  // OPTIMISATION: Callback pour activer le layer de raycast sur les meshes interactifs
  const enableRaycastLayer = useCallback((node: THREE.Mesh | null) => {
    if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
  }, [])

  // Créer les textures de texte
  const sonnezTexture = useMemo(() => createTextTexture('SONNEZ LE', {
    fontSize: 28,
    color: '#ff2d95',
    glowColor: '#ff2d95',
    width: 200,
    height: 50,
  }), [])

  const managerTexture = useMemo(() => createTextTexture('MANAGER', {
    fontSize: 32,
    // Light aqua reads much sharper than pure cyan (#00fff7) on the dark
    // shop interior — same hue family but the higher luminance survives the
    // softening that small 3D-text textures suffer from at viewing distance.
    color: '#A8FCEC',
    glowColor: '#4FF0E8',
    width: 200,
    height: 50,
  }), [])

  // Dispose canvas textures on unmount (memory leak fix)
  useEffect(() => {
    return () => {
      sonnezTexture.dispose()
      managerTexture.dispose()
    }
  }, [sonnezTexture, managerTexture])

  // Animation
  useFrame((_, delta) => {
    timeRef.current += delta

    // Animation de la flèche (bounce up/down)
    if (arrowRef.current) {
      arrowRef.current.position.y = 0.25 + Math.sin(timeRef.current * 3) * 0.02
    }

    // Animation de la sonnette quand hover
    if (bellRef.current && isHovered && !isPressed) {
      bellRef.current.rotation.z = Math.sin(timeRef.current * 10) * 0.05
    }
  })

  // Jamais appelé : la clochette n'est pas enregistrée auprès du raycaster de Controls, donc sonner le
  // gérant est aujourd'hui impossible depuis la scène 3D.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleClick = () => {
    if (isPressed) return

    setIsPressed(true)

    // Animation de pression
    if (bellRef.current) {
      bellRef.current.position.y = -0.02
    }

    // Réinitialiser après animation
    setTimeout(() => {
      if (bellRef.current) {
        bellRef.current.position.y = 0
      }
      setIsPressed(false)
    }, 200)

    // Appeler le manager — use getState() to avoid subscribing to store changes
    const state = useStore.getState()
    state.pushEvent('Le client a sonne la clochette du comptoir.')
    state.showManager()
  }

  return (
    <group position={position} rotation={rotation}>
      {/* Base de la sonnette */}
      <mesh position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 0.03, 16]} />
        <meshStandardMaterial color="#222222" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Sonnette (cloche) - détectable par raycast */}
      <group ref={bellRef} userData={{ isServiceBell: true }}>
        <mesh
          position={[0, 0.05, 0]}
          userData={{ isServiceBell: true }}
          ref={enableRaycastLayer}
        >
          <sphereGeometry args={[0.04, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          <meshStandardMaterial
            color={isHovered ? '#ffd700' : '#c4a000'}
            roughness={0.2}
            metalness={0.9}
            emissive={isHovered ? '#ffd700' : '#000000'}
            emissiveIntensity={isHovered ? 0.3 : 0}
          />
        </mesh>

        {/* Bouton sur le dessus */}
        <mesh position={[0, 0.085, 0]} userData={{ isServiceBell: true }} ref={enableRaycastLayer}>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 8]} />
          <meshStandardMaterial
            color="#333333"
            roughness={0.4}
            metalness={0.7}
          />
        </mesh>
      </group>

      {/* Flèche animée pointant vers le bas */}
      <group ref={arrowRef} position={[0, 0.25, 0]}>
        {/* Tige de la flèche */}
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.015, 0.08, 0.015]} />
          <meshStandardMaterial
            color="#ff2d95"
            emissive="#ff2d95"
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>

        {/* Pointe de la flèche (vers le bas) */}
        <mesh position={[0, 0.01, 0]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.03, 0.05, 4]} />
          <meshStandardMaterial
            color="#ff2d95"
            emissive="#ff2d95"
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Panneau "SONNEZ LE" avec texture Canvas */}
      <mesh position={[0, 0.42, 0]}>
        <planeGeometry args={[0.2, 0.05]} />
        <meshBasicMaterial
          map={sonnezTexture}
          transparent
          toneMapped={false}
        />
      </mesh>

      {/* Panneau "MANAGER" avec texture Canvas */}
      <mesh position={[0, 0.36, 0]}>
        <planeGeometry args={[0.2, 0.05]} />
        <meshBasicMaterial
          map={managerTexture}
          transparent
          toneMapped={false}
        />
      </mesh>

      {/* Effet de glow autour de la sonnette quand hover */}
      {isHovered && (
        <pointLight
          position={[0, 0.1, 0]}
          color="#ffd700"
          intensity={0.5}
          distance={0.5}
          decay={2}
        />
      )}
    </group>
  )
}
