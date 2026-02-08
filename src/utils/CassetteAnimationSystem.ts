import * as THREE from 'three'
import { useStore } from '../store'

/**
 * Système d'animation centralisé pour toutes les cassettes VHS.
 * Au lieu de 521 callbacks useFrame individuels (un par cassette),
 * un seul callback itère un registry partagé.
 *
 * Économise ~520 appels de fonction R3F + 520 souscriptions Zustand par frame.
 */

export interface CassetteAnimEntry {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  baseZ: number
  hoverOffsetZ: number
  cassetteKey: string
  filmId: number
  // État d'animation par cassette
  stableTargeted: boolean
  targetedTimer: number
  smoothTargeted: number
  currentEmissive: THREE.Color
}

// Registry global des cassettes (clé = cassetteKey)
const registry = new Map<string, CassetteAnimEntry>()

export function registerCassette(key: string, entry: CassetteAnimEntry): void {
  registry.set(key, entry)
}

export function unregisterCassette(key: string): void {
  registry.delete(key)
}

// Constantes d'animation (identiques à l'ancien Cassette.tsx)
const HYSTERESIS_SELECT = 0.05
const HYSTERESIS_DESELECT = 0.25
const ANIMATION_THROTTLE = 2
const EMISSIVE_NONE = new THREE.Color('#000000')
const EMISSIVE_TARGETED = new THREE.Color('#ff2d95')
const EMISSIVE_RENTED = new THREE.Color('#00ff00')

// Objets réutilisables (évite allocations par frame)
const frustum = new THREE.Frustum()
const projScreenMatrix = new THREE.Matrix4()
const tempWorldPos = new THREE.Vector3()

let globalFrameCount = 0
let lastFrustumFrame = -1

/**
 * Fonction d'animation appelée une seule fois par frame depuis CassetteAnimationLoop.
 * Itère toutes les cassettes enregistrées.
 */
export function animateAllCassettes(camera: THREE.Camera, delta: number): void {
  if (registry.size === 0) return

  // Incrémenter le compteur global
  const currentFrame = Math.floor(performance.now() / 16.67)
  if (currentFrame !== globalFrameCount) {
    globalFrameCount = currentFrame
  }

  // Skip animation tous les N frames
  if (globalFrameCount % ANIMATION_THROTTLE !== 0) return

  // Frustum culling — une seule fois par frame
  if (lastFrustumFrame !== globalFrameCount) {
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projScreenMatrix)
    lastFrustumFrame = globalFrameCount
  }

  // Lire le store une seule fois (au lieu de 521 souscriptions)
  const state = useStore.getState()
  const targetedCassetteKey = state.targetedCassetteKey
  const getRental = state.getRental

  // Itérer toutes les cassettes enregistrées
  for (const entry of registry.values()) {
    const { mesh, material } = entry
    if (!mesh || !material) continue

    // Frustum culling
    mesh.getWorldPosition(tempWorldPos)
    if (!frustum.containsPoint(tempWorldPos)) continue

    // Hystérésis asymétrique
    const isTargetedRaw = targetedCassetteKey === entry.cassetteKey
    const isRented = !!getRental(entry.filmId)

    if (isTargetedRaw !== entry.stableTargeted) {
      entry.targetedTimer += delta
      const delay = isTargetedRaw ? HYSTERESIS_SELECT : HYSTERESIS_DESELECT
      if (entry.targetedTimer >= delay) {
        entry.stableTargeted = isTargetedRaw
        entry.targetedTimer = 0
      }
    } else {
      entry.targetedTimer = 0
    }

    const isTargeted = entry.stableTargeted

    // Lissage position Z (hover)
    const targetZ = isTargeted ? entry.baseZ + entry.hoverOffsetZ : entry.baseZ
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, targetZ, delta * 12)

    // Lissage état ciblé
    const targetValue = isTargeted ? 1 : 0
    entry.smoothTargeted = THREE.MathUtils.lerp(entry.smoothTargeted, targetValue, delta * 8)

    // Interpoler couleur émissive
    const targetColor = isRented ? EMISSIVE_RENTED : (entry.smoothTargeted > 0.1 ? EMISSIVE_TARGETED : EMISSIVE_NONE)
    entry.currentEmissive.lerp(targetColor, delta * 10)
    material.emissive.copy(entry.currentEmissive)

    // Interpoler intensité émissive
    const targetIntensity = isRented ? 0.3 : entry.smoothTargeted * 0.4
    material.emissiveIntensity = THREE.MathUtils.lerp(
      material.emissiveIntensity,
      targetIntensity,
      delta * 10
    )
  }
}
