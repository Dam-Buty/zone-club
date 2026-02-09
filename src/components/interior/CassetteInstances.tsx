import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { texture, attribute, uv } from 'three/tsl'
import { CassetteTextureArray, type CassetteInstanceData } from '../../utils/CassetteTextureArray'
import { useStore } from '../../store'
import { RAYCAST_LAYER_CASSETTE } from './Controls'

// Cassette dimensions (must match original Cassette.tsx)
const CASSETTE_WIDTH = 0.168
const CASSETTE_HEIGHT = 0.228
const CASSETTE_DEPTH = 0.03

const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_WIDTH, CASSETTE_HEIGHT, CASSETTE_DEPTH)

// Fallback colors for cassettes without posters
const CASSETTE_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2c3e50', '#34495e', '#1e3d59', '#3d5a80'
]

// Animation constants
const HYSTERESIS_SELECT = 0.05
const HYSTERESIS_DESELECT = 0.25
const ANIMATION_THROTTLE = 2
const EMISSIVE_NONE = new THREE.Color('#000000')
const EMISSIVE_TARGETED = new THREE.Color('#ff2d95')
const EMISSIVE_RENTED = new THREE.Color('#00ff00')

// Reusable objects
const _frustum = new THREE.Frustum()
const _projMatrix = new THREE.Matrix4()
const _tempWorldPos = new THREE.Vector3()
const _tempMatrix = new THREE.Matrix4()
const _tempPosition = new THREE.Vector3()
const _tempQuaternion = new THREE.Quaternion()
const _tempScale = new THREE.Vector3(1, 1, 1)

// Per-instance animation state
interface InstanceAnimState {
  stableTargeted: boolean
  targetedTimer: number
  smoothTargeted: number
  currentEmissive: THREE.Color
  basePosition: THREE.Vector3
  baseQuaternion: THREE.Quaternion
  hoverOffsetZ: number
  currentHoverZ: number
}

interface CassetteInstancesProps {
  instances: CassetteInstanceData[]
}

