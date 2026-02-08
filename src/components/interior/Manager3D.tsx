import { useRef, useMemo, useCallback, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store'
import { RAYCAST_LAYER_INTERACTIVE } from './Controls'

// Composant lazy pour le corps du manager
function ManagerBody({ scale }: { scale: number }) {
  const { scene: bodyModel } = useGLTF('/models/quentin_body.glb', true)

  const bodyScene = useMemo(() => {
    const cloned = bodyModel.clone(true)
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false
        child.receiveShadow = false
      }
    })
    return cloned
  }, [bodyModel])

  return <primitive object={bodyScene} position={[0, 0, 0]} scale={scale} />
}

interface Manager3DProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onInteract?: () => void
}

// Proportions réalistes pour un personnage de 1m90
const BODY = {
  // Tête - positionnée pour s'aligner avec le cou
  headY: 1.75,
  headScale: 0.069,  // Réduit de 30% supplémentaires

  // Cou
  neckRadius: 0.055,
  neckHeight: 0.06,
  neckY: 1.45,

  // Torse
  torsoWidth: 0.42,
  torsoHeight: 0.5,
  torsoDepth: 0.22,
  torsoY: 1.22,

  // Épaules
  shoulderWidth: 0.48,
  shoulderY: 1.42,

  // Bras
  upperArmLength: 0.28,
  lowerArmLength: 0.26,
  armRadius: 0.045,

  // Bassin/Hanches
  hipWidth: 0.36,
  hipHeight: 0.15,
  hipY: 0.92,

  // Jambes
  upperLegLength: 0.42,
  lowerLegLength: 0.4,
  legRadius: 0.06,

  // Pieds
  footLength: 0.22,
  footWidth: 0.09,
  footHeight: 0.06,
}

// Précharger uniquement la tête (le corps se charge en lazy loading)
useGLTF.preload('/models/quentin_head.glb', true)

// Positions de base des yeux (ajustées pour headScale 0.069)
const LEFT_EYE_BASE = { x: -0.059, y: 0.217, z: 0.149 }
const RIGHT_EYE_BASE = { x: 0.059, y: 0.217, z: 0.149 }
const PUPIL_OFFSET = 0.003 // Distance pupille devant iris (réduit proportionnellement)
const EYE_MOVE_RANGE = 0.008 // Amplitude max du mouvement des yeux (réduit)

// Vecteurs réutilisables pour useFrame (évite allocations par frame)
const _headWorldPos = new THREE.Vector3()
const _lookDir = new THREE.Vector3()

