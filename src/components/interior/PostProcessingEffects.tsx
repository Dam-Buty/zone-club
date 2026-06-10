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
// (Testé 0.8 le 10/06 contre le grain des murs : RCAS innocenté — mesures identiques à 0.4.)
const SHARPEN_AMOUNT = 0.4

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
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
  const isTerminalOpen = useStore(state => state.isTerminalOpen)
  const isPlayerOpen = useStore(state => state.isPlayerOpen)

  // Install the global activity listeners once (idempotent).
  useEffect(() => {
    installRenderActivityListeners()
  }, [])

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

    renderAccumRef.current += delta
    if (renderAccumRef.current < interval) return
    // Carry the remainder for an accurate cadence (resetting to 0 drops the
    // overshoot and under-shoots the target rate); clamp so a long stall
    // — tab switch, GC pause — can't unleash a burst of catch-up renders.
    renderAccumRef.current = Math.min(renderAccumRef.current - interval, interval)

    pp.render()
  }, 1)

  return null
}
