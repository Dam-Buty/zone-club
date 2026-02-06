import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, viewportUV, clamp, float } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'

export function PostProcessingEffects() {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)

  useEffect(() => {
    const postProcessing = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)

    // 1. Simple scene pass (no MRT - avoid potential WebGPU MRT issues)
    const scenePass = pass(scene, camera)
    const scenePassColor = scenePass.getTextureNode('output')

    // 2. Bloom on full scene output based on luminance threshold
    // threshold=0.9: only very bright pixels bloom (neons with toneMapped=false + emissiveIntensity>=2)
    // strength=0.22: subtle glow (reduced -30% to avoid blurry look)
    // radius=0.4: soft spread
    const bloomPass = bloom(scenePassColor, 0.19, 0.4, 0.9)

    // 3. Combine: scene + additive bloom
    const withBloom = scenePassColor.add(bloomPass)

    // 4. Vignette (subtle darkening at edges)
    const dist = viewportUV.sub(float(0.5)).length()
    const vignetteFactor = clamp(
      dist.mul(float(1.2)),
      float(0.0),
      float(1.0),
    ).oneMinus().pow(float(0.4))
    const final = withBloom.mul(vignetteFactor)

    postProcessing.outputNode = final

    postProcessingRef.current = postProcessing
    console.log('[PostProcessing] Pipeline initialized: Bloom + Vignette + ACES ToneMapping')

    return () => {
      postProcessing.dispose()
      postProcessingRef.current = null
    }
  }, [renderer, scene, camera])

  // renderPriority=1 tells R3F to skip its default renderer.render() call
  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render()
    }
  }, 1)

  return null
}
