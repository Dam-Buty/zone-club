import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  texture, uv, attribute,
  Fn, instanceIndex, deltaTime, instancedArray,
  uniform, mix, min, vec3, vec2, positionLocal, float, step,
} from 'three/tsl'
import { CassetteTextureAtlas, type CassetteInstanceData } from '../../utils/CassetteTextureArray'
import { useStore } from '../../store'
import { RAYCAST_LAYER_CASSETTE } from './Controls'
import { CASSETTE_DIMENSIONS } from './Cassette'

const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_DIMENSIONS.width, CASSETTE_DIMENSIONS.height, CASSETTE_DIMENSIONS.depth)

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
const ENABLE_HOVER_APPROACH = false

// K7 approach animation constants
const APPROACH_HOVER_DELAY = 0.9
const APPROACH_DURATION = 0.8
const APPROACH_RETURN_SPEED = 3.0
const APPROACH_SCALE = 1.68
const APPROACH_DISTANCE = 0.8  // metres devant la camera
const APPROACH_MIN_CAMERA_DIST = 0.9  // désactiver si joueur trop proche de la K7
const APPROACH_MAX_CAMERA_DIST = 4.0  // désactiver si joueur trop loin de la K7
const APPROACH_GRACE_PERIOD = 2.5     // secondes: annulable en bougeant le viseur
const APPROACH_SCREEN_THRESHOLD = 0.12 // distance NDC pour annuler pendant grace period

