import { useMemo, useEffect, useState } from 'react'
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

/**
 * 3D minitel model with click-to-activate raycast layer + CanvasTexture
 * attached to the screen mesh. Click on the minitel → opens the search UI
 * (camera zoom + overlay) handled by Controls + MinitelOverlay.
 */
export function MinitelDisplay({ position, scale = 0.025, rotation = [0, Math.PI, 0] }: MinitelDisplayProps) {
  const { scene } = useGLTF('/models/minitel_1982-france.glb', true)
  const setInteractingWithMinitel = useStore((s) => s.setInteractingWithMinitel)
  const setMinitelMode = useStore((s) => s.setMinitelMode)
  const isInteractingWithMinitel = useStore((s) => s.isInteractingWithMinitel)
  const [screenMesh, setScreenMesh] = useState<THREE.Mesh | null>(null)

  const { texture: screenTexture } = useMinitelScreenTexture()

  // Clone the scene + tag all meshes for interactive raycast (pure, no setState).
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

  // Identify the screen mesh in a useEffect (NEVER setState inside useMemo).
  useEffect(() => {
    let pickedByName: THREE.Mesh | null = null
    let largestMesh: THREE.Mesh | null = null
    let largestArea = 0
    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const name = (child.name || '').toLowerCase()
      if (!pickedByName && (name.includes('screen') || name.includes('ecran') || name.includes('tube') || name.includes('display'))) {
        pickedByName = child
      }
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      const bb = child.geometry.boundingBox
      if (bb) {
        const size = new THREE.Vector3()
        bb.getSize(size)
        const area = size.x * size.y
        if (area > largestArea) {
          largestArea = area
          largestMesh = child
        }
      }
    })
    setScreenMesh(pickedByName ?? largestMesh)
  }, [clonedScene])

  // Apply the canvas texture to the identified screen mesh
  useEffect(() => {
    if (!screenMesh || !screenTexture) return
    const mat = new THREE.MeshStandardMaterial({
      map: screenTexture,
      emissive: '#003344',
      emissiveMap: screenTexture,
      emissiveIntensity: 1.2,
      roughness: 0.6,
      metalness: 0.0,
      toneMapped: false,
    })
    const prevMaterial = screenMesh.material
    screenMesh.material = mat
    return () => {
      mat.dispose()
      screenMesh.material = prevMaterial
    }
  }, [screenMesh, screenTexture])

  const handleClick = (e: { stopPropagation?: () => void }) => {
    if (isInteractingWithMinitel) return
    e.stopPropagation?.()
    setInteractingWithMinitel(true)
    setMinitelMode('sommaire')
  }

  return (
    <primitive
      object={clonedScene}
      position={position}
      scale={scale}
      rotation={rotation}
      onClick={handleClick}
    />
  )
}
