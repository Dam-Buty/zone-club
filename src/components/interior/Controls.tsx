import { useRef, useEffect, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { PointerLockControls as PointerLockControlsImpl } from 'three/addons/controls/PointerLockControls.js'
import * as THREE from 'three'
import { useStore } from '../../store'

interface ControlsProps {
  onCassetteClick?: (filmId: number) => void
}

// Dimensions de la pièce
const ROOM_WIDTH = 11
const ROOM_DEPTH = 8.5

// Marge de collision (7% de distance minimum)
const COLLISION_MARGIN = 0.07

// Définir les zones de collision (AABB: minX, maxX, minZ, maxZ)
// Chaque zone représente un objet solide dans le magasin
const COLLISION_ZONES: { minX: number; maxX: number; minZ: number; maxZ: number; name: string }[] = [
  // Comptoir manager (position: [ROOM_WIDTH/2 - 2.3, 0, ROOM_DEPTH/2 - 1.5], size: 3x0.6)
  { minX: ROOM_WIDTH / 2 - 2.3 - 1.5 - 0.3, maxX: ROOM_WIDTH / 2 - 2.3 + 1.5 + 0.3, minZ: ROOM_DEPTH / 2 - 1.5 - 0.5, maxZ: ROOM_DEPTH / 2 - 1.5 + 0.5, name: 'comptoir' },

  // Îlot central (position: [-0.8, 0, 0]) - zone réduite de 40%
  { minX: -0.8 - 0.756, maxX: -0.8 + 0.756, minZ: -1.134, maxZ: 1.134, name: 'ilot' },

  // TV Display (position: [ROOM_WIDTH/2 - 0.5, 0, 1.2])
  { minX: ROOM_WIDTH / 2 - 1.2, maxX: ROOM_WIDTH / 2, minZ: 0.5, maxZ: 2.5, name: 'tv' },

  // Étagères mur gauche (x = -ROOM_WIDTH/2 + 0.4)
  { minX: -ROOM_WIDTH / 2, maxX: -ROOM_WIDTH / 2 + 0.8, minZ: -ROOM_DEPTH / 2, maxZ: ROOM_DEPTH / 2, name: 'etagere-gauche' },

  // Étagères mur du fond (z = -ROOM_DEPTH/2 + 0.4)
  { minX: -ROOM_WIDTH / 2, maxX: ROOM_WIDTH / 2 - 1.5, minZ: -ROOM_DEPTH / 2, maxZ: -ROOM_DEPTH / 2 + 0.8, name: 'etagere-fond' },

  // Étagères mur droit partie nord (x = ROOM_WIDTH/2 - 0.4, z = -1.5)
  { minX: ROOM_WIDTH / 2 - 0.8, maxX: ROOM_WIDTH / 2, minZ: -ROOM_DEPTH / 2, maxZ: 0.5, name: 'etagere-droite-nord' },

  // Section Games (position: [ROOM_WIDTH/2 - 0.4, 0, 2.2])
  { minX: ROOM_WIDTH / 2 - 1, maxX: ROOM_WIDTH / 2, minZ: 1.5, maxZ: 3, name: 'games' },

  // Escalier (position: [ROOM_WIDTH/2 - 0.7, 0, 3.5])
  { minX: ROOM_WIDTH / 2 - 1.5, maxX: ROOM_WIDTH / 2, minZ: 3, maxZ: 4, name: 'escalier' },

  // Porte privée (position: [ROOM_WIDTH/2 - 0.8, 0, -ROOM_DEPTH/2 + 0.08])
  { minX: ROOM_WIDTH / 2 - 1.3, maxX: ROOM_WIDTH / 2 - 0.3, minZ: -ROOM_DEPTH / 2, maxZ: -ROOM_DEPTH / 2 + 0.5, name: 'porte-privee' },

  // Plante (position: [-ROOM_WIDTH/2 + 0.5, 0, -ROOM_DEPTH/2 + 0.5])
  { minX: -ROOM_WIDTH / 2, maxX: -ROOM_WIDTH / 2 + 1, minZ: -ROOM_DEPTH / 2, maxZ: -ROOM_DEPTH / 2 + 1, name: 'plante' },
]

// Fonction pour vérifier si une position est en collision
function checkCollision(x: number, z: number, margin: number): boolean {
  for (const zone of COLLISION_ZONES) {
    // Ajouter la marge de collision (7%)
    const expandedMinX = zone.minX - margin
    const expandedMaxX = zone.maxX + margin
    const expandedMinZ = zone.minZ - margin
    const expandedMaxZ = zone.maxZ + margin

    if (x >= expandedMinX && x <= expandedMaxX && z >= expandedMinZ && z <= expandedMaxZ) {
      return true // Collision détectée
    }
  }
  return false
}


// Vecteur statique centre écran (évite allocation chaque frame de raycast)
const SCREEN_CENTER = new THREE.Vector2(0, 0)

// OPTIMISATION: Layers Three.js pour le raycaster
// Au lieu de tester ~867 meshes, on ne teste que les layers interactifs (~526 objets)
// Layer 0 = default (rendu uniquement, pas de raycast)
// Layer 1 = cassettes VHS (raycast ciblage)
// Layer 2 = objets interactifs (manager, bell, TV)
export const RAYCAST_LAYER_CASSETTE = 1
export const RAYCAST_LAYER_INTERACTIVE = 2

// Type pour les objets interactifs détectés par raycast
type InteractiveTarget = 'manager' | 'bell' | 'tv' | null

export function Controls({ onCassetteClick }: ControlsProps) {
  const { camera, gl, scene } = useThree()
  const setTargetedFilm = useStore((state) => state.setTargetedFilm)
  const setPointerLocked = useStore((state) => state.setPointerLocked)
  const showManager = useStore((state) => state.showManager)
  const openTerminal = useStore((state) => state.openTerminal)
  const requestPointerUnlock = useStore((state) => state.requestPointerUnlock)
  const pointerLockRequested = useStore((state) => state.pointerLockRequested)
  const clearPointerLockRequest = useStore((state) => state.clearPointerLockRequest)
  const controlsRef = useRef<PointerLockControlsImpl | null>(null)
  // OPTIMISATION: Raycaster avec layers — ne teste que cassettes (1) et interactifs (2)
  const raycasterRef = useRef<THREE.Raycaster>(null!)
  if (!raycasterRef.current) {
    raycasterRef.current = new THREE.Raycaster()
    raycasterRef.current.layers.set(RAYCAST_LAYER_CASSETTE)
    raycasterRef.current.layers.enable(RAYCAST_LAYER_INTERACTIVE)
  }
  const moveForward = useRef(false)
  const moveBackward = useRef(false)
  const moveLeft = useRef(false)
  const moveRight = useRef(false)
  const velocity = useRef(new THREE.Vector3())
  const direction = useRef(new THREE.Vector3())

  // Cible interactive actuelle (manager, bell, tv)
  const targetedInteractiveRef = useRef<InteractiveTarget>(null)

  // Hystérésis pour éviter le clipping de sélection aux bords des cassettes
  const lastCassetteKeyRef = useRef<string | null>(null)
  const lastFilmIdRef = useRef<number | null>(null)
  const deselectTimerRef = useRef<number>(0)
  const hitCountRef = useRef<number>(0) // Compteur de hits consécutifs
  const DESELECT_DELAY = 0.4 // 400ms avant désélection
  const MIN_HITS_TO_CHANGE = 3 // Minimum de hits consécutifs pour changer de cassette

  // Throttle raycast - ne faire le raycast que tous les N frames pour optimiser CPU
  const frameCountRef = useRef(0)
  const RAYCAST_INTERVAL = 2 // Raycast tous les 2 frames (30 fois/sec au lieu de 60)

  // Configurer la caméra (entrée en bas-gauche, face au magasin)
  useEffect(() => {
    camera.position.set(-3.5, 1.6, 3)
    camera.near = 0.1
    camera.far = 15  // Pièce 11×8.5m, diagonale ~14m, frustum serré = meilleur culling
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 70
      camera.updateProjectionMatrix()
    }
  }, [camera])

  // Vérifier si un overlay est ouvert (pour empêcher le lock)
  const managerVisible = useStore((state) => state.managerVisible)
  const selectedFilmId = useStore((state) => state.selectedFilmId)
  const isTerminalOpen = useStore((state) => state.isTerminalOpen)

  // Gérer les demandes de lock/unlock depuis le store
  useEffect(() => {
    if (!controlsRef.current || !pointerLockRequested) return

    const hasOverlayOpen = managerVisible || selectedFilmId !== null || isTerminalOpen

    if (pointerLockRequested === 'unlock' && controlsRef.current.isLocked) {
      controlsRef.current.unlock()
    } else if (pointerLockRequested === 'lock' && !controlsRef.current.isLocked && !hasOverlayOpen) {
      // Ne pas locker si un overlay est ouvert
      controlsRef.current.lock()
    }
    clearPointerLockRequest()
  }, [pointerLockRequested, clearPointerLockRequest, managerVisible, selectedFilmId, isTerminalOpen])

  // Fonction pour sélectionner la cassette ciblée ou interagir avec manager/TV
  const handleInteraction = useCallback(() => {
    if (!controlsRef.current?.isLocked) return

    // Vérifier si on cible un objet interactif (manager, sonnette, TV)
    const interactive = targetedInteractiveRef.current
    if (interactive === 'manager' || interactive === 'bell') {
      showManager()
      return
    }
    if (interactive === 'tv') {
      openTerminal()
      requestPointerUnlock()
      return
    }

    // Sinon, utiliser le targetedFilmId du store (mis à jour en continu par useFrame)
    const targetedFilmId = useStore.getState().targetedFilmId
    if (targetedFilmId !== null) {
      onCassetteClick?.(targetedFilmId)
      requestPointerUnlock() // Déverrouiller pour interagir avec le modal
    }
  }, [onCassetteClick, showManager, openTerminal, requestPointerUnlock])

  // Créer les contrôles - useRef pour éviter la recréation
  const controlsCreated = useRef(false)
  const handleClickRef = useRef<(() => void) | null>(null)
  const handleKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const handleKeyUpRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  // Mettre à jour handleInteraction sans recréer les contrôles
  const handleInteractionRef = useRef(handleInteraction)
  useEffect(() => {
    handleInteractionRef.current = handleInteraction
  }, [handleInteraction])

  useEffect(() => {
    // Ne créer les contrôles qu'une seule fois
    if (controlsCreated.current) return
    controlsCreated.current = true

    const controls = new PointerLockControlsImpl(camera, gl.domElement)
    controlsRef.current = controls

    // Écouter les événements de lock/unlock
    const handleLock = () => setPointerLocked(true)
    const handleUnlock = () => setPointerLocked(false)
    controls.addEventListener('lock', handleLock)
    controls.addEventListener('unlock', handleUnlock)

    handleClickRef.current = () => {
      if (controls.isLocked) {
        handleInteractionRef.current()
      } else {
        // Ne pas locker si un overlay est ouvert
        const state = useStore.getState()
        const hasOverlayOpen = state.managerVisible || state.selectedFilmId !== null || state.isTerminalOpen
        if (!hasOverlayOpen) {
          controls.lock()
        }
      }
    }

    handleKeyDownRef.current = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          moveForward.current = true
          break
        case 'KeyS':
        case 'ArrowDown':
          moveBackward.current = true
          break
        case 'KeyA':
        case 'ArrowLeft':
          moveLeft.current = true
          break
        case 'KeyD':
        case 'ArrowRight':
          moveRight.current = true
          break
        case 'KeyE':
        case 'Space':
          handleInteractionRef.current()
          break
      }
    }

    handleKeyUpRef.current = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          moveForward.current = false
          break
        case 'KeyS':
        case 'ArrowDown':
          moveBackward.current = false
          break
        case 'KeyA':
        case 'ArrowLeft':
          moveLeft.current = false
          break
        case 'KeyD':
        case 'ArrowRight':
          moveRight.current = false
          break
      }
    }

    gl.domElement.addEventListener('click', handleClickRef.current)
    document.addEventListener('keydown', handleKeyDownRef.current)
    document.addEventListener('keyup', handleKeyUpRef.current)

    return () => {
      if (handleClickRef.current) {
        gl.domElement.removeEventListener('click', handleClickRef.current)
      }
      if (handleKeyDownRef.current) {
        document.removeEventListener('keydown', handleKeyDownRef.current)
      }
      if (handleKeyUpRef.current) {
        document.removeEventListener('keyup', handleKeyUpRef.current)
      }
      controls.removeEventListener('lock', handleLock)
      controls.removeEventListener('unlock', handleUnlock)
      controls.dispose()
      controlsRef.current = null
      controlsCreated.current = false
      setPointerLocked(false)
    }
  }, [camera, gl, setPointerLocked])

  // Boucle de mouvement et de ciblage
  useFrame((_, delta) => {
    // Incrémenter le compteur de frames
    frameCountRef.current++

    // Raycasting pour le ciblage - seulement quand locké ET tous les N frames
    const shouldRaycast = frameCountRef.current % RAYCAST_INTERVAL === 0

    if (controlsRef.current?.isLocked && shouldRaycast) {
      // Raycast depuis le centre de l'écran (crosshair) — distance max 6m
      raycasterRef.current.setFromCamera(SCREEN_CENTER, camera)
      raycasterRef.current.far = 6
      const intersects = raycasterRef.current.intersectObjects(scene.children, true)

      let foundFilmId: number | null = null
      let foundCassetteKey: string | null = null
      let foundInteractive: InteractiveTarget = null

      for (const intersect of intersects) {
        // Check for InstancedMesh cassettes first (Phase D optimization)
        if (intersect.object.userData?.isCassetteInstances && intersect.instanceId !== undefined) {
          const idToKey = intersect.object.userData.instanceIdToKey as string[]
          const idToFilm = intersect.object.userData.instanceIdToFilmId as number[]
          if (idToKey && idToFilm && intersect.instanceId < idToKey.length) {
            foundFilmId = idToFilm[intersect.instanceId]
            foundCassetteKey = idToKey[intersect.instanceId]
            break
          }
        }

        // Chercher l'objet avec userData dans la hiérarchie
        let obj: THREE.Object3D | null = intersect.object
        while (obj) {
          // Vérifier les objets interactifs
          if (obj.userData?.isManager) {
            foundInteractive = 'manager'
            break
          }
          if (obj.userData?.isServiceBell) {
            foundInteractive = 'bell'
            break
          }
          if (obj.userData?.isTVScreen) {
            foundInteractive = 'tv'
            break
          }
          // Vérifier les cassettes (legacy individual cassettes)
          if (obj.userData?.filmId && obj.userData?.cassetteKey) {
            foundFilmId = obj.userData.filmId
            foundCassetteKey = obj.userData.cassetteKey
            break
          }
          obj = obj.parent
        }
        if (foundInteractive || foundFilmId !== null) break
      }

      targetedInteractiveRef.current = foundInteractive

      // Hystérésis renforcée pour la sélection des cassettes - évite le clipping aux bords
      const currentCassetteKey = lastCassetteKeyRef.current

      if (foundCassetteKey) {
        // Cassette détectée - reset le timer de désélection
        deselectTimerRef.current = 0

        if (foundCassetteKey === currentCassetteKey) {
          // Même cassette - tout va bien, incrémenter le compteur
          hitCountRef.current = Math.min(hitCountRef.current + 1, 10)
        } else if (currentCassetteKey === null) {
          // Pas de cassette sélectionnée - sélection immédiate
          lastCassetteKeyRef.current = foundCassetteKey
          lastFilmIdRef.current = foundFilmId
          hitCountRef.current = 1
          setTargetedFilm(foundFilmId, foundCassetteKey)
        } else {
          // Autre cassette détectée - attendre plusieurs hits consécutifs avant de changer
          hitCountRef.current++
          if (hitCountRef.current >= MIN_HITS_TO_CHANGE) {
            lastCassetteKeyRef.current = foundCassetteKey
            lastFilmIdRef.current = foundFilmId
            hitCountRef.current = 1
            setTargetedFilm(foundFilmId, foundCassetteKey)
          }
          // Sinon garder l'ancienne sélection
        }
      } else if (currentCassetteKey) {
        // Aucune cassette détectée mais on en avait une
        hitCountRef.current = 0 // Reset le compteur de hits
        deselectTimerRef.current += delta
        if (deselectTimerRef.current >= DESELECT_DELAY) {
          // Délai écoulé - désélectionner
          lastCassetteKeyRef.current = null
          lastFilmIdRef.current = null
          deselectTimerRef.current = 0
          setTargetedFilm(null, null)
        }
        // Sinon, garder la sélection actuelle (ne PAS appeler setTargetedFilm)
      }
      // Si aucune cassette et aucune sélection précédente, ne rien faire

      // Changer le curseur selon ce qu'on cible
      if (foundInteractive || lastCassetteKeyRef.current !== null) {
        document.body.style.cursor = 'pointer'
      } else {
        document.body.style.cursor = 'crosshair'
      }
    }

    // Reset le ciblage seulement quand pas locké (pas quand on skip un frame de raycast)
    if (!controlsRef.current?.isLocked) {
      targetedInteractiveRef.current = null
      // Only call setTargetedFilm if not already null (avoids unnecessary re-renders)
      if (lastCassetteKeyRef.current !== null || lastFilmIdRef.current !== null) {
        lastCassetteKeyRef.current = null
        lastFilmIdRef.current = null
        deselectTimerRef.current = 0
        setTargetedFilm(null, null)
      }
      document.body.style.cursor = 'default'
    }

    // Mouvement - seulement quand locké
    if (!controlsRef.current?.isLocked) return

    const speed = 5.0
    velocity.current.x -= velocity.current.x * 10.0 * delta
    velocity.current.z -= velocity.current.z * 10.0 * delta

    direction.current.z = Number(moveForward.current) - Number(moveBackward.current)
    direction.current.x = Number(moveRight.current) - Number(moveLeft.current)
    direction.current.normalize()

    if (moveForward.current || moveBackward.current) {
      velocity.current.z -= direction.current.z * speed * delta
    }
    if (moveLeft.current || moveRight.current) {
      velocity.current.x -= direction.current.x * speed * delta
    }

    // Sauvegarder la position actuelle
    const oldX = camera.position.x
    const oldZ = camera.position.z

    // Appliquer le mouvement
    controlsRef.current.moveRight(-velocity.current.x)
    controlsRef.current.moveForward(-velocity.current.z)

    // Limites de la pièce
    const WALL_MARGIN = 0.5
    let newX = Math.max(-ROOM_WIDTH / 2 + WALL_MARGIN, Math.min(ROOM_WIDTH / 2 - WALL_MARGIN, camera.position.x))
    let newZ = Math.max(-ROOM_DEPTH / 2 + WALL_MARGIN, Math.min(ROOM_DEPTH / 2 - WALL_MARGIN, camera.position.z))

    // Vérifier les collisions avec les objets (marge de 7%)
    const collisionDist = 0.5 * COLLISION_MARGIN * 10 // ~0.35m de marge

    // Tester la nouvelle position
    if (checkCollision(newX, newZ, collisionDist)) {
      // Collision détectée - essayer de glisser le long des obstacles

      // Essayer uniquement le mouvement X
      if (!checkCollision(newX, oldZ, collisionDist)) {
        newZ = oldZ
      }
      // Essayer uniquement le mouvement Z
      else if (!checkCollision(oldX, newZ, collisionDist)) {
        newX = oldX
      }
      // Les deux directions sont bloquées
      else {
        newX = oldX
        newZ = oldZ
      }
    }

    camera.position.x = newX
    camera.position.z = newZ

    // Garder la hauteur fixe
    camera.position.y = 1.6
  })

  return null
}