// Reusable vectors for approach animation (module-level, no per-frame allocation)
const _approachPos = new THREE.Vector3()
const _approachQuat = new THREE.Quaternion()
const _approachScale = new THREE.Vector3()
const _origPos = new THREE.Vector3()
const _origQuat = new THREE.Quaternion()
const _origScale = new THREE.Vector3()
const _approachMatrix = new THREE.Matrix4()
const _origMatrix = new THREE.Matrix4()
const _cameraDir = new THREE.Vector3()
const _screenProj = new THREE.Vector3()
const _rot180Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)

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
    mat.roughness = 0.10                       // Glossy plastic sleeve — tight specular point
    mat.metalness = 0.0

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
    // Soft Reinhard albedo compression — prevents white blowout while preserving contrast.
    // x*peak/(x+peak): nearly linear for dark values, compresses bright highlights.
    const blendedColor = mix(baseColor, overlayColor, rentedFactor)
    const peakAlbedo = float(0.70)
    const cappedColor = blendedColor.mul(peakAlbedo).div(blendedColor.add(peakAlbedo))
    mat.colorNode = cappedColor

    const hoverZ = currentHoverZBuffer.toAttribute()
    mat.positionNode = positionLocal.add(vec3(0, 0, hoverZ))

    // Outline mask from box UVs: 1.0 on edges, 0.0 in center
    const border = float(0.012)
    const uvCoord = uv()
    const interiorMask = step(border, uvCoord.x)
      .mul(step(border, uvCoord.y))
      .mul(step(border, float(1.0).sub(uvCoord.x)))
      .mul(step(border, float(1.0).sub(uvCoord.y)))
    const outlineMask = float(1.0).sub(interiorMask)

    // Base emissive: self-illumination so tilted poster faces stay readable.
    // Hover highlight applies ONLY on outline border (not full surface).
    const hoverEmissive = currentEmissiveBuffer.toAttribute().mul(outlineMask)
    mat.emissiveNode = hoverEmissive.add(cappedColor.mul(float(0.12)))

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

    // Save original matrices only if the hover-approach feature is enabled.
    if (ENABLE_HOVER_APPROACH) {
      const origData = new Float32Array(count * 16)
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, _tempMatrix)
        _tempMatrix.toArray(origData, i * 16)
      }
      originalMatricesRef.current = origData
    } else {
      originalMatricesRef.current = new Float32Array(0)
    }

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

    // Load unique poster textures (10 per frame — ~50 unique posters total)
    let cancelled = false
    const POSTERS_PER_FRAME = 10
    const queue: { slot: number; url: string }[] = []
    for (const [url, slot] of urlToSlot) {
      queue.push({ slot, url })
    }

    // Signal poster loading progress via global for InteriorScene loading screen
    if (typeof window !== 'undefined') {
      window.__posterProgress = { total: queue.length, loaded: 0 }
    }

    let queueIdx = 0
    const loadNextBatch = async () => {
      if (cancelled || queueIdx >= queue.length) return
      if (!atlas.isGPUReady()) {
        requestAnimationFrame(() => { void loadNextBatch() })
        return
      }
      const end = Math.min(queueIdx + POSTERS_PER_FRAME, queue.length)
      await Promise.all(
        queue.slice(queueIdx, end).map(({ slot, url }) => atlas.loadPosterIntoSlot(url, slot))
      )
      queueIdx = end
      if (typeof window !== 'undefined' && window.__posterProgress) {
        window.__posterProgress.loaded = queueIdx
      }
      requestAnimationFrame(() => { void loadNextBatch() })
    }
    requestAnimationFrame(() => { void loadNextBatch() })

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

  const originalMatricesRef = useRef<Float32Array>(new Float32Array(0))
  const approachRef = useRef({
    instanceIndex: -1,
    progress: 0,
    hoverDuration: 0,
    elapsedTime: 0,
    active: false,
    returning: false,
    fixedPos: new THREE.Vector3(),
    fixedQuat: new THREE.Quaternion(),
  })

  const prevTargetedKeyRef = useRef<string | null>(null)
  const hysteresisActiveRef = useRef(false)
  const lerpFramesRef = useRef(0)

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    atlas.flush()

    const storeState = useStore.getState()
    const targetedCassetteKey = storeState.targetedCassetteKey
    const getRental = storeState.getRental
    const filmRentalCounts = storeState.filmRentalCounts

    const ap = approachRef.current

    // Reset approach when film is selected (VHSCaseOverlay opens)
    if (ENABLE_HOVER_APPROACH && storeState.selectedFilmId !== null && ap.active && originalMatricesRef.current.length > 0) {
      _origMatrix.fromArray(originalMatricesRef.current, ap.instanceIndex * 16)
      mesh.setMatrixAt(ap.instanceIndex, _origMatrix)
      mesh.instanceMatrix.needsUpdate = true
      ap.active = false
      ap.returning = false
      ap.instanceIndex = -1
      ap.hoverDuration = 0
      ap.progress = 0
      ap.elapsedTime = 0
    }

    const needsProcessing =
      targetedCassetteKey !== prevTargetedKeyRef.current ||
      hysteresisActiveRef.current ||
      lerpFramesRef.current > 0

    if (!needsProcessing) {
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
        tR = 0; tG = 0.5; tB = 0.1
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

    // === K7 Approach Animation ===
    if (ENABLE_HOVER_APPROACH && originalMatricesRef.current.length > 0) {
      let stableTargetIdx = -1
      for (let i = 0; i < count; i++) {
        if (hysteresisStates[i].stableTargeted) {
          stableTargetIdx = i
          break
        }
      }

      // Track approach state
      if (stableTargetIdx >= 0 && stableTargetIdx === ap.instanceIndex) {
        ap.hoverDuration += delta
      } else if (stableTargetIdx >= 0 && stableTargetIdx !== ap.instanceIndex) {
        if (ap.active) {
          ap.returning = true
        } else {
          ap.instanceIndex = stableTargetIdx
          ap.hoverDuration = 0
          ap.progress = 0
        }
      } else if (stableTargetIdx === -1) {
        if (ap.active) {
          ap.returning = true
        } else {
          ap.hoverDuration = 0
          ap.instanceIndex = -1
        }
      }

      // Trigger approach after hover delay
      if (ap.hoverDuration >= APPROACH_HOVER_DELAY && !ap.active && stableTargetIdx >= 0) {
        const camera = state.camera
        _origMatrix.fromArray(originalMatricesRef.current, stableTargetIdx * 16)
        _origMatrix.decompose(_origPos, _origQuat, _origScale)
        const dist = camera.position.distanceTo(_origPos)

        if (dist >= APPROACH_MIN_CAMERA_DIST && dist <= APPROACH_MAX_CAMERA_DIST) {
          ap.active = true
          ap.returning = false
          ap.progress = 0
          ap.elapsedTime = 0
          ap.instanceIndex = stableTargetIdx
          camera.getWorldDirection(_cameraDir)
          ap.fixedPos.copy(camera.position).addScaledVector(_cameraDir, APPROACH_DISTANCE)
          ap.fixedPos.y -= 0.05
          ap.fixedQuat.copy(camera.quaternion).multiply(_rot180Y)
        }
      }

      // Force hoverZ + emissive to 0 for approached instance
      if (ap.active && ap.instanceIndex >= 0) {
        if (tarHoverArr[ap.instanceIndex] !== 0) {
          tarHoverArr[ap.instanceIndex] = 0
          tarHoverDirty = true
        }
        const ei = ap.instanceIndex * 3
        if (tarEmissiveArr[ei] !== 0 || tarEmissiveArr[ei + 1] !== 0 || tarEmissiveArr[ei + 2] !== 0) {
          tarEmissiveArr[ei] = 0
          tarEmissiveArr[ei + 1] = 0
          tarEmissiveArr[ei + 2] = 0
          tarEmissiveDirty = true
        }
      }

      // Animate approach
      if (ap.active) {
        if (!ap.returning) {
          ap.elapsedTime += delta
        }

        // Grace period: cancel if crosshair moved away from original K7 position
        if (!ap.returning && ap.elapsedTime < APPROACH_GRACE_PERIOD) {
          _origMatrix.fromArray(originalMatricesRef.current, ap.instanceIndex * 16)
          _origMatrix.decompose(_origPos, _origQuat, _origScale)
          _screenProj.copy(_origPos).project(state.camera)
          const screenDist = Math.sqrt(_screenProj.x * _screenProj.x + _screenProj.y * _screenProj.y)
          if (screenDist > APPROACH_SCREEN_THRESHOLD) {
            ap.returning = true
          }
        }

        if (ap.returning) {
          ap.progress -= delta * APPROACH_RETURN_SPEED
          if (ap.progress <= 0) {
            ap.progress = 0
            _origMatrix.fromArray(originalMatricesRef.current, ap.instanceIndex * 16)
            mesh.setMatrixAt(ap.instanceIndex, _origMatrix)
            mesh.instanceMatrix.needsUpdate = true
            ap.active = false
            ap.returning = false
            ap.instanceIndex = stableTargetIdx >= 0 ? stableTargetIdx : -1
            ap.hoverDuration = 0
            ap.elapsedTime = 0
          }
        } else {
          ap.progress = Math.min(1, ap.progress + delta / APPROACH_DURATION)
        }

        if (ap.active) {
          const t = ap.progress
          const eased = t * t * (3 - 2 * t)

          _origMatrix.fromArray(originalMatricesRef.current, ap.instanceIndex * 16)
          _origMatrix.decompose(_origPos, _origQuat, _origScale)

          _approachPos.copy(_origPos).lerp(ap.fixedPos, eased)
          _approachQuat.copy(_origQuat).slerp(ap.fixedQuat, eased)

          const s = 1 + (APPROACH_SCALE - 1) * eased
          _approachScale.set(s, s, s)

          _approachMatrix.compose(_approachPos, _approachQuat, _approachScale)
          mesh.setMatrixAt(ap.instanceIndex, _approachMatrix)
          mesh.instanceMatrix.needsUpdate = true
        }
      }
    }

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
      lerpFramesRef.current = 20
    }

    if (lerpFramesRef.current > 0 || (ENABLE_HOVER_APPROACH && ap.active)) {
      const renderer = gl as unknown as THREE.WebGPURenderer
      renderer.compute(computeNode)
      if (lerpFramesRef.current > 0) lerpFramesRef.current--
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
