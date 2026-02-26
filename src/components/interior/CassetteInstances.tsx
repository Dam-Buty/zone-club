import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  texture, uv, attribute,
  Fn, instanceIndex, deltaTime, instancedArray,
  uniform, mix, vec3, vec2, positionLocal, float,
} from 'three/tsl'
import { CassetteTextureAtlas, type CassetteInstanceData } from '../../utils/CassetteTextureArray'
import { useStore } from '../../store'
import { RAYCAST_LAYER_CASSETTE } from './Controls'

const CASSETTE_WIDTH = 0.168
const CASSETTE_HEIGHT = 0.228
const CASSETTE_DEPTH = 0.03

const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_WIDTH, CASSETTE_HEIGHT, CASSETTE_DEPTH)

const LOUE_OVERLAY_TEXTURE = (() => {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 300
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(0, 0, 200, 300)

  ctx.font = 'bold 36px "Arial Black", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ff3333'
  ctx.shadowColor = '#ff0000'
  ctx.shadowBlur = 8
  ctx.fillText('LOUÉ !', 100, 140)

  ctx.font = '14px Arial, sans-serif'
  ctx.fillStyle = '#ffcc00'
  ctx.shadowBlur = 0
  ctx.fillText('retour bientôt', 100, 175)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

const HYSTERESIS_SELECT = 0.05
const HYSTERESIS_DESELECT = 0.25

interface InstanceHysteresisState {
  stableTargeted: boolean
  targetedTimer: number
}

interface CassetteInstancesProps {
  instances: CassetteInstanceData[]
}

interface CassetteChunkProps {
  instances: CassetteInstanceData[]
  chunkIndex: number
}

function CassetteInstancesChunk({ instances, chunkIndex }: CassetteChunkProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const count = instances.length
  const gl = useThree(state => state.gl)

  const instancesRef = useRef(instances)
  instancesRef.current = instances

  // Build atlas, slot allocation (URL → slot), and per-instance atlasRect vec4
  const {
    atlas, instanceIdToKey, instanceIdToFilmId,
    atlasRectData, urlToSlot,
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

    // Deduplicate poster URLs → shared atlas slots
    // Slot 0 = fallback (no poster), then 1 slot per unique posterUrl
    const _urlToSlot = new Map<string, number>()
    const FALLBACK_SLOT = 0
    let nextSlot = 1

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      idToKey[i] = inst.cassetteKey
      idToFilm[i] = inst.filmId
      hStates[i] = { stableTargeted: false, targetedTimer: 0 }

      if (inst.posterUrl) {
        if (!_urlToSlot.has(inst.posterUrl)) {
          _urlToSlot.set(inst.posterUrl, nextSlot++)
        }
      }
    }

    const uniqueSlotCount = nextSlot
    const _atlas = new CassetteTextureAtlas(uniqueSlotCount)

    // Build per-instance atlasRect (vec4: uOffset, vOffset, uScale, vScale)
    const _atlasRectData = new Float32Array(count * 4)
    const fallbackRect = _atlas.getSlotRect(FALLBACK_SLOT)

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      let rect: [number, number, number, number]
      if (!inst.posterUrl) {
        rect = fallbackRect
      } else {
        const slot = _urlToSlot.get(inst.posterUrl)!
        rect = _atlas.getSlotRect(slot)
      }
      const base = i * 4
      _atlasRectData[base] = rect[0]
      _atlasRectData[base + 1] = rect[1]
      _atlasRectData[base + 2] = rect[2]
      _atlasRectData[base + 3] = rect[3]
    }

    // GPU storage buffers for animation (instancedArray = StorageInstancedBufferAttribute)
    const curHoverZ = instancedArray(count, 'float')
    const tarHoverZ = instancedArray(count, 'float')
    const curEmissive = instancedArray(count, 'vec3')
    const tarEmissive = instancedArray(count, 'vec3')
    const curRentedOut = instancedArray(count, 'float')
    const tarRentedOut = instancedArray(count, 'float')

    const speedHover = uniform(12.0)
    const speedEmissive = uniform(10.0)

    const computeFn = Fn(() => {
      const idx = instanceIndex

      const curH = curHoverZ.element(idx)
      const tarH = tarHoverZ.element(idx)
      const tH = deltaTime.mul(speedHover).min(float(1.0))
      curH.assign(mix(curH, tarH, tH))

      const curE = curEmissive.element(idx)
      const tarE = tarEmissive.element(idx)
      const tE = deltaTime.mul(speedEmissive).min(float(1.0))
      curE.assign(mix(curE, tarE, tE))

      const curR = curRentedOut.element(idx)
      const tarR = tarRentedOut.element(idx)
      curR.assign(mix(curR, tarR, tE))
    })

    const cNode = computeFn().compute(count)

    return {
      atlas: _atlas,
      instanceIdToKey: idToKey,
      instanceIdToFilmId: idToFilm,
      atlasRectData: _atlasRectData,
      urlToSlot: _urlToSlot,
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

  // Geometry with per-instance atlasRect (vec4) attribute
  const geometry = useMemo(() => {
    const chunkGeometry = SHARED_CASSETTE_GEOMETRY.clone()
    const atlasRectAttr = new THREE.InstancedBufferAttribute(atlasRectData, 4)
    chunkGeometry.setAttribute('atlasRect', atlasRectAttr)
    return chunkGeometry
  }, [atlasRectData])

  // TSL material — 2D atlas texture with UV remapping per instance
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardNodeMaterial()
    mat.roughness = 0.15
    mat.metalness = 0.15

    // Per-instance atlas rect: vec4(uOffset, vOffset, uScale, vScale)
    const atlasRect = attribute('atlasRect')
    const atlasNode = texture(atlas.texture)

    // Remap box-face UVs to atlas sub-region.
    // V is flipped: DataTexture flipY=false stores rows top-to-bottom (row 0 = top),
    // but BoxGeometry UV.y=0 is bottom of quad → we need (1-uv.y) to match.
    const posterUV = vec2(
      atlasRect.x.add(atlasRect.z.mul(uv().x)),
      atlasRect.y.add(atlasRect.w.mul(float(1.0).sub(uv().y)))
    )
    const baseColor = atlasNode.sample(posterUV)

    // "LOUE!" overlay blending (per-instance rentedOut factor 0-1)
    const overlayNode = texture(LOUE_OVERLAY_TEXTURE)
    const overlayColor = overlayNode.sample(uv())
    const rentedFactor = currentRentedOutBuffer.toAttribute()
    mat.colorNode = mix(baseColor, overlayColor, rentedFactor)

    const hoverZ = currentHoverZBuffer.toAttribute()
    mat.positionNode = positionLocal.add(vec3(0, 0, hoverZ))

    mat.emissiveNode = currentEmissiveBuffer.toAttribute()

    return mat
  }, [atlas, currentHoverZBuffer, currentEmissiveBuffer, currentRentedOutBuffer])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const currentInstances = instancesRef.current
    const _tempMatrix = new THREE.Matrix4()
    const _tempScale = new THREE.Vector3(1, 1, 1)

    mesh.layers.enable(RAYCAST_LAYER_CASSETTE)
    mesh.frustumCulled = false

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      _tempMatrix.compose(inst.worldPosition, inst.worldQuaternion, _tempScale)
      mesh.setMatrixAt(i, _tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    mesh.userData.isCassetteInstances = true
    mesh.userData.instanceIdToKey = instanceIdToKey
    mesh.userData.instanceIdToFilmId = instanceIdToFilmId
    mesh.userData.cassetteChunkIndex = chunkIndex

    const tarHoverArr = targetHoverZBuffer.value.array as Float32Array
    for (let i = 0; i < count; i++) {
      tarHoverArr[i] = 0
    }

    atlas.flush()

    const renderer = gl as unknown as THREE.WebGPURenderer
    atlas.setRenderer(renderer)

    // Load unique poster textures (4 per frame — ~50 unique posters total)
    let cancelled = false
    const POSTERS_PER_FRAME = 4
    const queue: { slot: number; url: string }[] = []
    for (const [url, slot] of urlToSlot) {
      queue.push({ slot, url })
    }

    let queueIdx = 0
    const loadNextBatch = () => {
      if (cancelled || queueIdx >= queue.length) return
      if (!atlas.isGPUReady()) {
        requestAnimationFrame(loadNextBatch)
        return
      }
      const end = Math.min(queueIdx + POSTERS_PER_FRAME, queue.length)
      for (let j = queueIdx; j < end; j++) {
        const { slot, url } = queue[j]
        atlas.loadPosterIntoSlot(url, slot)
      }
      queueIdx = end
      requestAnimationFrame(loadNextBatch)
    }
    requestAnimationFrame(loadNextBatch)

    return () => {
      cancelled = true
      atlas.dispose()
      material.dispose()
      geometry.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, material, geometry, count, instanceIdToKey, instanceIdToFilmId, urlToSlot, gl])

  const hoverOffsetsRef = useRef<Float32Array>(new Float32Array(0))
  useEffect(() => {
    const offsets = new Float32Array(count)
    const currentInstances = instancesRef.current
    for (let i = 0; i < count; i++) {
      offsets[i] = currentInstances[i].hoverOffsetZ
    }
    hoverOffsetsRef.current = offsets
  }, [count])

  const prevTargetedKeyRef = useRef<string | null>(null)
  const hysteresisActiveRef = useRef(false)

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    atlas.flush()

    const storeState = useStore.getState()
    const targetedCassetteKey = storeState.targetedCassetteKey
    const getRental = storeState.getRental
    const filmRentalCounts = storeState.filmRentalCounts

    if (targetedCassetteKey === prevTargetedKeyRef.current && !hysteresisActiveRef.current) {
      return
    }
    prevTargetedKeyRef.current = targetedCassetteKey

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

      if (isTargetedRaw !== hs.stableTargeted) {
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

      const newTarHoverZ = isTargeted ? hoverOffsets[i] : 0
      if (tarHoverArr[i] !== newTarHoverZ) {
        tarHoverArr[i] = newTarHoverZ
        tarHoverDirty = true
      }

      let tR = 0; let tG = 0; let tB = 0
      if (isRented) {
        tR = 0; tG = 0.3; tB = 0
      } else if (isTargeted) {
        tR = 1.0 * 0.4; tG = 0.176 * 0.4; tB = 0.584 * 0.4
      } else if (showRentedOverlay) {
        tR = 0.3; tG = 0; tB = 0
      }

      const idx3 = i * 3
      if (tarEmissiveArr[idx3] !== tR || tarEmissiveArr[idx3 + 1] !== tG || tarEmissiveArr[idx3 + 2] !== tB) {
        tarEmissiveArr[idx3] = tR
        tarEmissiveArr[idx3 + 1] = tG
        tarEmissiveArr[idx3 + 2] = tB
        tarEmissiveDirty = true
      }

      const newTarRented = showRentedOverlay ? 1.0 : 0.0
      if (tarRentedArr[i] !== newTarRented) {
        tarRentedArr[i] = newTarRented
        tarRentedDirty = true
      }
    }

    hysteresisActiveRef.current = anyHysteresisActive

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

export function CassetteInstances({ instances }: CassetteInstancesProps) {
  return (
    <CassetteInstancesChunk
      instances={instances}
      chunkIndex={0}
    />
  )
}
