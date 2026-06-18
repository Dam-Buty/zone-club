import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'
import { useStore } from '../../store'
import { getLastRenderActivity, installRenderActivityListeners } from '../../utils/renderActivity'

interface PostProcessingEffectsProps {
  isMobile?: boolean
}

// Adaptive render throttle (see utils/renderActivity.ts for the rationale).
// ACTIVE: player moving / looking / mid-transition → smooth 60 fps (capped from 120).
// IDLE:   no input past ACTIVE_GRACE_MS → drop to IDLE_FPS; ambient anims keep ticking
//         in their own useFrame loops, we just re-render the post chain far less often.
const ACTIVE_FPS = 60
const IDLE_FPS = 20
const ACTIVE_GRACE_MS = 800
const ACTIVE_INTERVAL = 1 / ACTIVE_FPS
const IDLE_INTERVAL = 1 / IDLE_FPS

// RCAS (Robust Contrast-Adaptive Sharpening) strength: 0 = max sharpening, 2 = none.
// Final desktop pass — counters the trilinear-mip + FXAA softness on distant K7
// posters without adding source resolution / VRAM. Tunable.
const SHARPEN_AMOUNT = 0.4

// --- Adaptive resolution scaler (dynamic resolution) --------------------------
// The render is fragment-bound (cost ∝ pixels). On a Retina M1 Air the backbuffer
// is ~8 MP (devicePixelRatio 2 × supersample 1.25) → unplayable. Instead of a fixed
// low resolution, scale the pixelRatio with GPU load: drop it WHILE MOVING (you can't
// perceive resolution in motion), restore the full supersampled res AT REST (when you
// actually read the posters). The frame-interval EMA (rAF spacing under vsync) is the
// load signal — no timestamp query needed. Scale is a fraction of the Canvas max dpr,
// so the ceiling already encodes the desktop/mobile cap.
// The signal is the interval between EFFECTIVE renders (after the 60-fps throttle gate), NOT the
// rAF interval — the throttle caps rendering at 60 fps regardless of a 120 Hz display, so rAF
// spacing (8.3 ms on 120 Hz) is meaningless; render-to-render is ≈16.7 ms when we hold 60 fps and
// climbs when the GPU can't. Clean on a 60 Hz panel (the M1 Air — the actual target).
// Raise is PROBED (after a saturation-free spell), not threshold-based: when vsync caps us we can't
// see headroom, so we can't tell "holds 60 with margin" from "holds 60 exactly" — probe up slowly,
// and if it re-saturates the reactive drop catches it.
const DRS_MIN_SCALE = 0.5      // floor vs the Canvas max dpr — keeps a legible minimum in motion
const DRS_STEP = 0.1          // per-adjustment increment (discrete levels, fewer resizes)
const DRS_DROP_MS = 22         // render-to-render EMA above → not holding 60 fps → drop (reactive)
const DRS_PROBE_MS = 4000     // no saturation for this long → probe one step up (recover sharpness)
const DRS_DROP_COOLDOWN = 350 // min ms between drops
const DRS_RAISE_COOLDOWN = 700
const DRS_SETTLE_MS = 300     // after a resize, ignore intervals (RT realloc spike) this long
const DRS_EMA_SEED = 16.7     // 60 fps

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
  const setDpr = useThree((s) => s.setDpr)
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)
  const bokehRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomStrengthRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomBaseStrength = isMobile ? 0.12 : 0.18
  const isVHSCaseOpen = useStore(state => state.isVHSCaseOpen)
  const dofTrigger = isMobile ? false : isVHSCaseOpen

  useEffect(() => {
    const postProcessing = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)

    // Vignette — shared between mobile and desktop
    const applyVignette = (input: ReturnType<typeof pass>) => {
      const dist = viewportUV.sub(float(0.5)).length()
      const vignetteFactor = clamp(
        dist.mul(float(1.1)),
        float(0.0),
        float(1.0),
      ).oneMinus().pow(float(0.55))
      return input.mul(vignetteFactor)
    }

    if (isMobile) {
      // ===== MOBILE PIPELINE: Scene → Bloom → Vignette → FXAA =====
      const scenePass = pass(scene, camera)
      const scenePassColor = scenePass.getTextureNode('output')

      // Bloom with high threshold (0.5) — only emissive neon tubes trigger
      const bloomStrength = uniform(bloomBaseStrength)
      bloomStrengthRef.current = bloomStrength
      const bloomPass = bloom(scenePassColor, 0.32, bloomStrength, 0.50)
      const withBloom = scenePassColor.add(bloomPass)

      const withVignette = applyVignette(withBloom)
      const withFXAA = fxaa(withVignette)
      postProcessing.outputNode = withFXAA

    } else {
      // ===== DESKTOP PIPELINE =====
      // Scene MRT → SSGI (temporal) → Bloom → DoF → Vignette → FXAA

      // 1. Scene pass (no MRT — SSGI disabled)
      const scenePass = pass(scene, camera)
      const scenePassColor = scenePass.getTextureNode('output')

      // SSGI disabled — too expensive (~3× frame time)
      // TODO: re-enable with lower settings or on high-end GPUs only

      // 3. Bloom
      const bloomStrength = uniform(isVHSCaseOpen ? 0.0 : bloomBaseStrength)
      bloomStrengthRef.current = bloomStrength
      const bloomPass = bloom(scenePassColor, 0.32, bloomStrength, 0.70)
      const withBloom = scenePassColor.add(bloomPass)

      // 4. Conditional DoF — only when VHS case viewer is open
      let postBloom = withBloom

      if (isVHSCaseOpen) {
        const scenePassViewZ = scenePass.getViewZNode()
        const bokehScale = uniform(0)
        bokehRef.current = bokehScale
        postBloom = dof(withBloom, scenePassViewZ, 0.4725, 1.0, bokehScale)
      }

      // 5. Vignette + AA (SMAA, desktop) + final RCAS sharpen
      const withVignette = applyVignette(postBloom)
      // SMAA (sharper edge AA than FXAA — less overall blur). Desktop only; mobile
      // keeps FXAA for cost. Then a final RCAS sharpen for crispness, no extra VRAM.
      const withAA = smaa(withVignette)
      postProcessing.outputNode = sharpen(withAA, SHARPEN_AMOUNT)
    }

    postProcessingRef.current = postProcessing
    // Expose for the scene-ready gate (InteriorScene) so it can warmup pipelines
    // in the PostProcessing render-target context (HalfFloat) — pipelines compiled
    // for the default RT in compileAsync are useless here, the actual render uses
    // PassNode's render target which has a different format.
    ;(window as unknown as { __postProcessing?: THREE.PostProcessing }).__postProcessing = postProcessing

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
      bokehRef.current = null
      bloomStrengthRef.current = null
      ;(window as unknown as { __postProcessing?: THREE.PostProcessing | null }).__postProcessing = null
    }
  }, [renderer, scene, camera, isMobile, dofTrigger])

  const renderAccumRef = useRef(0)
  // Adaptive resolution state
  const dprMaxRef = useRef(0)         // Canvas max dpr (captured at first frame), the ceiling
  const dprScaleRef = useRef(1)       // current fraction of the ceiling (1 = full)
  const frameMsEmaRef = useRef(DRS_EMA_SEED) // EMA of the render-to-render interval (ms)
  const lastDrsAdjustRef = useRef(0)
  const lastRenderTimeRef = useRef(0) // timestamp of the previous EFFECTIVE render (0 = none/reset)
  const lastSaturationRef = useRef(0) // last time the EMA exceeded DROP_MS
  const drsSettleUntilRef = useRef(0) // ignore intervals until this time (post-resize spike)
  const isTerminalOpen = useStore(state => state.isTerminalOpen)
  const isPlayerOpen = useStore(state => state.isPlayerOpen)

  // Install the global activity listeners once (idempotent).
  useEffect(() => {
    installRenderActivityListeners()
  }, [])

  // Dev hooks to observe / drive the adaptive resolution scaler (Playwright + console).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const w = window as unknown as Record<string, unknown>
    w.__drs = () => ({ scale: dprScaleRef.current, emaMs: +frameMsEmaRef.current.toFixed(1), maxPR: dprMaxRef.current, curPR: renderer.getPixelRatio() })
    // Force a high ceiling to test the scaler on a fast GPU (simulate Retina saturation).
    w.__drsSetMax = (pr: number) => { dprMaxRef.current = pr; dprScaleRef.current = 1; lastDrsAdjustRef.current = 0; frameMsEmaRef.current = DRS_EMA_SEED; lastRenderTimeRef.current = 0; setDpr(pr) }
    return () => { delete w.__drs; delete w.__drsSetMax }
  }, [renderer, setDpr])

  useFrame((_, delta) => {
    if (document.hidden) return

    // Full 2D overlays completely cover the 3D scene — skip rendering entirely.
    // The last rendered frame stays on the canvas; rendering resumes seamlessly on close.
    if (isTerminalOpen || isPlayerOpen) return

    const pp = postProcessingRef.current
    if (!pp) return

    // Lerp the post uniforms every tick (cheap; keeps transitions smooth even when
    // the render itself is throttled, since transitions force the ACTIVE budget below).
    if (isVHSCaseOpen && bokehRef.current) {
      const target = 4.0
      bokehRef.current.value += (target - bokehRef.current.value) * Math.min(delta * 8, 1)
    }
    if (bloomStrengthRef.current) {
      const bloomTarget = isVHSCaseOpen ? 0.0 : bloomBaseStrength
      bloomStrengthRef.current.value += (bloomTarget - bloomStrengthRef.current.value) * Math.min(delta * 8, 1)
    }

    // --- Adaptive render throttle -------------------------------------------
    // Static scene re-rendered ~15 post passes/frame at 120 fps = wasted GPU.
    // Render at 60 fps while active, drop to IDLE_FPS once idle. A zoomed VHS case
    // that has finished animating is treated as idle (it's a still image).
    const st = useStore.getState()
    const caseOpenAndSettled = isVHSCaseOpen && !st.vhsCaseAnimating
    const active =
      !caseOpenAndSettled && (
        (performance.now() - getLastRenderActivity()) < ACTIVE_GRACE_MS ||
        st.vhsCaseAnimating ||
        st.tutorialStep != null ||
        st.isInteractingWithLaZone ||
        st.isWatchingLaZone ||
        st.isInteractingWithMinitel ||
        st.isInteractingWithTV
      )
    const interval = active ? ACTIVE_INTERVAL : IDLE_INTERVAL

    // --- Adaptive resolution scaler: DECISION (runs every frame) -----------
    // Reads the render-to-render EMA (fed at render time below) and adjusts the scale.
    if (dprMaxRef.current === 0) dprMaxRef.current = renderer.getPixelRatio()
    const nowDrs = performance.now()
    const applyScale = (s: number) => {
      dprScaleRef.current = s
      setDpr(dprMaxRef.current * s)
      lastDrsAdjustRef.current = nowDrs
      drsSettleUntilRef.current = nowDrs + DRS_SETTLE_MS // skip the RT-realloc spike
      lastRenderTimeRef.current = 0                       // don't measure across the resize
    }
    if (!active) {
      // At rest → full (supersampled) resolution for max sharpness when reading.
      if (dprScaleRef.current < 1 && nowDrs - lastDrsAdjustRef.current > DRS_DROP_COOLDOWN) applyScale(1)
      lastRenderTimeRef.current = 0 // idle gap must not pollute the active EMA
    } else {
      const ema = frameMsEmaRef.current
      const s = dprScaleRef.current
      if (ema > DRS_DROP_MS) {
        // Not holding 60 fps → drop a step, reactively.
        lastSaturationRef.current = nowDrs
        if (s > DRS_MIN_SCALE && nowDrs - lastDrsAdjustRef.current > DRS_DROP_COOLDOWN) {
          applyScale(Math.max(DRS_MIN_SCALE, +(s - DRS_STEP).toFixed(2)))
        }
      } else if (s < 1 && nowDrs - lastSaturationRef.current > DRS_PROBE_MS && nowDrs - lastDrsAdjustRef.current > DRS_RAISE_COOLDOWN) {
        // Saturation-free for a while → probe one step up to recover sharpness.
        applyScale(Math.min(1, +(s + DRS_STEP).toFixed(2)))
      }
    }

    renderAccumRef.current += delta
    if (renderAccumRef.current < interval) return
    // Carry the remainder for an accurate cadence (resetting to 0 drops the
    // overshoot and under-shoots the target rate); clamp so a long stall
    // — tab switch, GC pause — can't unleash a burst of catch-up renders.
    renderAccumRef.current = Math.min(renderAccumRef.current - interval, interval)

    // --- Adaptive resolution scaler: MEASURE (at effective render) ---------
    // Interval between actual renders = true per-frame cost (≈16.7 ms when holding
    // 60 fps, higher when the GPU can't). Skip right after a resize (RT realloc spike).
    if (active) {
      const tRender = performance.now()
      if (lastRenderTimeRef.current > 0 && tRender >= drsSettleUntilRef.current) {
        const ivl = Math.min(tRender - lastRenderTimeRef.current, 100) // clamp tab/GC stalls
        frameMsEmaRef.current = frameMsEmaRef.current * 0.9 + ivl * 0.1
      }
      lastRenderTimeRef.current = tRender
    }

    pp.render()
  }, 1)

  return null
}
