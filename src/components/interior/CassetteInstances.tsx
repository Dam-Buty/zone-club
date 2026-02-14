import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  texture, uv, attribute,
  Fn, instanceIndex, deltaTime, instancedArray,
  uniform, mix, vec3, positionLocal, float,
} from 'three/tsl'
import { CassetteTextureArray, type CassetteInstanceData } from '../../utils/CassetteTextureArray'
import { useStore } from '../../store'
import { RAYCAST_LAYER_CASSETTE } from './Controls'

// Cassette dimensions (must match original Cassette.tsx)
const CASSETTE_WIDTH = 0.168
const CASSETTE_HEIGHT = 0.228
const CASSETTE_DEPTH = 0.03

const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_WIDTH, CASSETTE_HEIGHT, CASSETTE_DEPTH)

// Animation constants
const HYSTERESIS_SELECT = 0.05
const HYSTERESIS_DESELECT = 0.25

// Per-instance hysteresis state (CPU-only — not sent to GPU)
interface InstanceHysteresisState {
  stableTargeted: boolean
  targetedTimer: number
}

interface CassetteInstancesProps {
  instances: CassetteInstanceData[]
  maxTextureArrayLayers?: number
}

interface CassetteChunkProps {
  instances: CassetteInstanceData[]
  chunkIndex: number
}

