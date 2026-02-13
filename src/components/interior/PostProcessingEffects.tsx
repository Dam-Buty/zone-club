import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

interface PostProcessingEffectsProps {
  isMobile?: boolean
}

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)

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
      // ===== MOBILE PIPELINE: Scene → Bloom → Vignette =====
      // No MRT needed (no GTAO), no FXAA (unnecessary at dpr ≤1.5 on small screens)
      const scenePass = pass(scene, camera)
      const scenePassColor = scenePass.getTextureNode('output')

      // Bloom with slightly reduced strength on mobile
      const bloomPass = bloom(scenePassColor, 0.15, 0.4, 0.9)
      const withBloom = scenePassColor.add(bloomPass)

      const withVignette = applyVignette(withBloom)
      postProcessing.outputNode = withVignette

      console.log('[PostProcessing] Pipeline: Bloom + Vignette (mobile)')
    } else {
      // ===== DESKTOP PIPELINE: Scene MRT → GTAO → Bloom → Vignette → FXAA =====

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

      // 3. Bloom
      const bloomPass = bloom(withAO, 0.19, 0.4, 0.9)
      const withBloom = withAO.add(bloomPass)

      // 4. Vignette
      const withVignette = applyVignette(withBloom)

      // 5. FXAA
      const withFXAA = fxaa(withVignette)
      postProcessing.outputNode = withFXAA

      console.log('[PostProcessing] Pipeline: GTAO(0.5x) + Bloom + Vignette + FXAA + ACES ToneMapping')
    }

    postProcessingRef.current = postProcessing

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
    }
  }, [renderer, scene, camera, isMobile])

  // renderPriority=1 tells R3F to skip its default renderer.render() call
  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render()
    }
  }, 1)

  return null
}
