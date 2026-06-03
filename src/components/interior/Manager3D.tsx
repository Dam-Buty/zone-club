import { useRef, useMemo, useCallback, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { positionWorld, normalWorld, clamp, vec3, varying, texture } from 'three/tsl'
import { useStore } from '../../store'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useProbeVolumes } from './ProbeVolumeContext'
import { shIrradiance } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'
import { PROBE_PI, MANAGER_GI } from './bakeDebugStore'

// Preload the Rick model (Draco compressed)
useGLTF.preload('/models/rick.glb', true)

// Nodes to remove from the original Sketchfab export
const REMOVE_NODES = new Set(['GROUND', 'myOctaneSettings', 'OctaneDayLight', 'Object_6'])

// Scale tuned so Rick stands ~1.75m tall behind the counter
const MODEL_SCALE = 0.35

interface Manager3DProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onInteract?: () => void
}

let sceneCleanedUp = false

export function Manager3D({ position, rotation = [0, 0, 0], onInteract }: Manager3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const timeRef = useRef(0)

  const { scene: glbScene, animations } = useGLTF('/models/rick.glb', true)
  const probes = useProbeVolumes() // Phase-3 SH-L1 volumes (?baked=1, post-bake)

  // Phase-3 baked GI: light Rick with the SH-L1 probe volume when it arrives — emissiveNode on each
  // material, sampled at the (skinned) world position and modulated by the material's own colour so
  // his palette survives. Baked mode drops the analytical rig, so otherwise he reads as a flat black
  // silhouette (the very thing flagged). positionWorld accounts for skinning in the node pipeline.
  useEffect(() => {
    if (!probes) return
    const e = gridExt()
    const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
    const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
    const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
    const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
    const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
    ;(window as unknown as { __RICK?: unknown }).__RICK = MANAGER_GI // live dial Rick GI (no re-bake)
    const apply = (m: THREE.Material) => {
      const sm = m as THREE.MeshStandardMaterial
      // GI by the REAL albedo = map × colour (colour≈white on the GLB, so ×tint is a no-op there but
      // stays correct for any tinted sub-material). MANAGER_GI dims Rick ALONE — his white lab coat
      // otherwise blows to pure white under the SH irradiance + the cold moon rim through the vitrine.
      const tint = vec3(sm.color.r, sm.color.g, sm.color.b)
      const albedo = sm.map ? texture(sm.map).mul(tint) : tint
      const nm = m as unknown as { emissiveNode?: unknown; needsUpdate: boolean }
      nm.emissiveNode = albedo.mul(E).mul(PROBE_PI).mul(MANAGER_GI)
      nm.needsUpdate = true
    }
    glbScene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      if (Array.isArray(mesh.material)) mesh.material.forEach(apply)
      else apply(mesh.material)
    })
  }, [probes, glbScene])

  // Remove Sketchfab artifacts (once)
  useMemo(() => {
    if (sceneCleanedUp) return
    sceneCleanedUp = true
    const toRemove: THREE.Object3D[] = []
    glbScene.traverse((child) => {
      if (REMOVE_NODES.has(child.name)) toRemove.push(child)
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
        const mat = child.material as THREE.MeshStandardMaterial
        if (mat) {
          mat.roughness = Math.max(mat.roughness, 0.7)
          mat.metalness = Math.min(mat.metalness, 0.1)
        }
      }
    })
    toRemove.forEach(n => n.removeFromParent())
  }, [glbScene])

  // Set up animation mixer — freeze at a specific frame for a good idle pose
  useEffect(() => {
    if (animations.length === 0) return

    const mixer = new THREE.AnimationMixer(glbScene)
    const clip = animations[0]
    const action = mixer.clipAction(clip)
    action.play()
    action.paused = true
    // Freeze at t=2s — arms should be in a natural mid-laugh position
    action.time = 2.0
    // Force one update to apply the pose
    mixer.update(0)

    mixerRef.current = mixer

    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(glbScene)
      mixerRef.current = null
    }
  }, [glbScene, animations])

  // Subtle idle animation on the whole group
  useFrame((_, delta) => {
    timeRef.current += delta
    if (!groupRef.current) return

    const breathe = Math.sin(timeRef.current * 1.2) * 0.003
    groupRef.current.position.y = position[1] + breathe
  })

  const handleClick = useCallback(() => {
    if (onInteract) {
      onInteract()
    } else {
      const state = useStore.getState()
      state.pushEvent('Le client s\'approche du manager et lui parle.')
      state.showManager()
    }
  }, [onInteract])

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={MODEL_SCALE}>
      <primitive object={glbScene} />
      <mesh
        position={[0, 2.8, 0]}
        userData={{ isManager: true }}
        ref={useCallback((node: THREE.Mesh | null) => {
          if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        }, [])}
      >
        <boxGeometry args={[1.5, 5, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