function CassetteInstancesChunk({ instances, chunkIndex }: CassetteChunkProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const count = instances.length
  const gl = useThree(state => state.gl)

  // Keep instances in a ref so useMemo doesn't rebuild on every array reference change
  const instancesRef = useRef(instances)
  instancesRef.current = instances

  // Create texture array, lookup tables, and GPU storage buffers
  const {
    texArray, instanceIdToKey, instanceIdToFilmId,
    hysteresisStates,
    targetHoverZBuffer, targetEmissiveBuffer,
    currentHoverZBuffer, currentEmissiveBuffer,
    computeNode,
  } = useMemo(() => {
    const currentInstances = instancesRef.current
    const ta = new CassetteTextureArray(count)
    const idToKey: string[] = new Array(count)
    const idToFilm: number[] = new Array(count)
    const hStates: InstanceHysteresisState[] = new Array(count)

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      idToKey[i] = inst.cassetteKey
      idToFilm[i] = inst.filmId
      hStates[i] = { stableTargeted: false, targetedTimer: 0 }
    }

    // GPU storage buffers for animation (instancedArray = StorageInstancedBufferAttribute)
    const curHoverZ = instancedArray(count, 'float')    // current hover Z (GPU lerps)
    const tarHoverZ = instancedArray(count, 'float')    // target hover Z (CPU writes)
    const curEmissive = instancedArray(count, 'vec3')   // current emissive RGB (GPU lerps)
    const tarEmissive = instancedArray(count, 'vec3')   // target emissive RGB (CPU writes)

    // Uniform lerp speeds
    const speedHover = uniform(12.0)
    const speedEmissive = uniform(10.0)

    // Compute shader: lerp current toward target each frame
    const computeFn = Fn(() => {
      const idx = instanceIndex

      // Lerp hover Z
      const curH = curHoverZ.element(idx)
      const tarH = tarHoverZ.element(idx)
      const tH = deltaTime.mul(speedHover).min(float(1.0))
      curH.assign(mix(curH, tarH, tH))

      // Lerp emissive RGB
      const curE = curEmissive.element(idx)
      const tarE = tarEmissive.element(idx)
      const tE = deltaTime.mul(speedEmissive).min(float(1.0))
      curE.assign(mix(curE, tarE, tE))
    })

    const cNode = computeFn().compute(count)

    return {
      texArray: ta,
      instanceIdToKey: idToKey,
      instanceIdToFilmId: idToFilm,
      hysteresisStates: hStates,
      targetHoverZBuffer: tarHoverZ,
      targetEmissiveBuffer: tarEmissive,
      currentHoverZBuffer: curHoverZ,
      currentEmissiveBuffer: curEmissive,
      computeNode: cNode,
    }
  }, [count])

  // Each chunk gets its own geometry copy to avoid layerIndex attribute collisions.
  const geometry = useMemo(() => {
    const chunkGeometry = SHARED_CASSETTE_GEOMETRY.clone()
    const layerData = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      layerData[i] = i
    }
    const layerIndexAttr = new THREE.InstancedBufferAttribute(layerData, 1)
    chunkGeometry.setAttribute('layerIndex', layerIndexAttr)
    return chunkGeometry
  }, [count])

  // Create custom TSL material with DataArrayTexture + compute-driven animation
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial()
    mat.roughness = 0.5
    mat.metalness = 0.08

    // TSL: read per-instance layer index and sample from DataArrayTexture
    const layerIdx = attribute('layerIndex')
    const texArrayNode = texture(texArray.textureArray)
    mat.colorNode = texArrayNode.sample(uv()).depth(layerIdx)

    // Hover offset from compute shader — applied in local space
    // instanceMatrix already contains rotation, so local Z offset hovers in correct direction
    const hoverZ = currentHoverZBuffer.toAttribute()
    mat.positionNode = positionLocal.add(vec3(0, 0, hoverZ))

    // Emissive from compute shader
    mat.emissiveNode = currentEmissiveBuffer.toAttribute()

    return mat
  }, [texArray, currentHoverZBuffer, currentEmissiveBuffer])

  // Setup: initialize instance matrices, load posters, pass renderer
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const currentInstances = instancesRef.current
    const _tempMatrix = new THREE.Matrix4()
    const _tempScale = new THREE.Vector3(1, 1, 1)

    // Enable raycast layer for cassette detection
    mesh.layers.enable(RAYCAST_LAYER_CASSETTE)

    // Disable mesh-level frustum culling: instances span the entire room
    mesh.frustumCulled = false

    // Set STATIC instance matrices (never updated per frame — hover is via positionNode)
    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      _tempMatrix.compose(inst.worldPosition, inst.worldQuaternion, _tempScale)
      mesh.setMatrixAt(i, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    // Store lookup data in userData for raycasting
    mesh.userData.isCassetteInstances = true
    mesh.userData.instanceIdToKey = instanceIdToKey
    mesh.userData.instanceIdToFilmId = instanceIdToFilmId

    // Initialize target hover Z values from instance data
    const tarHoverArr = targetHoverZBuffer.value.array as Float32Array
    for (let i = 0; i < count; i++) {
      tarHoverArr[i] = 0 // Start at 0 (not hovered)
    }

    // Flush initial fallback colors to GPU
    texArray.flush()

    // Pass renderer for direct GPU uploads (copyExternalImageToTexture)
    const renderer = gl as unknown as THREE.WebGPURenderer
    texArray.setRenderer(renderer)

    // Load poster textures spread across frames (2 per frame to avoid GPU stalls)
    let cancelled = false
    const POSTERS_PER_FRAME = 2
    const queue: { index: number; url: string }[] = []
    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      if (inst.posterUrl) {
        queue.push({ index: i, url: inst.posterUrl })
      }
    }

    let queueIdx = 0
    const loadNextBatch = () => {
      if (cancelled || queueIdx >= queue.length) return
      const end = Math.min(queueIdx + POSTERS_PER_FRAME, queue.length)
      for (let j = queueIdx; j < end; j++) {
        const { index, url } = queue[j]
        texArray.loadPosterIntoLayer(url, index)
      }
      queueIdx = end
      requestAnimationFrame(loadNextBatch)
    }
    requestAnimationFrame(loadNextBatch)

    return () => {
      cancelled = true
      texArray.dispose()
      material.dispose()
      geometry.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texArray, material, geometry, count, instanceIdToKey, instanceIdToFilmId, gl])

  // Ref to store hoverOffsetZ per instance (avoids reading instancesRef in hot loop)
  const hoverOffsetsRef = useRef<Float32Array>(new Float32Array(0))
  useEffect(() => {
    const offsets = new Float32Array(count)
    const currentInstances = instancesRef.current
    for (let i = 0; i < count; i++) {
      offsets[i] = currentInstances[i].hoverOffsetZ
    }
    hoverOffsetsRef.current = offsets
  }, [count])

  // Animation loop — CPU only handles hysteresis + target writes, GPU does lerp
  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    // Flush any remaining canvas-path poster uploads (fallback only — usually none)
    texArray.flush()

    // Read store once
    const storeState = useStore.getState()
    const targetedCassetteKey = storeState.targetedCassetteKey
    const getRental = storeState.getRental

    // Get CPU-side typed arrays for target buffers
    const tarHoverArr = targetHoverZBuffer.value.array as Float32Array
    const tarEmissiveArr = targetEmissiveBuffer.value.array as Float32Array
    const hoverOffsets = hoverOffsetsRef.current

    let tarHoverDirty = false
    let tarEmissiveDirty = false

    for (let i = 0; i < count; i++) {
      const hs = hysteresisStates[i]
      const isTargetedRaw = targetedCassetteKey === instanceIdToKey[i]
      const isRented = !!getRental(instanceIdToFilmId[i])

      // Hysteresis
      if (isTargetedRaw !== hs.stableTargeted) {
        hs.targetedTimer += delta
        const delay = isTargetedRaw ? HYSTERESIS_SELECT : HYSTERESIS_DESELECT
        if (hs.targetedTimer >= delay) {
          hs.stableTargeted = isTargetedRaw
          hs.targetedTimer = 0
        }
      } else {
        hs.targetedTimer = 0
      }

      const isTargeted = hs.stableTargeted

      // Target hover Z
      const newTarHoverZ = isTargeted ? hoverOffsets[i] : 0
      if (tarHoverArr[i] !== newTarHoverZ) {
        tarHoverArr[i] = newTarHoverZ
        tarHoverDirty = true
      }

      // Target emissive: rented=green, targeted=pink, else=black
      let tR = 0; let tG = 0; let tB = 0
      if (isRented) {
        tR = 0; tG = 0.3; tB = 0 // green * 0.3 intensity
      } else if (isTargeted) {
        tR = 1.0 * 0.4; tG = 0.176 * 0.4; tB = 0.584 * 0.4 // #ff2d95 * 0.4
      }

      const idx3 = i * 3
      if (tarEmissiveArr[idx3] !== tR || tarEmissiveArr[idx3 + 1] !== tG || tarEmissiveArr[idx3 + 2] !== tB) {
        tarEmissiveArr[idx3] = tR
        tarEmissiveArr[idx3 + 1] = tG
        tarEmissiveArr[idx3 + 2] = tB
        tarEmissiveDirty = true
      }
    }

    // Upload changed targets to GPU
    if (tarHoverDirty) {
      targetHoverZBuffer.value.needsUpdate = true
    }
    if (tarEmissiveDirty) {
      targetEmissiveBuffer.value.needsUpdate = true
    }

    // Dispatch compute shader — GPU lerps current toward target
    const renderer = gl as unknown as THREE.WebGPURenderer
    renderer.compute(computeNode)
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow
      userData={{ cassetteChunkIndex: chunkIndex }}
    />
  )
}

export function CassetteInstances({ instances, maxTextureArrayLayers = 2048 }: CassetteInstancesProps) {
  const safeLayerBudget = Math.max(1, Math.floor(maxTextureArrayLayers))

  const chunks = useMemo(() => {
    if (instances.length <= safeLayerBudget) return [instances]

    const grouped: CassetteInstanceData[][] = []
    for (let i = 0; i < instances.length; i += safeLayerBudget) {
      grouped.push(instances.slice(i, i + safeLayerBudget))
    }
    return grouped
  }, [instances, safeLayerBudget])

  useEffect(() => {
    if (chunks.length > 1) {
      console.log(
        `[CassetteInstances] Layer budget ${safeLayerBudget} -> ${chunks.length} chunks for ${instances.length} cassettes`
      )
    }
  }, [chunks.length, safeLayerBudget, instances.length])

  return (
    <>
      {chunks.map((chunk, index) => (
        <CassetteInstancesChunk
          key={`cassette-chunk-${index}-${chunk[0]?.cassetteKey ?? 'empty'}`}
          instances={chunk}
          chunkIndex={index}
        />
      ))}
    </>
  )
}