export function Manager3D({ position, rotation = [0, 0, 0], onInteract }: Manager3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)

  // Refs pour les groupes d'yeux (iris + pupille + reflet)
  const leftIrisRef = useRef<THREE.Group>(null)
  const rightIrisRef = useRef<THREE.Group>(null)

  const { managerVisible, showManager, addChatMessage } = useStore()

  const timeRef = useRef(0)

  // Couleurs
  const skinColor = '#e0b090'
  const hairColor = '#1a1a1a'

  // Charger le modèle de la tête (chargement direct pour le manager)
  const { scene: headModel } = useGLTF('/models/quentin_head.glb', true)

  // Cloner le modèle de la tête et appliquer les couleurs
  const headScene = useMemo(() => {
    const cloned = headModel.clone(true)

    // D'abord, calculer le bounding box global pour trouver le haut de la tête
    const box = new THREE.Box3().setFromObject(cloned)
    const headHeight = box.max.y - box.min.y
    const hairThreshold = box.min.y + headHeight * 0.60 // Top 40% = cheveux

    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Calculer le bounding box de ce mesh spécifique
        const meshBox = new THREE.Box3().setFromObject(child)
        const meshCenterY = (meshBox.min.y + meshBox.max.y) / 2

        // Sphere001_* sont les yeux
        const isEye = child.name.includes('001')

        // Les meshes dont le centre Y est au-dessus du seuil = cheveux
        const isHair = !isEye && meshCenterY > hairThreshold

        // Couleurs finales
        let color = skinColor
        let roughness = 0.8

        if (isEye) {
          color = '#ffffff'
          roughness = 0.3
        } else if (isHair) {
          color = hairColor
          roughness = 0.9
        }

        // Disposer le material GLTF original avant remplacement (memory leak fix)
        if (child.material) {
          const mat = child.material as THREE.Material
          mat.dispose()
        }

        child.material = new THREE.MeshStandardMaterial({
          color: color,
          roughness: roughness,
          metalness: 0.0,
        })
        child.castShadow = false
        child.receiveShadow = false
      }
    })

    return cloned
  }, [headModel])

  // Animation idle + suivi du regard
  useFrame((state, delta) => {
    timeRef.current += delta

    if (!groupRef.current) return

    // Respiration subtile
    const breathe = Math.sin(timeRef.current * 1.2) * 0.003
    groupRef.current.position.y = position[1] + breathe

    // Léger mouvement de tête
    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(timeRef.current * 0.4) * 0.03
      headRef.current.rotation.x = Math.sin(timeRef.current * 0.25) * 0.015

      // Faire suivre le regard vers la caméra
      const camera = state.camera
      headRef.current.getWorldPosition(_headWorldPos)

      // Direction vers la caméra
      _lookDir.subVectors(camera.position, _headWorldPos).normalize()

      // Convertir en offset local pour les yeux (limité) - inverser X pour suivre le regard
      const eyeOffsetX = THREE.MathUtils.clamp(-_lookDir.x * 0.05, -EYE_MOVE_RANGE, EYE_MOVE_RANGE)
      const eyeOffsetY = THREE.MathUtils.clamp(_lookDir.y * 0.03, -EYE_MOVE_RANGE * 0.5, EYE_MOVE_RANGE * 0.5)

      // Appliquer aux groupes d'yeux
      if (leftIrisRef.current) {
        leftIrisRef.current.position.x = LEFT_EYE_BASE.x + eyeOffsetX
        leftIrisRef.current.position.y = LEFT_EYE_BASE.y + eyeOffsetY
      }
      if (rightIrisRef.current) {
        rightIrisRef.current.position.x = RIGHT_EYE_BASE.x + eyeOffsetX
        rightIrisRef.current.position.y = RIGHT_EYE_BASE.y + eyeOffsetY
      }
    }
  })

  // Handler pour l'interaction
  const handleClick = () => {
    if (onInteract) {
      onInteract()
    } else {
      showManager()
      if (!managerVisible) {
        addChatMessage('manager', "Ouais ? Qu'est-ce que je peux faire pour toi ?")
      }
    }
  }

  return (
    <group ref={groupRef} position={position} rotation={rotation}>

      {/* ===== TÊTE (modèle GLB) ===== */}
      <group ref={headRef} position={[0, BODY.headY, 0.084]}>
        <primitive object={headScene} scale={BODY.headScale} />

        {/* === OEIL GAUCHE === */}
        <group ref={leftIrisRef} position={[LEFT_EYE_BASE.x, LEFT_EYE_BASE.y, LEFT_EYE_BASE.z]}>
          {/* Iris marron */}
          <mesh position={[0, 0, 0.007]}>
            <circleGeometry args={[0.010, 8]} />
            <meshStandardMaterial color="#6b4423" roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* Anneau limbique (contour sombre) */}
          <mesh position={[0, 0, 0.007]}>
            <ringGeometry args={[0.008, 0.010, 8]} />
            <meshStandardMaterial color="#2a1810" roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* Pupille */}
          <mesh position={[0, 0, 0.0075]}>
            <circleGeometry args={[0.004, 8]} />
            <meshStandardMaterial color="#000000" roughness={0.1} side={THREE.DoubleSide} />
          </mesh>
          {/* Reflet spéculaire */}
          <mesh position={[0.002, 0.0025, 0.008]}>
            <circleGeometry args={[0.0013, 6]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} roughness={0} side={THREE.DoubleSide} />
          </mesh>
        </group>

        {/* === OEIL DROIT === */}
        <group ref={rightIrisRef} position={[RIGHT_EYE_BASE.x, RIGHT_EYE_BASE.y, RIGHT_EYE_BASE.z]}>
          {/* Iris marron */}
          <mesh position={[0, 0, 0.007]}>
            <circleGeometry args={[0.010, 8]} />
            <meshStandardMaterial color="#6b4423" roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* Anneau limbique (contour sombre) */}
          <mesh position={[0, 0, 0.007]}>
            <ringGeometry args={[0.008, 0.010, 8]} />
            <meshStandardMaterial color="#2a1810" roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* Pupille */}
          <mesh position={[0, 0, 0.0075]}>
            <circleGeometry args={[0.004, 8]} />
            <meshStandardMaterial color="#000000" roughness={0.1} side={THREE.DoubleSide} />
          </mesh>
          {/* Reflet spéculaire */}
          <mesh position={[0.002, 0.0025, 0.008]}>
            <circleGeometry args={[0.0013, 6]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} roughness={0} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>

      {/* ===== CORPS (modèle GLB - lazy loading) ===== */}
      <Suspense fallback={null}>
        <ManagerBody scale={1.5} />
      </Suspense>

      {/* Zone de clic invisible (layer 2 pour raycast optimisé) */}
      <mesh
        position={[0, 1.0, 0]}
        userData={{ isManager: true }}
        ref={useCallback((node: THREE.Mesh | null) => {
          if (node) node.layers.enable(RAYCAST_LAYER_INTERACTIVE)
        }, [])}
      >
        <boxGeometry args={[0.5, 1.8, 0.3]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
