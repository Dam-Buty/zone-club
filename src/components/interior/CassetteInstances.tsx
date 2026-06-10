import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  texture, uv, attribute,
  Fn, instanceIndex, deltaTime, instancedArray,
  uniform, mix, min, vec3, vec2, positionLocal, float, step,
  abs, cos, sin, normalWorld, clamp, varying, pow,
} from 'three/tsl'
import { CassetteTextureAtlas, type CassetteInstanceData } from '../../utils/CassetteTextureArray'
import { useStore } from '../../store'
import { useIsMobile } from '../../hooks/useIsMobile'
import { RAYCAST_LAYER_CASSETTE } from './Controls'
import { CASSETTE_DIMENSIONS } from './cassette-constants'
import { useProbeVolumes } from './ProbeVolumeContext'
import { useBakeDebug, PROBE_PI } from './bakeDebugStore'
import { shIrradiance } from '../../lib/lightbake/shReconstruct'
import { GRID_MIN, gridExt, G } from '../../lib/lightbake/probeGrid'

// Poster self-illumination floor — keeps tilted faces readable, but at night it greys the K7 and
// fights the baked neon. Night-mood lever: lower it so the K7 are LIT by the GI, not self-glowing.
// ?si= overrides (default 0.20). Non-baked.
const SELF_ILLUM = (() => {
  if (typeof window === 'undefined') return 0.2
  const p = parseFloat(new URLSearchParams(window.location.search).get('si') || '0.2')
  return Number.isFinite(p) ? p : 0.2
})()

// Live-tunable uniforms (driven by bakeDebugStore via the dev panel) — module-level singletons so
// they survive material rebuilds; writing .value is a cheap GPU uniform update (no shader recompile).
const SI_UNIFORM = uniform(SELF_ILLUM)
// K7 emissive tone-curve: gamma (fixed) deepens the muddy darks; the white-point (live ?k7=) rolls
// off the highlights so bright posters near neon don't blow past the bloom threshold (glow).
const K7_GAMMA = 1.3
export const K7_TONE_UNIFORM = uniform((() => {
  if (typeof window === 'undefined') return 0.9
  const p = parseFloat(new URLSearchParams(window.location.search).get('k7') || '0.9')
  return Number.isFinite(p) ? p : 0.9
})())

const SHARED_CASSETTE_GEOMETRY = new THREE.BoxGeometry(CASSETTE_DIMENSIONS.width, CASSETTE_DIMENSIONS.height, CASSETTE_DIMENSIONS.depth)

// Negative mipmap LOD bias for the atlas sampling (desktop). Pulls a finer mip at
// distance → sharper far cassettes within the fixed 200px source. Trade: a touch
// of aliasing, tamed by FXAA + the RCAS pass. -0.25 = safe, -1.5 = aggressive.
const MIP_LOD_BIAS = -0.25

// Scratch color for the per-frame ILLUMINER emissive cycle — avoids per-frame
// allocations inside the hot useFrame loop.
const _highlightColor = new THREE.Color()

