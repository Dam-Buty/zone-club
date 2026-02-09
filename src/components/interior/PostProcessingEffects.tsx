import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, viewportUV, clamp, float } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

export function PostProcessingEffects() {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)

  useEffect(() => {
    const postProcessing = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)

    // 1. Scene pass avec MRT (Multiple Render Targets) pour normales + depth
    // Nécessaire pour GTAO (Screen-Space Ambient Occlusion)
    const scenePass = pass(scene, camera)
    scenePass.setMRT(mrt({
      output: output,
      normal: normalView,
    }))

    const scenePassColor = scenePass.getTextureNode('output')
    const scenePassNormal = scenePass.getTextureNode('normal')
    const scenePassDepth = scenePass.getTextureNode('depth')

    // 2. GTAO — Ground Truth Ambient Occlusion
    // Ajoute des ombres de contact subtiles dans les coins et entre objets proches.
    // Essentiel pour le photoréalisme d'une scène intérieure.
    const aoPass = ao(scenePassDepth, scenePassNormal, camera)
    aoPass.scale.value = 0.5      // Intensité AO (0.5 = subtil mais visible)
    aoPass.radius.value = 0.25    // Rayon de recherche en world units (~25cm)
    aoPass.thickness.value = 1.0  // Épaisseur des objets pour le calcul d'occlusion
    aoPass.resolutionScale = 0.5  // Demi-résolution: -75% fragments, AO flou par nature

    // Appliquer AO à la couleur de la scène
    // IMPORTANT: GTAO render target est en RedFormat (canal R uniquement).
    // Il faut extraire .x comme scalaire pour broadcast sur RGB, sinon G=0 B=0 → tout rouge.
    const aoTexture = aoPass.getTextureNode()
    const aoValue = aoTexture.x  // scalar float: broadcast R sur RGB
    const withAO = scenePassColor.mul(aoValue)

    // 3. Bloom sur la scène avec AO
    // threshold=0.9: seuls les pixels très lumineux bloom (néons avec emissiveIntensity>=2)
    // strength=0.19: glow subtil (réduit pour éviter le flou)
    // radius=0.4: dispersion douce
    const bloomPass = bloom(withAO, 0.19, 0.4, 0.9)

    // 4. Combiner: scène AO + bloom additif
    const withBloom = withAO.add(bloomPass)

    // 5. Vignette (assombrissement subtil aux bords)
    const dist = viewportUV.sub(float(0.5)).length()
    const vignetteFactor = clamp(
      dist.mul(float(1.2)),
      float(0.0),
      float(1.0),
    ).oneMinus().pow(float(0.4))
    const withVignette = withBloom.mul(vignetteFactor)

    // 6. FXAA — Fast Approximate Anti-Aliasing (last step, after all color processing)
    // ~3% GPU cost for smooth edges on geometry silhouettes and texture boundaries
    const withFXAA = fxaa(withVignette)

    postProcessing.outputNode = withFXAA

    postProcessingRef.current = postProcessing
    console.log('[PostProcessing] Pipeline: GTAO(0.5x) + Bloom + Vignette + FXAA + ACES ToneMapping')

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
