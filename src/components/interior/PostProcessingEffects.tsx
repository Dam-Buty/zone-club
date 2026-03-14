import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { useStore } from '../../store'

interface PostProcessingEffectsProps {
  isMobile?: boolean
}

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)
  const bokehRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomStrengthRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomBaseStrength = 0.18
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
      // ===== MOBILE PIPELINE: Scene → Vignette → FXAA =====
      const scenePass = pass(scene, camera)
      const scenePassColor = scenePass.getTextureNode('output')

      const withVignette = applyVignette(scenePassColor)
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

      // 5. Vignette + final FXAA
      const withVignette = applyVignette(postBloom)
      const withFXAA = fxaa(withVignette)
      postProcessing.outputNode = withFXAA
    }

    postProcessingRef.current = postProcessing

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
      bokehRef.current = null
      bloomStrengthRef.current = null
    }
  }, [renderer, scene, camera, isMobile, dofTrigger])

  const frameSkipRef = useRef(0)

  useFrame((_, delta) => {
    if (document.hidden) return

    if (postProcessingRef.current) {
      if (isVHSCaseOpen && bokehRef.current) {
        const target = 4.0
        const current = bokehRef.current.value
        bokehRef.current.value += (target - current) * Math.min(delta * 8, 1)
      }

      if (bloomStrengthRef.current) {
        const bloomTarget = isVHSCaseOpen ? 0.0 : bloomBaseStrength
        const currentBloom = bloomStrengthRef.current.value
        bloomStrengthRef.current.value += (bloomTarget - currentBloom) * Math.min(delta * 8, 1)
      }

      if (isVHSCaseOpen) {
        const { vhsCaseAnimating } = useStore.getState()
        if (!vhsCaseAnimating) {
          frameSkipRef.current++
          if (frameSkipRef.current % 8 !== 0) return
        } else {
          frameSkipRef.current = 0
        }
      }

      postProcessingRef.current.render()
    }
  }, 1)

  return null
}
