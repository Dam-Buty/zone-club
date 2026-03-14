import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

useGLTF.preload('/models/leather_couch.glb', true)

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene: glbScene } = useGLTF('/models/leather_couch.glb', true)

  // Clone scene + materials (per memory: GLB clone shares materials by reference)
  const clonedScene = useRef<THREE.Group | null>(null)
  if (!clonedScene.current) {
    clonedScene.current = glbScene.clone(true)
    clonedScene.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        // Clone material to avoid shared state
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone())
        } else {
          mesh.material = mesh.material.clone()
        }
        mesh.castShadow = true
        mesh.receiveShadow = true
        // Enable raycast layer + userData for FPS center-screen targeting
        mesh.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        mesh.userData.isCouch = true
      }
    })
  }

  const handleClick = useCallback(() => {
    if (onSit) onSit()
  }, [onSit])

  // Cleanup cloned materials on unmount
  useEffect(() => {
    return () => {
      clonedScene.current?.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      })
    }
  }, [])

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* leather_couch.glb: scale 0.98 (+15% from 0.85) → ~1.98m wide, 0.81m high, 0.91m deep */}
      <primitive
        object={clonedScene.current!}
        scale={0.98}
        position={[0, 0, 0]}
        onClick={handleClick}
      />
      {/* Invisible click zone (scaled +15%) */}
      <mesh position={[0, 0.40, 0]} onClick={handleClick} visible={false}>
        <boxGeometry args={[1.7, 0.7, 0.8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
