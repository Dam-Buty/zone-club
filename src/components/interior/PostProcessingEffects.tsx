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

      // 1. Scene pass avec MRT
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({
        output: output,
        normal: normalView,
      }))

      const scenePassColor = scenePass.getTextureNode('output')
      const scenePassNormal = scenePass.getTextureNode('normal')
      const scenePassDepth = scenePass.getTextureNode('depth')

      // 2. SSGI — temporal filtering for multi-frame accumulation (cleaner than spatial denoise)
      const ssgiPass = ssgi(scenePassColor, scenePassDepth, scenePassNormal, camera)
      ssgiPass.radius.value = 1.8
      ssgiPass.giIntensity.value = 0.9
      ssgiPass.aoIntensity.value = 0.45
      ssgiPass.sliceCount.value = 2
      ssgiPass.stepCount.value = 8
      ssgiPass.thickness.value = 1.5
      ssgiPass.useTemporalFiltering = true

      const ssgiTexture = ssgiPass.getTextureNode()
      const withSSGI = scenePassColor.mul(ssgiTexture.a).add(ssgiTexture.rgb)

      // 3. Bloom — tighter threshold so ceiling bounce stays clean around emissive signs
      const bloomStrength = uniform(isVHSCaseOpen ? 0.0 : bloomBaseStrength)
      bloomStrengthRef.current = bloomStrength
      const bloomPass = bloom(withSSGI, 0.32, bloomStrength, 0.70)
      const withBloom = withSSGI.add(bloomPass)

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
