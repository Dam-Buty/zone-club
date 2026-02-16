import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Room bounds (match Aisle.tsx)
const ROOM_W = 9
const ROOM_H = 2.8
const ROOM_D = 8.5
const HALF_W = ROOM_W / 2
const HALF_D = ROOM_D / 2

interface DustParticlesProps {
  count?: number
}

export function DustParticles({ count = 250 }: DustParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)

  const { geometry, positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Random position within the room volume
      pos[i3 + 0] = (Math.random() - 0.5) * ROOM_W
      pos[i3 + 1] = Math.random() * ROOM_H
      pos[i3 + 2] = (Math.random() - 0.5) * ROOM_D
      // Very slow initial velocities — brownian drift
      vel[i3 + 0] = (Math.random() - 0.5) * 0.002
      vel[i3 + 1] = Math.random() * 0.001 + 0.0002 // slight upward bias (warm air convection)
      vel[i3 + 2] = (Math.random() - 0.5) * 0.002
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geometry: geom, positions: pos, velocities: vel }
  }, [count])

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.01,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      color: '#fffaf0',
      blending: THREE.AdditiveBlending,
    })
  }, [])

  const frameRef = useRef(0)

  useFrame(() => {
    // Throttle to every 4 frames — dust moves slowly, imperceptible at 15Hz update
    frameRef.current++
    if (frameRef.current % 4 !== 0) return

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Brownian perturbation
      velocities[i3 + 0] += (Math.random() - 0.5) * 0.00004
      velocities[i3 + 1] += (Math.random() - 0.5) * 0.00002 + 0.000008 // upward drift
      velocities[i3 + 2] += (Math.random() - 0.5) * 0.00004
      // Air drag
      velocities[i3 + 0] *= 0.998
      velocities[i3 + 1] *= 0.998
      velocities[i3 + 2] *= 0.998
      // Update position
      positions[i3 + 0] += velocities[i3 + 0]
      positions[i3 + 1] += velocities[i3 + 1]
      positions[i3 + 2] += velocities[i3 + 2]
      // Wrap at room boundaries (seamless re-entry from opposite side)
      if (positions[i3 + 0] < -HALF_W) positions[i3 + 0] = HALF_W
      if (positions[i3 + 0] > HALF_W) positions[i3 + 0] = -HALF_W
      if (positions[i3 + 1] > ROOM_H) positions[i3 + 1] = 0.05
      if (positions[i3 + 1] < 0) positions[i3 + 1] = ROOM_H - 0.05
      if (positions[i3 + 2] < -HALF_D) positions[i3 + 2] = HALF_D
      if (positions[i3 + 2] > HALF_D) positions[i3 + 2] = -HALF_D
    }
    // Flag position attribute for GPU re-upload
    const attr = geometry.getAttribute('position')
    ;(attr as THREE.BufferAttribute).needsUpdate = true
  })

  return <points ref={pointsRef} geometry={geometry} material={material} />
}
