import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

useGLTF.preload('/models/couch.glb', true)

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene: glbScene } = useGLTF('/models/couch.glb', true)

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
      {/* GLB model: bounds X[-1,1] Y[-0.45,0.45] Z[-0.40,0.40] */}
      {/* Scale 0.858 (+30% from 0.66) → ~1.72m wide, 0.77m high, 0.69m deep */}
      {/* Y offset 0.45*0.858=0.386 to sit on floor */}
      <primitive
        object={clonedScene.current!}
        scale={0.858}
        position={[0, 0.386, 0]}
        onClick={handleClick}
      />
      {/* Invisible click zone (slightly larger for easier targeting) */}
      <mesh position={[0, 0.30, 0]} onClick={handleClick} visible={false}>
        <boxGeometry args={[1.2, 0.5, 0.6]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
