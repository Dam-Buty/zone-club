import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float, vec2, fract, sin, dot, uniform } from 'three/tsl'
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
  const bokehRef = useRef<ReturnType<typeof uniform> | null>(null)
  // Bloom strength uniform — 0.55 normal, 0 when VHS case open
  const bloomStrengthRef = useRef<ReturnType<typeof uniform> | null>(null)
  // Subscribe to VHS case state — DoF requires pipeline rebuild (can't use uniform-only)
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
      // Bloom: uniform-controlled (no rebuild on toggle — strength lerps to 0 when VHS case open)
      // DoF: conditional rebuild (dof() with bokehScale=0 still blurs via texture sampling)

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

      // 3. Bloom — always in pipeline, controlled via bloomStrength uniform
      // No rebuild needed: strength lerps 0.55 ↔ 0 (avoids white text blowout when VHS case open)
      const bloomStrength = uniform(isVHSCaseOpen ? 0.0 : 0.55)
      bloomStrengthRef.current = bloomStrength
      const bloomPass = bloom(withAO, 0.14, bloomStrength, 0.9)
      const withBloom = withAO.add(bloomPass)

      // 4. Conditional DoF — only when VHS case viewer is open
      // dof() with bokehScale=0 still introduces blur via texture sampling, so it must be excluded
      let postBloom = withBloom

      if (isVHSCaseOpen) {
        // CRITICAL: dof() expects viewZ (negative view-space Z), NOT raw depth [0,1]
        const scenePassViewZ = scenePass.getViewZNode()
        // Focus at 0.4725m = exact DISTANCE_FROM_CAMERA in VHSCaseViewer
        const bokehScale = uniform(0)
        bokehRef.current = bokehScale
        postBloom = dof(withBloom, scenePassViewZ, 0.4725, 1.0, bokehScale)
      }

      // 5. Vignette
      const withVignette = applyVignette(postBloom)

      // 6. FXAA (smooths geometry aliasing)
      const withFXAA = fxaa(withVignette)

      // 7. Film Grain — very subtle static analog texture
      const grain = fract(sin(dot(viewportUV, vec2(12.9898, 78.233))).mul(float(43758.5453)))
        .sub(float(0.5)).mul(float(0.0144))
      const withGrain = withFXAA.add(grain)

      postProcessing.outputNode = withGrain

      if (isVHSCaseOpen) {
        console.log('[PostProcessing] Pipeline: GTAO + Bloom(0) + DoF(0.4725m) + Vignette + FXAA + Film Grain')
      } else {
        console.log('[PostProcessing] Pipeline: GTAO + Bloom(uniform) + Vignette + FXAA + Film Grain')
      }
    }

    postProcessingRef.current = postProcessing

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
      bokehRef.current = null
      bloomStrengthRef.current = null
    }
  }, [renderer, scene, camera, isMobile, dofTrigger])

  // Frame throttling when VHS case is open and idle (no animation/interaction)
  // Renders at ~15 FPS instead of 120 → saves ~87% GPU work on static scene
  const frameSkipRef = useRef(0)

  // renderPriority=1 tells R3F to skip its default renderer.render() call
  useFrame((_, delta) => {
    // Tab visibility pause — save 100% GPU when tab is hidden
    if (document.hidden) return

    if (postProcessingRef.current) {
      // Smooth DoF ramp-up when case is open (bokehScale: 0 → 4 over ~0.2s)
      if (isVHSCaseOpen && bokehRef.current) {
        const target = 4.0
        const current = bokehRef.current.value
        bokehRef.current.value += (target - current) * Math.min(delta * 8, 1)
      }

      // Smooth bloom ramp: 0.55 normal, 0 when VHS case open (avoids white text blowout)
      if (bloomStrengthRef.current) {
        const bloomTarget = isVHSCaseOpen ? 0.0 : 0.55
        const currentBloom = bloomStrengthRef.current.value
        bloomStrengthRef.current.value += (bloomTarget - currentBloom) * Math.min(delta * 8, 1)
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