export function CassetteInstances({ instances }: CassetteInstancesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const count = instances.length

  // Keep instances in a ref so useMemo doesn't rebuild on every array reference change
  const instancesRef = useRef(instances)
  instancesRef.current = instances

  if (count === 0) return null

  // Create texture array and per-instance data
  // Only depends on count — rebuilds only when the number of cassettes actually changes
  const { texArray, instanceIdToKey, instanceIdToFilmId, animStates } = useMemo(() => {
    const currentInstances = instancesRef.current
    const ta = new CassetteTextureArray(count)
    const idToKey: string[] = new Array(count)
    const idToFilm: number[] = new Array(count)
    const states: InstanceAnimState[] = new Array(count)

    // Fallback colors are handled by the fast bulk fill in CassetteTextureArray constructor
    // (~1ms Uint32Array.fill vs ~300-500ms for 520 individual fillLayerWithColor calls)
    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      idToKey[i] = inst.cassetteKey
      idToFilm[i] = inst.filmId

      // Initialize animation state
      states[i] = {
        stableTargeted: false,
        targetedTimer: 0,
        smoothTargeted: 0,
        currentEmissive: new THREE.Color('#000000'),
        basePosition: inst.worldPosition.clone(),
        baseQuaternion: inst.worldQuaternion.clone(),
        hoverOffsetZ: inst.hoverOffsetZ,
        currentHoverZ: 0,
      }
    }

    return {
      texArray: ta,
      instanceIdToKey: idToKey,
      instanceIdToFilmId: idToFilm,
      animStates: states,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  // Per-instance attributes: layerIndex (float) and emissive (vec4)
  // CRITICAL: Attach to shared geometry synchronously here (not in useEffect)
  // so they exist before the first render — avoids WebGPU "attribute not found" warnings
  // and buffer size mismatches when the TSL material samples these attributes.
  const { layerIndexAttr, emissiveAttr } = useMemo(() => {
    const layerData = new Float32Array(count)
    const emissiveData = new Float32Array(count * 4) // RGBA

    for (let i = 0; i < count; i++) {
      layerData[i] = i // Each instance maps to its own layer
      emissiveData[i * 4] = 0
      emissiveData[i * 4 + 1] = 0
      emissiveData[i * 4 + 2] = 0
      emissiveData[i * 4 + 3] = 0
    }

    const liAttr = new THREE.InstancedBufferAttribute(layerData, 1)
    const emAttr = new THREE.InstancedBufferAttribute(emissiveData, 4)

    // Attach to geometry now so they're available for the first render frame
    SHARED_CASSETTE_GEOMETRY.setAttribute('layerIndex', liAttr)
    SHARED_CASSETTE_GEOMETRY.setAttribute('instanceEmissive', emAttr)

    return { layerIndexAttr: liAttr, emissiveAttr: emAttr }
  }, [count])

  // Create custom TSL material with DataArrayTexture sampling
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial()
    mat.roughness = 0.5
    mat.metalness = 0.08

    // TSL: read per-instance layer index and sample from DataArrayTexture
    const layerIdx = attribute('layerIndex')
    const instanceEmissive = attribute('instanceEmissive')

    // Correct Three.js TSL API for DataArrayTexture:
    // .sample(uv) for 2D UV coordinates, .depth(layerIdx) for array layer selection
    // This uses TextureNode.depth() which sets the depthNode for array texture sampling
    const texArrayNode = texture(texArray.textureArray)
    mat.colorNode = texArrayNode.sample(uv()).depth(layerIdx)
    mat.emissiveNode = instanceEmissive.xyz

    return mat
  }, [texArray])

  // Setup: initialize instance matrices, attach attributes, load posters
  // Depends on texArray/material (which only change when count changes), not on instances ref
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const currentInstances = instancesRef.current

    // Enable raycast layer for cassette detection
    mesh.layers.enable(RAYCAST_LAYER_CASSETTE)

    // Per-instance attributes are already attached to SHARED_CASSETTE_GEOMETRY
    // in useMemo (synchronously, before first render) to avoid WebGPU warnings.

    // Disable mesh-level frustum culling: instances span the entire room (11×8.5m)
    // but the base geometry bounding sphere is tiny (~0.14m). Three.js would incorrectly
    // cull the whole InstancedMesh when the camera doesn't see the origin.
    // Per-instance culling is already handled in the animation loop.
    mesh.frustumCulled = false

    // Set initial matrices
    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      _tempMatrix.compose(inst.worldPosition, inst.worldQuaternion, _tempScale)
      mesh.setMatrixAt(i, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // Recompute bounding sphere from actual instance matrices.
    // Critical for raycasting: InstancedMesh.raycast() checks the bounding sphere first.
    // If it was computed before matrices were set (e.g., during first render with frustumCulled=true),
    // the stale zero-radius sphere at origin causes all raycasts to miss.
    mesh.computeBoundingSphere()

    // Store lookup data in userData for raycasting
    mesh.userData.isCassetteInstances = true
    mesh.userData.instanceIdToKey = instanceIdToKey
    mesh.userData.instanceIdToFilmId = instanceIdToFilmId

    // Flush all fallback colors to GPU in one batch (set during useMemo)
    texArray.flush()

    // Load poster textures in parallel batches
    // Images are already preloaded in the shared cache (App.tsx module-level prefetch),
    // so each loadPosterIntoLayer resolves instantly — only CPU canvas work remains.
    // GPU uploads are batched via texArray.flush() in the animation loop (once per frame).
    let cancelled = false
    const BATCH_SIZE = 50
    const loadPosters = async () => {
      const queue: { index: number; url: string }[] = []
      for (let i = 0; i < count; i++) {
        const inst = currentInstances[i]
        if (inst.posterUrl) {
          queue.push({ index: i, url: inst.posterUrl })
        }
      }

      for (let j = 0; j < queue.length; j += BATCH_SIZE) {
        if (cancelled) return
        const batch = queue.slice(j, j + BATCH_SIZE)
        await Promise.all(
          batch.map(({ index, url }) => texArray.loadPosterIntoLayer(url, index))
        )
      }
    }
    loadPosters()

    return () => {
      cancelled = true
      texArray.dispose()
      material.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texArray, material, count, instanceIdToKey, instanceIdToFilmId, layerIndexAttr, emissiveAttr])

  // Animation loop
  const frameCountRef2 = useRef(0)
  const lastFrustumFrameRef = useRef(-1)

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    // Flush pending poster texture uploads (batched: at most 1 GPU upload per frame)
    texArray.flush()

    frameCountRef2.current++
    if (frameCountRef2.current % ANIMATION_THROTTLE !== 0) return

    // Frustum culling setup (once per relevant frame)
    const currentFrame = frameCountRef2.current
    if (lastFrustumFrameRef.current !== currentFrame) {
      _projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_projMatrix)
      lastFrustumFrameRef.current = currentFrame
    }

    // Read store once
    const state = useStore.getState()
    const targetedCassetteKey = state.targetedCassetteKey
    const getRental = state.getRental

    let matrixNeedsUpdate = false
    let emissiveNeedsUpdate = false
    const emissiveData = emissiveAttr.array as Float32Array

    for (let i = 0; i < count; i++) {
      const anim = animStates[i]

      // Frustum culling per instance
      _tempWorldPos.copy(anim.basePosition)
      _tempWorldPos.y += CASSETTE_HEIGHT / 2  // Center of cassette
      if (!_frustum.containsPoint(_tempWorldPos)) continue

      // Hysteresis
      const isTargetedRaw = targetedCassetteKey === instanceIdToKey[i]
      const isRented = !!getRental(instanceIdToFilmId[i])

      if (isTargetedRaw !== anim.stableTargeted) {
        anim.targetedTimer += delta
        const delay = isTargetedRaw ? HYSTERESIS_SELECT : HYSTERESIS_DESELECT
        if (anim.targetedTimer >= delay) {
          anim.stableTargeted = isTargetedRaw
          anim.targetedTimer = 0
        }
      } else {
        anim.targetedTimer = 0
      }

      const isTargeted = anim.stableTargeted

      // Smooth hover Z
      const targetHoverZ = isTargeted ? anim.hoverOffsetZ : 0
      const prevHoverZ = anim.currentHoverZ
      anim.currentHoverZ = THREE.MathUtils.lerp(anim.currentHoverZ, targetHoverZ, delta * 12)

      // Only update matrix if hover Z changed significantly
      if (Math.abs(anim.currentHoverZ - prevHoverZ) > 0.0001) {
        _tempPosition.copy(anim.basePosition)
        // Apply hover in the local Z direction of the cassette
        _tempWorldPos.set(0, 0, anim.currentHoverZ)
        _tempWorldPos.applyQuaternion(anim.baseQuaternion)
        _tempPosition.add(_tempWorldPos)

        _tempMatrix.compose(_tempPosition, anim.baseQuaternion, _tempScale)
        mesh.setMatrixAt(i, _tempMatrix)
        matrixNeedsUpdate = true
      }

      // Smooth targeted value
      const targetValue = isTargeted ? 1 : 0
      anim.smoothTargeted = THREE.MathUtils.lerp(anim.smoothTargeted, targetValue, delta * 8)

      // Emissive color
      const targetColor = isRented ? EMISSIVE_RENTED : (anim.smoothTargeted > 0.1 ? EMISSIVE_TARGETED : EMISSIVE_NONE)
      anim.currentEmissive.lerp(targetColor, delta * 10)

      const targetIntensity = isRented ? 0.3 : anim.smoothTargeted * 0.4

      // Write emissive to buffer (pre-multiplied by intensity)
      const idx = i * 4
      const newR = anim.currentEmissive.r * targetIntensity
      const newG = anim.currentEmissive.g * targetIntensity
      const newB = anim.currentEmissive.b * targetIntensity
      if (emissiveData[idx] !== newR || emissiveData[idx + 1] !== newG || emissiveData[idx + 2] !== newB) {
        emissiveData[idx] = newR
        emissiveData[idx + 1] = newG
        emissiveData[idx + 2] = newB
        emissiveData[idx + 3] = targetIntensity
        emissiveNeedsUpdate = true
      }
    }

    if (matrixNeedsUpdate) {
      mesh.instanceMatrix.needsUpdate = true
    }
    if (emissiveNeedsUpdate) {
      emissiveAttr.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[SHARED_CASSETTE_GEOMETRY, material, count]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow
    />
  )
}
