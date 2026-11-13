import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass, viewportUV, clamp, float, uniform } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
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

export function PostProcessingEffects({ isMobile = false }: PostProcessingEffectsProps) {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null)
  // Chaîne « K7 en main » (flou de profondeur) — desktop seulement, construite une fois.
  const postProcessingOpenRef = useRef<THREE.PostProcessing | null>(null)
  const bokehRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomStrengthRef = useRef<ReturnType<typeof uniform> | null>(null)
  const bloomBaseStrength = isMobile ? 0.12 : 0.18
  const isVHSCaseOpen = useStore(state => state.isVHSCaseOpen)

  useEffect(() => {
    const postProcessing = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)
    // La passe de scène, gardée pour le préchauffage (voir __scenePassCompile plus bas).
    let scenePassForWarmup: ReturnType<typeof pass> | null = null

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
      scenePassForWarmup = scenePass
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
      // Scene → Bloom → (DoF, K7 en main seulement) → Vignette → SMAA → sharpen
      //
      // ⚠️ DEUX chaînes, construites UNE fois, qui partagent la passe de scène et le bloom.
      //
      // Avant, le flou de profondeur n'était ajouté que quand une K7 était ouverte, et son
      // déclencheur figurait dans les dépendances de cet effet : toute la chaîne était donc
      // détruite et reconstruite à CHAQUE ouverture et à CHAQUE fermeture de cassette, et ses
      // passes recompilées. Mesuré sur main (three r186, Mac M4, cache chaud), pour les seules
      // passes de post-traitement : 20 pipelines à la première ouverture, 8 aux suivantes, 3 à
      // chaque fermeture. (Le gros des à-coups venait d'ailleurs : les rayonnages recréaient
      // leurs matériaux au même moment — voir useKTX2Textures.)
      //
      // On garde donc les deux graphes en vie et on choisit lequel rendre dans useFrame.

      // 1. Scene pass (no MRT — SSGI disabled)
      const scenePass = pass(scene, camera)
      scenePassForWarmup = scenePass
      const scenePassColor = scenePass.getTextureNode('output')

      // SSGI disabled — too expensive (~3× frame time)
      // TODO: re-enable with lower settings or on high-end GPUs only

      // 2. Bloom — force pilotée par un uniform (ramenée à 0 quand une K7 est ouverte)
      const bloomStrength = uniform(bloomBaseStrength)
      bloomStrengthRef.current = bloomStrength
      const bloomPass = bloom(scenePassColor, 0.32, bloomStrength, 0.70)
      const withBloom = scenePassColor.add(bloomPass)

      // 3. Chaîne normale : Vignette → SMAA → RCAS sharpen
      // SMAA (sharper edge AA than FXAA — less overall blur). Desktop only; mobile
      // keeps FXAA for cost. Then a final RCAS sharpen for crispness, no extra VRAM.
      postProcessing.outputNode = sharpen(smaa(applyVignette(withBloom)), SHARPEN_AMOUNT)

      // 4. Chaîne « K7 en main » : la même, avec le flou de profondeur avant la vignette.
      const scenePassViewZ = scenePass.getViewZNode()
      const bokehScale = uniform(0)
      bokehRef.current = bokehScale
      const withDof = dof(withBloom, scenePassViewZ, 0.4725, 1.0, bokehScale)
      const postProcessingOpen = new THREE.PostProcessing(renderer as unknown as THREE.WebGPURenderer)
      postProcessingOpen.outputNode = sharpen(
        smaa(applyVignette(withDof as unknown as ReturnType<typeof pass>)),
        SHARPEN_AMOUNT,
      )
      postProcessingOpenRef.current = postProcessingOpen
    }

    postProcessingRef.current = postProcessing
    // Exposé pour le préchauffage (InteriorScene), qui compile d'abord toute la scène en
    // asynchrone (voir __scenePassCompile ci-dessous), puis appelle `render()` en boucle, tous
    // meshes forcés visibles, jusqu'au plateau des pipelines.
    //
    // ⚠️ Tant que la scène n'est pas préchauffée, un appel sur deux rend la chaîne « K7 en main ».
    // Les matériaux de la scène ont besoin de leurs propres pipelines quand ils sont rendus à
    // travers elle : sans ça, la première ouverture de cassette en compilait une vingtaine en
    // pleine boucle de rendu (mesuré : 21 pipelines, ~460 ms à chaud, ~2 s à froid, à l'étape 2
    // de la visite guidée). La chaîne doit être rendue sur la scène COMPLÈTE : la rendre sur
    // les premières images, scène encore vide, ne compile que ses propres passes.
    // Le critère est `interiorWarm`, pas `isSceneReady` : devant la devanture `isSceneReady`
    // est déjà vrai alors que la scène, montée cachée, n'a encore rien compilé.
    let warmCalls = 0
    const exposed = {
      renderer: postProcessing.renderer,
      render: () => {
        const open = postProcessingOpenRef.current
        if (open && !useStore.getState().interiorWarm && warmCalls++ % 2 === 1) {
          open.render()
        } else {
          postProcessing.render()
        }
      },
    }
    ;(window as unknown as { __postProcessing?: typeof exposed }).__postProcessing = exposed
    // Compilation ASYNCHRONE de tous les pipelines de la scène, dans le contexte exact de la passe
    // (cible HalfFloat) : `PassNode.compileAsync` existe pour ça depuis three r187. Les pipelines
    // sont créés par `createRenderPipelineAsync`, donc compilés en parallèle par le processus GPU,
    // au lieu d'être créés un par un en synchrone par le premier rendu. Mesuré en rejouant les
    // 105 pipelines de l'entrée, cache de shaders froid : 5 090 ms en parallèle contre 13 939 ms.
    const passForWarmup = scenePassForWarmup as unknown as { compileAsync?: (r: unknown) => Promise<void> } | null
    ;(window as unknown as { __scenePassCompile?: (() => Promise<void>) | null }).__scenePassCompile =
      passForWarmup && typeof passForWarmup.compileAsync === 'function'
        ? () => passForWarmup.compileAsync!(renderer)
        : null

    // Même chose pour UN objet à la fois, dans le même contexte que la passe : c'est ce qui
    // permet au préchauffage de compiler par petits lots pendant que le visiteur est devant la
    // devanture, sans accaparer le processus GPU. Reprend ce que fait `PassNode.compileAsync`
    // (cible, MRT, nœud de contexte), avec `renderer.compileAsync(objet, caméra, scène)`.
    // Ces membres sont internes à three : s'ils changent de nom, on rend null et le
    // préchauffage retombe sur la compilation d'un bloc.
    const passInternals = scenePassForWarmup as unknown as {
      renderTarget?: { samples: number }
      options?: { samples?: number }
      setSize?: (w: number, h: number) => void
      _mrt?: unknown
      contextNode?: unknown
      _getContextNode?: (r: unknown) => unknown
    } | null
    const rendererInternals = renderer as unknown as {
      samples: number
      contextNode: unknown
      getRenderTarget: () => unknown
      setRenderTarget: (t: unknown) => void
      getMRT: () => unknown
      setMRT: (m: unknown) => void
      getDrawingBufferSize: (v: THREE.Vector2) => THREE.Vector2
      compileAsync: (object: THREE.Object3D, camera: THREE.Camera, targetScene: THREE.Scene) => Promise<void>
    }
    const canCompileObject = !!passInternals && !!passInternals.renderTarget && typeof passInternals.setSize === 'function'
      && typeof rendererInternals.getMRT === 'function' && typeof rendererInternals.setMRT === 'function'
    const drawingBufferSize = new THREE.Vector2()
    ;(window as unknown as { __scenePassCompileObject?: ((o: THREE.Object3D) => Promise<void>) | null }).__scenePassCompileObject =
      canCompileObject
        ? async (object: THREE.Object3D) => {
            const pass = passInternals!
            const previousTarget = rendererInternals.getRenderTarget()
            const previousMRT = rendererInternals.getMRT()
            const previousContext = rendererInternals.contextNode
            pass.renderTarget!.samples = pass.options?.samples === undefined ? rendererInternals.samples : pass.options.samples
            rendererInternals.getDrawingBufferSize(drawingBufferSize)
            pass.setSize!(drawingBufferSize.width, drawingBufferSize.height)
            rendererInternals.setRenderTarget(pass.renderTarget)
            rendererInternals.setMRT(pass._mrt ?? null)
            if (pass.contextNode != null && typeof pass._getContextNode === 'function') {
              rendererInternals.contextNode = pass._getContextNode(renderer)
            }
            try {
              await rendererInternals.compileAsync(object, camera, scene)
            } finally {
              rendererInternals.setRenderTarget(previousTarget)
              rendererInternals.setMRT(previousMRT)
              rendererInternals.contextNode = previousContext
            }
          }
        : null

    return () => {
      postProcessing.dispose()
      postProcessingOpenRef.current?.dispose()
      postProcessingOpenRef.current = null
      postProcessingRef.current = null
      bokehRef.current = null
      bloomStrengthRef.current = null
      ;(window as unknown as { __postProcessing?: unknown }).__postProcessing = null
      ;(window as unknown as { __scenePassCompile?: (() => Promise<void>) | null }).__scenePassCompile = null
      ;(window as unknown as { __scenePassCompileObject?: unknown }).__scenePassCompileObject = null
    }
    // `bloomBaseStrength` ne dépend que de `isMobile`. L'état « K7 ouverte » n'est PAS une
    // dépendance : il ne fait que choisir la chaîne à rendre (voir useFrame).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, scene, camera, isMobile])

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

    // Tant que la scène n'est pas préchauffée, l'écran de chargement (ou la devanture) couvre
    // le canevas : on ne rend rien. Chaque image rendue ici compilait EN SYNCHRONE les matériaux
    // qui venaient d'être montés (83 pipelines à la file en production), ce qui affamait aussi
    // le chargement des jaquettes, cadencé par image. Le préchauffage (InteriorScene) compile
    // tout d'un coup en asynchrone, puis rend lui-même ses images de contrôle par
    // `__postProcessing.render()`.
    // Et une scène préchauffée mais encore cachée derrière la devanture ne se rend pas non
    // plus : le GPU reste à la vitrine.
    const scene0 = useStore.getState()
    if (!scene0.interiorWarm || scene0.currentScene !== 'interior') return

    // Lerp the post uniforms every tick (cheap; keeps transitions smooth even when
    // the render itself is throttled, since transitions force the ACTIVE budget below).
    if (bokehRef.current) {
      if (isVHSCaseOpen) {
        const target = 4.0
        bokehRef.current.value += (target - bokehRef.current.value) * Math.min(delta * 8, 1)
      } else {
        // L'uniform survit désormais d'une ouverture à l'autre : on le remet à zéro à la
        // fermeture pour que le flou reparte de rien à la prochaine cassette.
        bokehRef.current.value = 0
      }
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

    const ppOpen = postProcessingOpenRef.current
    if (isVHSCaseOpen && ppOpen) {
      ppOpen.render()
    } else {
      pp.render()
    }
  }, 1)

  return null
}
