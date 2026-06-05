import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { positionWorld, normalWorld, clamp, vec3, varying, texture } from 'three/tsl'
import { useGLTF } from '@react-three/drei'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'
import { useStore } from '../../store'
import { useProbeVolumes } from './ProbeVolumeContext'
import { shIrradiance, shSpecular } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'
import { PROBE_PI, OBJ_SPEC, OBJ_GI } from './bakeDebugStore'

useGLTF.preload('/models/leather_couch.glb', true)

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { scene: glbScene } = useGLTF('/models/leather_couch.glb', true)
  const probes = useProbeVolumes() // Phase-3 SH-L1 volumes (present only in ?baked=1 after the bake)

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

  // Phase-3 baked GI: when the probe volume arrives (?baked=1, post-bake), light the couch with the
  // baked SH-L1 GI via an emissiveNode on each cloned material (the analytical rig is dropped in baked
  // mode, so leather would read near-black otherwise — same emissive-add rationale as the K7/shelves).
  useEffect(() => {
    if (!probes || !clonedScene.current) return
    const e = gridExt()
    const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
    const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
    const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
    const uvw = clamp(positionWorld.sub(gMin).mul(gInv), half, vec3(1).sub(half))
    const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
    // Baked "lit by light" specular: the glossy leather CATCHES the dominant neon as a highlight
    // (shSpecular reads the light direction from the SH) → reads as lit, not self-glowing. Per-fragment.
    const spec = shSpecular(probes.shR, probes.shG, probes.shB, uvw, normalWorld, 16)
    ;(window as unknown as { __OSPEC?: unknown }).__OSPEC = OBJ_SPEC
    const apply = (m: THREE.Material) => {
      const sm = m as THREE.MeshStandardMaterial
      // Modulate by the material's REAL albedo (leather texture map) so the couch keeps its grain,
      // not a flat clay blob. Map if present, else colour.
      const tint = vec3(sm.color.r, sm.color.g, sm.color.b)
      const albedo = sm.map ? texture(sm.map).mul(tint) : tint
      const nm = m as unknown as { emissiveNode?: unknown; needsUpdate: boolean }
      nm.emissiveNode = albedo.mul(E).mul(PROBE_PI).mul(OBJ_GI).mul(0.8).add(spec.mul(OBJ_SPEC)) // couch reads slightly hotter than the other meubles → −20% on its diffuse
      nm.needsUpdate = true
    }
    clonedScene.current.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      if (Array.isArray(mesh.material)) mesh.material.forEach(apply)
      else apply(mesh.material)
    })
  }, [probes])

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
