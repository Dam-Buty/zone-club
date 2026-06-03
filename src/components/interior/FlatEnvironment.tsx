import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// 100%-baked ambient fill: a FLAT cold-night environment (uniform colour) that REPLACES the structured
// `indoor_night.hdr`. The HDR's uneven content projected bluish marbled blotches onto the ceiling/walls
// as the `env` IBL was raised (it's image-based, so its texture shows through). A constant-colour
// environment gives clean, uniform diffuse + specular fill with NO marbling — so `env` can be raised
// freely. Intensity is driven live by the dev panel's `env` knob (scene.environmentIntensity).
//
// THREE.Color stores LINEAR rgb (ColorManagement on), so we feed those straight into a 1×1 float
// equirect texture (linear colour-space, no conversion) used as scene.environment.
const NIGHT_AMBIENT = new THREE.Color('#46577a') // cold steel-blue night

export function FlatEnvironment({ intensity }: { intensity: number }) {
  const scene = useThree((s) => s.scene)

  const tex = useMemo(() => {
    const data = new Float32Array([NIGHT_AMBIENT.r, NIGHT_AMBIENT.g, NIGHT_AMBIENT.b, 1])
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.FloatType)
    t.mapping = THREE.EquirectangularReflectionMapping
    t.colorSpace = THREE.LinearSRGBColorSpace
    t.needsUpdate = true
    return t
  }, [])

  useEffect(() => {
    const prev = scene.environment
    scene.environment = tex
    return () => {
      if (scene.environment === tex) scene.environment = prev
      tex.dispose()
    }
  }, [scene, tex])

  useEffect(() => {
    scene.environmentIntensity = intensity
  }, [scene, intensity])

  return null
}
