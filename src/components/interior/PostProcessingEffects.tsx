import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float, time, vec2, fract, sin, dot, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { useStore } from '../../store'

interface PostProcessingEffectsProps {
  isMobile?: boolean
}

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)
  // DoF bokeh scale uniform — 0 = no blur, >0 = active (smooth lerp in useFrame)
  const bokehRef = useRef<{ value: number }>({ value: 0 })
  // Subscribe to VHS case state — triggers pipeline rebuild with/without DoF (desktop only)
  // PostProcessingEffects returns null so re-renders are free (no scene graph changes)
  const isVHSCaseOpen = useStore(state => state.isVHSCaseOpen)
  // Mobile pipeline has no DoF — don't rebuild pipeline on case open/close
  const dofTrigger = isMobile ? false : isVHSCaseOpen

  useEffect(() => {
    const postProcessing = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)

    // Vignette — shared between mobile and desktop
    const applyVignette = (input: ReturnType<typeof pass>) => {
      const dist = viewportUV.sub(float(0.5)).length()
      const vignetteFactor = clamp(
        dist.mul(float(1.2)),
        float(0.0),
        float(1.0),
      ).oneMinus().pow(float(0.4))
      return input.mul(vignetteFactor)
    }

    if (isMobile) {
      // ===== MOBILE PIPELINE: Scene → Vignette =====
      // No MRT, no GTAO, no Bloom, no FXAA — maximum perf on mobile GPU
      const scenePass = pass(scene, camera)
      const scenePassColor = scenePass.getTextureNode('output')

      const withVignette = applyVignette(scenePassColor)
      postProcessing.outputNode = withVignette

      console.log('[PostProcessing] Pipeline: Vignette only (mobile)')
    } else {
      // ===== DESKTOP PIPELINE =====
      // Without DoF: Scene MRT → GTAO(0.5x) → Bloom → CA → Vignette → FXAA → Film Grain
      // With DoF:    Scene MRT → GTAO(0.5x) → Bloom → CA → DoF → Vignette → FXAA → Film Grain
      // DoF is only included when VHS case is open (5 extra passes → 0 cost when closed)

      // 1. Scene pass avec MRT (Multiple Render Targets) pour normales + depth
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({
        output: output,
        normal: normalView,
      }))

      const scenePassColor = scenePass.getTextureNode('output')
      const scenePassNormal = scenePass.getTextureNode('normal')
      const scenePassDepth = scenePass.getTextureNode('depth')

      // 2. GTAO — Ground Truth Ambient Occlusion
      const aoPass = ao(scenePassDepth, scenePassNormal, camera)
      aoPass.scale.value = 0.5
      aoPass.radius.value = 0.25
      aoPass.thickness.value = 1.0
      aoPass.resolutionScale = 0.5

      // GTAO RenderTarget is RedFormat — extract .x as scalar to broadcast across RGB
      const aoTexture = aoPass.getTextureNode()
      const aoValue = aoTexture.x
      const withAO = scenePassColor.mul(aoValue)

      // 3. Bloom — skip entirely when VHS case is open (no neons visible, avoids white text blowout)
      const bloomPass = isVHSCaseOpen ? null : bloom(withAO, 0.19, 0.4, 0.9)
      const withBloom = bloomPass ? withAO.add(bloomPass) : withAO

      // 4. Conditional DoF — only when VHS case viewer is open
      // Pipeline is rebuilt when isVHSCaseOpen changes (useEffect dep)
      // This avoids the 5-pass DoF cost (~23 FPS) when not needed
      let postBloom = withBloom

      if (isVHSCaseOpen) {
        // CRITICAL: dof() expects viewZ (negative view-space Z), NOT raw depth [0,1]
        // getViewZNode() converts depth buffer → linearized viewZ via perspectiveDepthToViewZ()
        const scenePassViewZ = scenePass.getViewZNode()
        // Focus at 0.4725m = exact DISTANCE_FROM_CAMERA in VHSCaseViewer
        // focalLength 1.0 = objects >1m from focus go fully out-of-focus
        //   → entire case stays sharp during rotation (spine swings ±10cm max)
        //   → background shelves (2m+) still fully blurred
        const bokehScale = uniform(0)
        bokehRef.current = bokehScale
        postBloom = dof(withBloom, scenePassViewZ, 0.4725, 1.0, bokehScale)
      }

      // 5. Vignette
      const withVignette = applyVignette(postBloom)

      // 6. FXAA (smooths geometry aliasing)
      const withFXAA = fxaa(withVignette)

      // 8. Film Grain — very subtle analog texture, animated per frame
      const grainUV = viewportUV.add(time.mul(float(0.17)))
      const grain = fract(sin(dot(grainUV, vec2(12.9898, 78.233))).mul(float(43758.5453)))
        .sub(float(0.5)).mul(float(0.016))
      const withGrain = withFXAA.add(grain)

      postProcessing.outputNode = withGrain

      if (isVHSCaseOpen) {
        console.log('[PostProcessing] Pipeline: GTAO + DoF(0.4725m) + Vignette + FXAA + Film Grain (no bloom)')
      } else {
        console.log('[PostProcessing] Pipeline: GTAO + Bloom + Vignette + FXAA + Film Grain')
      }
    }

    postProcessingRef.current = postProcessing

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
    }
  }, [renderer, scene, camera, isMobile, dofTrigger])

  // Frame throttling when VHS case is open and idle (no animation/interaction)
  // Renders at ~15 FPS instead of 120 → saves ~87% GPU work on static scene
  const frameSkipRef = useRef(0)

  // renderPriority=1 tells R3F to skip its default renderer.render() call
  useFrame((_, delta) => {
    if (postProcessingRef.current) {
      // Smooth DoF ramp-up when case is open (bokehScale: 0 → 4 over ~0.2s)
      if (isVHSCaseOpen && bokehRef.current) {
        const target = 4.0
        const current = bokehRef.current.value
        bokehRef.current.value += (target - current) * Math.min(delta * 8, 1)
      }

      // Throttle rendering when VHS case is open and idle
      // Skip 7 out of 8 frames → ~15 FPS effective (plenty for static scene)
      if (isVHSCaseOpen) {
        const { vhsCaseAnimating } = useStore.getState()
        if (!vhsCaseAnimating) {
          frameSkipRef.current++
          if (frameSkipRef.current % 8 !== 0) return
        } else {
          frameSkipRef.current = 0 // reset counter when animating
        }
      }

      postProcessingRef.current.render()
    }
  }, 1)

  return null
}
