import { useRef, useEffect, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useStore } from '../../store'

useGLTF.preload('/models/leather_couch.glb', true)

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene: glbScene } = useGLTF('/models/leather_couch.glb', true)

  // Clone scene + materials (per memory: GLB clone shares materials by reference).
  // useMemo plutôt qu'une ref écrite pendant le rendu : le rendu redevient pur, et le clone
  // se refait si le GLB change — ce que le `if (!ref.current)` empêchait définitivement.
  const clonedScene = useMemo(() => {
    const clone = glbScene.clone(true)
    clone.traverse((child) => {
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
    return clone
  }, [glbScene])

  const handleClick = useCallback((e?: { stopPropagation?: () => void }) => {
    // R3F propagates clicks through all intersected objects. A click on the
    // minitel screen (closer to the camera than the couch on most ray paths)
    // would otherwise also fire here and seat the player — guard against any
    // active modal interaction so the couch only reacts when the user is
    // really aiming at it.
    const s = useStore.getState()
    if (s.isInteractingWithMinitel || s.isInteractingWithTV || s.isInteractingWithLaZone) {
      return
    }
    e?.stopPropagation?.()
    if (onSit) onSit()
  }, [onSit])

  // Cleanup cloned materials on unmount
  useEffect(() => {
    return () => {
      clonedScene.traverse((child) => {
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
    // Le cleanup libère les matériaux du clone courant : il doit donc suivre le clone.
  }, [clonedScene])

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* leather_couch.glb: scale 0.98 (+15% from 0.85) → ~1.98m wide, 0.81m high, 0.91m deep */}
      <primitive
        object={clonedScene}
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
