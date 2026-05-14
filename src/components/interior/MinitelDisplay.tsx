import { useMemo, useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useMinitelScreenTexture } from './MinitelScreen'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

useGLTF.preload('/models/minitel_1982-france.glb', true)

interface MinitelDisplayProps {
  position: [number, number, number]
  scale?: number | [number, number, number]
  rotation?: [number, number, number]
}

// Object_73 carries DSC_0167 — the baked photo of the CRT screen face.
// Confirmed via 5-point raycast across the visible screen rectangle: all hits
// land on this mesh. We replace its material with our canvas-driven UI.
const SCREEN_MESH_MATERIAL_NAME = 'DSC_0167'

export function MinitelDisplay({ position, scale = 0.025, rotation = [0, Math.PI, 0] }: MinitelDisplayProps) {
  const { scene } = useGLTF('/models/minitel_1982-france.glb', true)
  const { texture: screenTexture, hitboxesRef, screenWidth, screenHeight } = useMinitelScreenTexture()

  // Expose hitboxes + screen dims globally so Controls.tsx's raycast handler
  // can resolve a click on the screen mesh to an item index without needing
  // its own event subscription.
  useEffect(() => {
    ;(window as unknown as {
      __minitelHitboxes?: {
        getHitboxes: () => Array<{ index: number; yStart: number; yEnd: number; xStart?: number; xEnd?: number }>
        screenWidth: number
        screenHeight: number
        textureOffsetX: number
        textureOffsetY: number
      }
    }).__minitelHitboxes = {
      getHitboxes: () => hitboxesRef.current,
      screenWidth,
      screenHeight,
      textureOffsetX: screenTexture.offset.x,
      textureOffsetY: screenTexture.offset.y,
    }
    return () => {
      ;(window as unknown as { __minitelHitboxes?: unknown }).__minitelHitboxes = undefined
    }
  }, [hitboxesRef, screenWidth, screenHeight, screenTexture])

  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = false
      child.receiveShadow = true
      child.layers.enable(RAYCAST_LAYER_INTERACTIVE)
      child.userData.isMinitel = true
    })
    return cloned
  }, [scene])

  // Reuse the live CanvasTexture directly (cloning would prevent it from
  // receiving needsUpdate signals from the canvas re-renders).
  // offset.x = -0.15: pushes the canvas content ~15% to the right on the mesh
  // so the left margin no longer bleeds off the visible CRT face.
  useEffect(() => {
    screenTexture.offset.set(-0.15, 0.10)
    screenTexture.flipY = true
    screenTexture.colorSpace = THREE.SRGBColorSpace
  }, [screenTexture])

  const screenMaterial = useMemo(() => {
    // FrontSide so the raycaster ignores the inner faces of the CRT envelope —
    // Object_73 in the GLB wraps around the whole tube and uses the same UV
    // unwrap on the back, which leaked clicks into wrong hitboxes.
    return new THREE.MeshBasicMaterial({
      map: screenTexture,
      toneMapped: false,
      side: THREE.FrontSide,
    })
  }, [screenTexture])

  useEffect(() => {
    const restoreList: Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }> = []
    // Several meshes in the GLB share the DSC_0167 material (bezel + true CRT face).
    // We must only tag the actual CRT face — others (keyboard, plastic) would
    // accept raycaster hits and compute garbage UV → wrong hitbox matches.
    // Strategy: gather all matches, then pick the largest by bounding-box area.
    const candidates: THREE.Mesh[] = []
    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mat = child.material
      const matchByName = (m: THREE.Material) => m.name === SCREEN_MESH_MATERIAL_NAME
      const isMatch = Array.isArray(mat) ? mat.some(matchByName) : (mat ? matchByName(mat) : false)
      if (!isMatch) return
      candidates.push(child)
    })
    let screenMesh: THREE.Mesh | null = null
    let bestArea = -1
    for (const c of candidates) {
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox()
      const bb = c.geometry.boundingBox
      if (!bb) continue
      const size = new THREE.Vector3()
      bb.getSize(size)
      // CRT face is mostly flat — its 2 biggest dims define its area.
      const dims = [size.x, size.y, size.z].sort((a, b) => b - a)
      const area = dims[0] * dims[1]
      if (area > bestArea) { bestArea = area; screenMesh = c }
    }
    if (screenMesh) {
      const mesh = screenMesh as THREE.Mesh
      restoreList.push({ mesh, original: mesh.material })
      mesh.material = screenMaterial
      mesh.userData.isMinitelScreen = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__minitelScreenMesh = mesh
    }

    // Compute the screen face center + normal in WORLD coords on the next
    // frame (after parent transforms applied). Publish to window so Controls
    // can use it for face-on camera placement instead of guessed constants.
    if (screenMesh) {
      const id = requestAnimationFrame(() => {
        const mesh = screenMesh as THREE.Mesh
        mesh.updateWorldMatrix(true, false)

        // Compute world-space center from bounding box
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
        const localCenter = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3())
        const worldCenter = localCenter.clone().applyMatrix4(mesh.matrixWorld)

        // Compute world-space normal from the first triangle of the geometry.
        // Using attribute.normal[0] would only give a local normal; we need to
        // transform it via the normalMatrix. Even simpler: pick 3 vertices,
        // build two edges, cross-product, transform.
        const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
        let worldNormal = new THREE.Vector3(0, 0, 1)
        if (posAttr && posAttr.count >= 3) {
          const indexAttr = mesh.geometry.index
          const i0 = indexAttr ? indexAttr.getX(0) : 0
          const i1 = indexAttr ? indexAttr.getX(1) : 1
          const i2 = indexAttr ? indexAttr.getX(2) : 2
          const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0)
          const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1)
          const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2)
          const e1 = v1.clone().sub(v0)
          const e2 = v2.clone().sub(v0)
          const localNormal = e1.cross(e2).normalize()
          // Transform to world (apply rotation only, not translation)
          const worldNormal4 = localNormal.clone().transformDirection(mesh.matrixWorld)
          worldNormal = worldNormal4.normalize()
        }

        ;(window as unknown as { __minitelScreenInfo?: { center: THREE.Vector3; normal: THREE.Vector3 } })
          .__minitelScreenInfo = { center: worldCenter, normal: worldNormal }
      })
      return () => {
        cancelAnimationFrame(id)
        for (const { mesh, original } of restoreList) {
          mesh.material = original
          mesh.userData.isMinitelScreen = false
        }
        ;(window as unknown as { __minitelScreenInfo?: unknown }).__minitelScreenInfo = undefined
      }
    }

    return () => {
      for (const { mesh, original } of restoreList) {
        mesh.material = original
        mesh.userData.isMinitelScreen = false
      }
    }
  }, [clonedScene, screenMaterial])

  useEffect(() => {
    return () => {
      // Don't dispose the texture — it's owned by useMinitelScreenTexture.
      screenMaterial.dispose()
    }
  }, [screenMaterial])

  // Controls.tsx owns the DOM click → minitel hitbox raycast. We deliberately
  // do NOT bind onPointerDown here, otherwise every click would dispatch twice
  // (once from R3F's raycaster and once from Controls), which compounds in
  // handlers like RETOUR (sommaire → idle in a single tap).
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  )
}
