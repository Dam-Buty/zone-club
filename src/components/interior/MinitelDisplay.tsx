import { useMemo, useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store'
import { useMinitelScreenTexture } from './MinitelScreen'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

useGLTF.preload('/models/minitel_1982-france.glb', true)

interface MinitelDisplayProps {
  position: [number, number, number]
  scale?: number | [number, number, number]
  rotation?: [number, number, number]
}

// Empirical local-space placement of the screen overlay plane on top of the
// minitel CRT (relative to the GLB origin, BEFORE the parent scale is applied).
// These constants are sized in GLB units (the GLB ships at ~40 units; with
// scale=0.025 they map to real-world meters). Adjust if the plane sits in
// the wrong spot — width/height ratio kept 4:3.
const SCREEN_PLANE_OFFSET: [number, number, number] = [0, 6.5, -3.2]
const SCREEN_PLANE_TILT_X = -0.20  // ~ -11.5° (CRT tilts back)
const SCREEN_PLANE_W = 9
const SCREEN_PLANE_H = 6.75

/**
 * Renders the minitel GLB unchanged + adds a separate screen-overlay plane
 * with the canvas texture on top, positioned in local space relative to the
 * GLB. No mesh material substitution — so the GLB always renders correctly
 * and the overlay just floats in front of the CRT face.
 */
export function MinitelDisplay({ position, scale = 0.025, rotation = [0, Math.PI, 0] }: MinitelDisplayProps) {
  const { scene } = useGLTF('/models/minitel_1982-france.glb', true)
  const { texture: screenTexture } = useMinitelScreenTexture()

  // Clone GLB + tag meshes for interactive raycast (no material change).
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = true
        child.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        child.userData.isMinitel = true
      }
    })
    return cloned
  }, [scene])

  // Material for the overlay plane.
  const overlayMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      map: screenTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  }, [screenTexture])

  useEffect(() => {
    return () => overlayMaterial.dispose()
  }, [overlayMaterial])

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={clonedScene} />
      {/* Screen overlay plane in GLB-local units (scale applied by the group). */}
      {/* Rotated π on Y to compensate for the parent group's Y=π rotation
          so the text reads correctly on the visible face. */}
      <mesh
        position={SCREEN_PLANE_OFFSET}
        rotation={[SCREEN_PLANE_TILT_X, Math.PI, 0]}
        material={overlayMaterial}
        userData={{ isMinitel: true }}
      >
        <planeGeometry args={[SCREEN_PLANE_W, SCREEN_PLANE_H]} />
      </mesh>
    </group>
  )
}
