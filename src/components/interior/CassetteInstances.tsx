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

// Pre-rendered "LOUE!" overlay — created once, shared across all chunks
const LOUE_OVERLAY_TEXTURE = (() => {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 300
  const ctx = canvas.getContext('2d')!

  // Semi-transparent dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(0, 0, 200, 300)

  // "LOUE!" text
  ctx.font = 'bold 36px "Arial Black", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ff3333'
  ctx.shadowColor = '#ff0000'
  ctx.shadowBlur = 8
  ctx.fillText('LOUÉ !', 100, 140)

  // Smaller "retour bientot" label
  ctx.font = '14px Arial, sans-serif'
  ctx.fillStyle = '#ffcc00'
  ctx.shadowBlur = 0
  ctx.fillText('retour bientôt', 100, 175)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

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
  // Poster layers are DEDUPLICATED: ~50 unique posters share layers instead of 520 copies.
  const {
    texArray, instanceIdToKey, instanceIdToFilmId,
    instanceLayerMap, urlToLayer,
    hysteresisStates,
    targetHoverZBuffer, targetEmissiveBuffer,
    currentHoverZBuffer, currentEmissiveBuffer,
    targetRentedOutBuffer, currentRentedOutBuffer,
    computeNode,
  } = useMemo(() => {
    const currentInstances = instancesRef.current
    const idToKey: string[] = new Array(count)
    const idToFilm: number[] = new Array(count)
    const hStates: InstanceHysteresisState[] = new Array(count)

    // Deduplicate poster URLs → shared texture layers
    // Layer 0 = fallback (no poster), then 1 layer per unique posterUrl
    const _urlToLayer = new Map<string, number>()
    const _instanceLayerMap = new Float32Array(count)
    const FALLBACK_LAYER = 0
    let nextLayer = 1

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      idToKey[i] = inst.cassetteKey
      idToFilm[i] = inst.filmId
      hStates[i] = { stableTargeted: false, targetedTimer: 0 }

      if (!inst.posterUrl) {
        _instanceLayerMap[i] = FALLBACK_LAYER
      } else {
        let layer = _urlToLayer.get(inst.posterUrl)
        if (layer === undefined) {
          layer = nextLayer++
          _urlToLayer.set(inst.posterUrl, layer)
        }
        _instanceLayerMap[i] = layer
      }
    }

    const uniqueLayerCount = nextLayer
    const ta = new CassetteTextureArray(uniqueLayerCount)

    // GPU storage buffers for animation (instancedArray = StorageInstancedBufferAttribute)
    const curHoverZ = instancedArray(count, 'float')    // current hover Z (GPU lerps)
    const tarHoverZ = instancedArray(count, 'float')    // target hover Z (CPU writes)
    const curEmissive = instancedArray(count, 'vec3')   // current emissive RGB (GPU lerps)
    const tarEmissive = instancedArray(count, 'vec3')   // target emissive RGB (CPU writes)
    const curRentedOut = instancedArray(count, 'float') // current rented-out state 0-1 (GPU lerps)
    const tarRentedOut = instancedArray(count, 'float') // target rented-out state (CPU writes)

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

      // Lerp rented-out overlay (smooth transition)
      const curR = curRentedOut.element(idx)
      const tarR = tarRentedOut.element(idx)
      curR.assign(mix(curR, tarR, tE))
    })

    const cNode = computeFn().compute(count)

    return {
      texArray: ta,
      instanceIdToKey: idToKey,
      instanceIdToFilmId: idToFilm,
      instanceLayerMap: _instanceLayerMap,
      urlToLayer: _urlToLayer,
      hysteresisStates: hStates,
      targetHoverZBuffer: tarHoverZ,
      targetEmissiveBuffer: tarEmissive,
      currentHoverZBuffer: curHoverZ,
      currentEmissiveBuffer: curEmissive,
      targetRentedOutBuffer: tarRentedOut,
      currentRentedOutBuffer: curRentedOut,
      computeNode: cNode,
    }
  }, [count])

  // Each chunk gets its own geometry copy to avoid layerIndex attribute collisions.
  // layerIndex maps each instance to its DEDUPLICATED texture layer (many instances → same layer).
  const geometry = useMemo(() => {
    const chunkGeometry = SHARED_CASSETTE_GEOMETRY.clone()
    const layerIndexAttr = new THREE.InstancedBufferAttribute(instanceLayerMap, 1)
    chunkGeometry.setAttribute('layerIndex', layerIndexAttr)
    return chunkGeometry
  }, [instanceLayerMap])

  // Create custom TSL material with DataArrayTexture + compute-driven animation
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial()
    mat.roughness = 0.15
    mat.metalness = 0.15

    // TSL: read per-instance layer index and sample from DataArrayTexture
    const layerIdx = attribute('layerIndex')
    const texArrayNode = texture(texArray.textureArray)
    const baseColor = texArrayNode.sample(uv()).depth(layerIdx)

    // "LOUE!" overlay blending (per-instance rentedOut factor 0-1)
    const overlayNode = texture(LOUE_OVERLAY_TEXTURE)
    const overlayColor = overlayNode.sample(uv())
    const rentedFactor = currentRentedOutBuffer.toAttribute()
    mat.colorNode = mix(baseColor, overlayColor, rentedFactor)

    // Hover offset from compute shader — applied in local space
    // instanceMatrix already contains rotation, so local Z offset hovers in correct direction
    const hoverZ = currentHoverZBuffer.toAttribute()
    mat.positionNode = positionLocal.add(vec3(0, 0, hoverZ))

    // Emissive from compute shader (includes dim red for all-rented-out)
    mat.emissiveNode = currentEmissiveBuffer.toAttribute()

    return mat
  }, [texArray, currentHoverZBuffer, currentEmissiveBuffer, currentRentedOutBuffer])

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
    // NOTE: ALL userData must be set here (not via JSX prop) because R3F reconciler
    // re-applies JSX userData on every re-render, wiping imperative additions.
    mesh.userData.isCassetteInstances = true
    mesh.userData.instanceIdToKey = instanceIdToKey
    mesh.userData.instanceIdToFilmId = instanceIdToFilmId
    mesh.userData.cassetteChunkIndex = chunkIndex

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

    // Load UNIQUE poster textures spread across frames (4 per frame — only ~50 unique posters)
    let cancelled = false
    const POSTERS_PER_FRAME = 4
    const queue: { index: number; url: string }[] = []
    for (const [url, layerIndex] of urlToLayer) {
      queue.push({ index: layerIndex, url })
    }

    let queueIdx = 0
    const loadNextBatch = () => {
      if (cancelled || queueIdx >= queue.length) return
      // Wait until GPUTexture is allocated to avoid canvas fallback (GPU→CPU sync stall)
      if (!texArray.isGPUReady()) {
        requestAnimationFrame(loadNextBatch)
        return
      }
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
  }, [texArray, material, geometry, count, instanceIdToKey, instanceIdToFilmId, urlToLayer, gl])

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

  // Track previous targeted key to skip 520-iteration loop when idle
  const prevTargetedKeyRef = useRef<string | null>(null)
  const hysteresisActiveRef = useRef(false)

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
    const filmRentalCounts = storeState.filmRentalCounts

    // Skip entire 520-iteration loop when nothing has changed and no hysteresis in progress
    if (targetedCassetteKey === prevTargetedKeyRef.current && !hysteresisActiveRef.current) {
      return
    }
    prevTargetedKeyRef.current = targetedCassetteKey

    // Get CPU-side typed arrays for target buffers
    const tarHoverArr = targetHoverZBuffer.value.array as Float32Array
    const tarEmissiveArr = targetEmissiveBuffer.value.array as Float32Array
    const tarRentedArr = targetRentedOutBuffer.value.array as Float32Array
    const hoverOffsets = hoverOffsetsRef.current

    let tarHoverDirty = false
    let tarEmissiveDirty = false
    let tarRentedDirty = false
    let anyHysteresisActive = false

    for (let i = 0; i < count; i++) {
      const hs = hysteresisStates[i]
      const isTargetedRaw = targetedCassetteKey === instanceIdToKey[i]
      const filmId = instanceIdToFilmId[i]
      const isRented = !!getRental(filmId)
      const rentalInfo = filmRentalCounts[filmId]
      const isAllRentedOut = rentalInfo ? rentalInfo.activeRentals >= rentalInfo.stock : false
      const showRentedOverlay = isAllRentedOut && !isRented

      // Hysteresis
      if (isTargetedRaw !== hs.stableTargeted) {
        // When another cassette is targeted, deselect immediately (no overlap)
        // Delay only applies when moving away from ALL cassettes (targetedCassetteKey === null)
        const isSwitch = !isTargetedRaw && targetedCassetteKey !== null
        if (isSwitch) {
          hs.stableTargeted = false
          hs.targetedTimer = 0
        } else {
          hs.targetedTimer += delta
          const delay = isTargetedRaw ? HYSTERESIS_SELECT : HYSTERESIS_DESELECT
          if (hs.targetedTimer >= delay) {
            hs.stableTargeted = isTargetedRaw
            hs.targetedTimer = 0
          } else {
            anyHysteresisActive = true
          }
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

      // Target emissive: rented=green, targeted=pink, all-rented=dim red, else=black
      let tR = 0; let tG = 0; let tB = 0
      if (isRented) {
        tR = 0; tG = 0.3; tB = 0 // green * 0.3 intensity
      } else if (isTargeted) {
        tR = 1.0 * 0.4; tG = 0.176 * 0.4; tB = 0.584 * 0.4 // #ff2d95 * 0.4
      } else if (showRentedOverlay) {
        tR = 0.3; tG = 0; tB = 0 // dim red glow
      }

      const idx3 = i * 3
      if (tarEmissiveArr[idx3] !== tR || tarEmissiveArr[idx3 + 1] !== tG || tarEmissiveArr[idx3 + 2] !== tB) {
        tarEmissiveArr[idx3] = tR
        tarEmissiveArr[idx3 + 1] = tG
        tarEmissiveArr[idx3 + 2] = tB
        tarEmissiveDirty = true
      }

      // Target rented-out overlay
      const newTarRented = showRentedOverlay ? 1.0 : 0.0
      if (tarRentedArr[i] !== newTarRented) {
        tarRentedArr[i] = newTarRented
        tarRentedDirty = true
      }
    }

    // Track hysteresis state for next-frame skip optimization
    hysteresisActiveRef.current = anyHysteresisActive

    // Upload changed targets to GPU — skip compute entirely when nothing changed
    if (tarHoverDirty) {
      targetHoverZBuffer.value.needsUpdate = true
    }
    if (tarEmissiveDirty) {
      targetEmissiveBuffer.value.needsUpdate = true
    }
    if (tarRentedDirty) {
      targetRentedOutBuffer.value.needsUpdate = true
    }

    if (tarHoverDirty || tarEmissiveDirty || tarRentedDirty) {
      const renderer = gl as unknown as THREE.WebGPURenderer
      renderer.compute(computeNode)
    }
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow
    />
  )
}

export function CassetteInstances({ instances, maxTextureArrayLayers = 2048 }: CassetteInstancesProps) {
  // With deduplicated layers, unique poster count is what matters — not instance count.
  // ~50 unique posters for ~520 instances means chunking rarely triggers.
  const safeLayerBudget = Math.max(1, Math.floor(maxTextureArrayLayers))

  const chunks = useMemo(() => {
    // Count unique poster URLs to check against layer budget
    const uniqueUrls = new Set<string>()
    for (const inst of instances) {
      if (inst.posterUrl) uniqueUrls.add(inst.posterUrl)
    }
    // +1 for fallback layer (no poster)
    const uniqueLayerCount = uniqueUrls.size + 1

    if (uniqueLayerCount <= safeLayerBudget) return [instances]

    // Rare: more unique posters than layer budget — split instances into groups
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
