import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../store'
import { getCassetteWorldPosition } from '../../utils/cassetteRegistry'

/**
 * 3D halo on the cassette identified by `highlightedCassetteKey` in the store.
 * Pulsing blue sphere (additive blending) so it's visible from a distance even
 * through other shelves. Lookup the world position via cassetteRegistry.
 */
export function CassetteHighlight() {
  const highlightedCassetteKey = useStore((s) => s.highlightedCassetteKey)
  const meshRef = useRef<THREE.Mesh>(null)
  const [worldPos, setWorldPos] = useState<THREE.Vector3 | null>(null)

  // Resolve world position when the key changes. Re-attempt once after a tick
  // in case CassetteInstances finished registering after this component mounted.
  useEffect(() => {
    if (!highlightedCassetteKey) {
      setWorldPos(null)
      return
    }
    const p = getCassetteWorldPosition(highlightedCassetteKey)
    if (p) {
      setWorldPos(p)
      return
    }
    const t = setTimeout(() => {
      const p2 = getCassetteWorldPosition(highlightedCassetteKey)
      if (p2) setWorldPos(p2)
    }, 200)
    return () => clearTimeout(t)
  }, [highlightedCassetteKey])

  const material = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: '#00aaff',
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  }, [])

  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime
    const s = 1 + 0.18 * Math.sin(t * 3)
    meshRef.current.scale.setScalar(s)
  })

  if (!worldPos) return null

  return (
    <mesh ref={meshRef} position={worldPos} material={material} renderOrder={5}>
      <sphereGeometry args={[0.13, 24, 16]} />
    </mesh>
  )
}