// (The K7 "approach animation" feature — gated by ENABLE_HOVER_APPROACH —
// was removed in chore/lean-tier-a. It accumulated ~140 LOC of dead code
// because the flag had been false for a long time. If the feature is ever
// reintroduced, restore from git history at commit 8808aae.)

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
  const isMobile = useIsMobile()
  const probes = useProbeVolumes() // Phase-2 SH-L1 volumes (present only in ?baked=1 after the bake)

  const instancesRef = useRef(instances)
  instancesRef.current = instances

  // Build atlas, slot allocation (URL → slot), and per-instance atlasRect vec4
  const {
    atlas, instanceIdToKey, instanceIdToFilmId,
    atlasRectData, urlToSlot,
    hysteresisStates, hoverTiltBuffer, worldPosBuffer,
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
    // Desktop: trilinear mipmaps (motion stability) + negative LOD bias on sampling
    // (see MIP_LOD_BIAS) to claw back distant sharpness. Mobile: off (Pixel 9 spike).
    const _atlas = new CassetteTextureAtlas(uniqueSlotCount, !isMobile)

    // Build per-instance atlasRect (vec4: uOffset, vOffset, uScale, vScale)
    const _atlasRectData = new Float32Array(count * 4)
    const _hoverTiltData = new Float32Array(count)
    const fallbackRect = _atlas.getSlotRect(FALLBACK_SLOT)

    for (let i = 0; i < count; i++) {
      const inst = currentInstances[i]
      _hoverTiltData[i] = inst.hoverTiltAngle
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

    // Static per-instance tilt angle (storage buffer, filled once)
    const hoverTiltBuf = instancedArray(count, 'float')
    const hoverTiltArr = hoverTiltBuf.value.array as Float32Array
    for (let i = 0; i < count; i++) {
      hoverTiltArr[i] = currentInstances[i].hoverTiltAngle
    }

    // Per-instance WORLD position (storage buffer, filled once) → Phase-2 probe SH lookup.
    // Read via .element() (NO vertex-buffer slot — the K7 material is already at 7/8).
    const worldPosBuf = instancedArray(count, 'vec3')
    const worldPosArr = worldPosBuf.value.array as Float32Array
    for (let i = 0; i < count; i++) {
      const p = currentInstances[i].worldPosition
      worldPosArr[i * 3] = p.x; worldPosArr[i * 3 + 1] = p.y; worldPosArr[i * 3 + 2] = p.z
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
      hoverTiltBuffer: hoverTiltBuf,
      worldPosBuffer: worldPosBuf,
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
    mat.roughness = 0.85                       // Matte plastic sleeve
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
    // Desktop: negative LOD bias → sharper distant tiles (needs mips). Mobile: plain sample (no mips).
    const sampledPoster = atlasNode.sample(posterUV)
    const baseColor = isMobile ? sampledPoster : sampledPoster.bias(float(MIP_LOD_BIAS))

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
    // Per-instance hover tilt: bottom rows lean back (10°), top rows lean forward (15°)
    const perTilt = hoverTiltBuffer.element(instanceIndex)
    const hoverProgress = abs(hoverZ).div(float(0.088)).clamp(0, 1)
    const tiltAngle = hoverProgress.mul(perTilt)
    const cosA = cos(tiltAngle)
    const sinA = sin(tiltAngle)
    const rotatedY = positionLocal.y.mul(cosA).sub(positionLocal.z.mul(sinA))
    const rotatedZ = positionLocal.y.mul(sinA).add(positionLocal.z.mul(cosA))
    mat.positionNode = vec3(positionLocal.x, rotatedY, rotatedZ).add(vec3(0, 0, hoverZ))

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
    const selfIllum = cappedColor.mul(SI_UNIFORM) // readability floor for tilted poster faces (live ?si=)

    // Phase-2 baked GI: sample the SH-L1 probe volume at the instance's WORLD position and
    // reconstruct irradiance for the instance-rotated world normal. emissive-ADD (not a colorNode
    // multiply) because baked mode drops the analytical rig → a multiply would render the K7 black.
    let lit = selfIllum
    if (probes) {
      const e = gridExt()
      const gMin = vec3(GRID_MIN[0], GRID_MIN[1], GRID_MIN[2])
      const gInv = vec3(1 / e[0], 1 / e[1], 1 / e[2])
      const half = vec3(0.5 / G[0], 0.5 / G[1], 0.5 / G[2])
      const wp = worldPosBuffer.element(instanceIndex)
      const uvw = clamp(wp.sub(gMin).mul(gInv), half, vec3(1).sub(half))
      // varying() forces the SH eval into the VERTEX stage — instanceIndex is vertex-only, and
      // the design wants per-vertex sampling — then interpolates the irradiance to the fragment.
      const E = varying(shIrradiance(probes.shR, probes.shG, probes.shB, uvw, normalWorld))
      lit = selfIllum.add(cappedColor.mul(E).mul(PROBE_PI))
    }
    // Tone-curve the poster "lighting" (NOT the hover glow): gamma deepens the washed-out darks, and
    // a Reinhard roll-off toward the white-point K7_TONE keeps bright posters under the bloom
    // threshold so their whites stop glowing. Live ?k7= drives the white-point.
    const litC = pow(lit, float(K7_GAMMA))
    const litTone = litC.mul(K7_TONE_UNIFORM).div(litC.add(K7_TONE_UNIFORM))
    mat.emissiveNode = hoverEmissive.add(litTone)

    return mat
  }, [atlas, currentHoverZBuffer, currentEmissiveBuffer, currentRentedOutBuffer, worldPosBuffer, probes])

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

    // Load unique poster textures — try IndexedDB cache first, else throttled decode
    let cancelled = false
    const POSTERS_PER_FRAME = isMobile ? 4 : 10
    const queue: { slot: number; url: string }[] = []
    for (const [url, slot] of urlToSlot) {
      queue.push({ slot, url })
    }

    // Signal poster loading progress via global for InteriorScene loading screen
    if (typeof window !== 'undefined') {
      window.__posterProgress = { total: queue.length, loaded: 0 }
    }

    // Progressive load — fetch posters from /api/poster proxy (HTTP + disk cache
    // already provided by the server). Previously cached in IndexedDB but the
    // structured-clone of 33MB atlas blocked the main thread 5-8s on Pixel 9.
    let queueIdx = 0
    const loadNextBatch = async () => {
      if (cancelled || queueIdx >= queue.length) {
        if (!cancelled && queueIdx >= queue.length) {
          // Single full-atlas upload at end-of-load. Per-batch flushes would
          // trigger 35 × 33MB = 1.15GB of redundant GPU traffic.
          atlas.markDirty()
        }
        return
      }
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

  const prevTargetedKeyRef = useRef<string | null>(null)
  const prevHighlightedKeyRef = useRef<string | null>(null)
  const hysteresisActiveRef = useRef(false)
  const lerpFramesRef = useRef(0)
  // Cached instance index of the currently illuminated cassette so the hot
  // path can update a single row instead of scanning all ~520 every frame.
  const highlightedIdxRef = useRef<number>(-1)

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    atlas.flush()

    const storeState = useStore.getState()
    const targetedCassetteKey = storeState.targetedCassetteKey
    const highlightedCassetteKey = storeState.highlightedCassetteKey
    const getRental = storeState.getRental
    const filmRentalCounts = storeState.filmRentalCounts

    // Cold pass runs the full per-instance loop when *something other than the
    // highlight pulse* moves. Hot pass (below) handles the per-frame pulse on
    // the single illuminated K7 without scanning the other ~519 cassettes.
    const needsColdPass =
      targetedCassetteKey !== prevTargetedKeyRef.current ||
      highlightedCassetteKey !== prevHighlightedKeyRef.current ||
      hysteresisActiveRef.current ||
      lerpFramesRef.current > 0

    // === HOT PATH ===
    // Highlight active and nothing else changed → only the highlighted index
    // needs a fresh pulse Z + HSL emissive. Skip the 520-row loop entirely.
    if (!needsColdPass && highlightedCassetteKey != null && highlightedIdxRef.current >= 0) {
      const i = highlightedIdxRef.current
      const hoverOffsets = hoverOffsetsRef.current
      const tarHoverArr = targetHoverZBuffer.value.array as Float32Array
      const tarEmissiveArr = targetEmissiveBuffer.value.array as Float32Array

      const t = state.clock.elapsedTime
      // Back-and-forth pulse along the hover axis (~2.5 s period).
      const pulse = 1.2 + 0.4 * Math.sin(t * 2.5)
      tarHoverArr[i] = hoverOffsets[i] * pulse

      // HSL cycle green → blue → violet (~4.5 s round-trip).
      const h = 0.555 + 0.225 * Math.sin(t * 1.4)
      _highlightColor.setHSL(h, 1, 0.5)
      const idx3 = i * 3
      const intensity = 1.7
      tarEmissiveArr[idx3] = _highlightColor.r * intensity
      tarEmissiveArr[idx3 + 1] = _highlightColor.g * intensity
      tarEmissiveArr[idx3 + 2] = _highlightColor.b * intensity

      targetHoverZBuffer.value.needsUpdate = true
      targetEmissiveBuffer.value.needsUpdate = true

      // Dispatch compute so the GPU low-pass advances toward the new target.
      const renderer = gl as unknown as THREE.WebGPURenderer
      renderer.compute(computeNode)
      return
    }

    if (!needsColdPass) {
      return
    }
    prevTargetedKeyRef.current = targetedCassetteKey
    // Recompute the cached highlighted index whenever the key changes.
    if (highlightedCassetteKey !== prevHighlightedKeyRef.current) {
      highlightedIdxRef.current = highlightedCassetteKey == null
        ? -1
        : instanceIdToKey.indexOf(highlightedCassetteKey)
    }
    prevHighlightedKeyRef.current = highlightedCassetteKey

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
      const isHighlighted = highlightedCassetteKey != null && highlightedCassetteKey === instanceIdToKey[i]

      // Explicit ILLUMINER highlight pushes the K7 out further than a regular
      // hover so it reads as a deliberate "look here" cue from across the room.
      // Layered on top: a back-and-forth pulse that drives the K7 along the
      // same hover axis as a raycast popout, but oscillating ~0.8x ↔ 1.6x the
      // hover offset (~2.5s period). The compute-pass low-pass (speed 12)
      // damps it ~2 %, so the target sine reaches the cassette almost intact.
      let newTarHoverZ = isTargeted ? hoverOffsets[i] : 0
      if (isHighlighted) {
        const pulse = 1.2 + 0.4 * Math.sin(state.clock.elapsedTime * 2.5)
        newTarHoverZ = hoverOffsets[i] * pulse
      }
      if (tarHoverArr[i] !== newTarHoverZ) {
        tarHoverArr[i] = newTarHoverZ
        tarHoverDirty = true
      }

      let tR = 0; let tG = 0; let tB = 0
      if (isHighlighted) {
        // Time-driven HSL cycle: hue ∈ [0.33, 0.78] sweeps green → blue →
        // violet (~4.5s round-trip). Intensity 1.7 keeps the bloom halo as
        // strong as the previous static blue emissive.
        const t = state.clock.elapsedTime
        const h = 0.555 + 0.225 * Math.sin(t * 1.4)
        _highlightColor.setHSL(h, 1, 0.5)
        const intensity = 1.7
        tR = _highlightColor.r * intensity
        tG = _highlightColor.g * intensity
        tB = _highlightColor.b * intensity
      } else if (isRented) {
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

    if (lerpFramesRef.current > 0) {
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
  // Live tuning: write the panel's si/pi into the shared TSL uniforms (cheap GPU update, no recompile).
  const si = useBakeDebug((s) => s.si)
  const pi = useBakeDebug((s) => s.pi)
  const k7 = useBakeDebug((s) => s.k7)
  useEffect(() => {
    SI_UNIFORM.value = si
    PROBE_PI.value = pi
    K7_TONE_UNIFORM.value = k7
  }, [si, pi, k7])
  return (
    <CassetteInstancesChunk
      instances={instances}
      chunkIndex={0}
    />
  )
}
