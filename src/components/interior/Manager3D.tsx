import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store'

interface Manager3DProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onInteract?: () => void
}

// Proportions réalistes pour un personnage de 1m90
const BODY = {
  // Tête - positionnée pour s'aligner avec le cou
  headY: 1.52,
  headScale: 0.11,

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

// Précharger le modèle GLB
useGLTF.preload('/models/quentin_head.glb')

// Positions de base des yeux
const LEFT_EYE_BASE = { x: -0.095, y: 0.346, z: 0.237 }
const RIGHT_EYE_BASE = { x: 0.095, y: 0.346, z: 0.237 }
const PUPIL_OFFSET = 0.005 // Distance pupille devant iris
const EYE_MOVE_RANGE = 0.012 // Amplitude max du mouvement des yeux

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

  // Charger le modèle GLB de la tête
  const { scene: headModel } = useGLTF('/models/quentin_head.glb')

  // Cloner le modèle et appliquer les couleurs
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

        child.material = new THREE.MeshStandardMaterial({
          color: color,
          roughness: roughness,
          metalness: 0.0,
        })
        child.castShadow = true
        child.receiveShadow = true
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
      const headWorldPos = new THREE.Vector3()
      headRef.current.getWorldPosition(headWorldPos)

      // Direction vers la caméra
      const lookDir = new THREE.Vector3()
        .subVectors(camera.position, headWorldPos)
        .normalize()

      // Convertir en offset local pour les yeux (limité) - inverser X pour suivre le regard
      const eyeOffsetX = THREE.MathUtils.clamp(-lookDir.x * 0.05, -EYE_MOVE_RANGE, EYE_MOVE_RANGE)
      const eyeOffsetY = THREE.MathUtils.clamp(lookDir.y * 0.03, -EYE_MOVE_RANGE * 0.5, EYE_MOVE_RANGE * 0.5)

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
      <group ref={headRef} position={[0, BODY.headY, 0]}>
        <primitive object={headScene} scale={BODY.headScale} />

        {/* === OEIL GAUCHE === */}
        <group ref={leftIrisRef} position={[LEFT_EYE_BASE.x, LEFT_EYE_BASE.y, LEFT_EYE_BASE.z]}>
          {/* Iris marron */}
          <mesh position={[0, 0, 0.011]}>
            <circleGeometry args={[0.016, 32]} />
            <meshStandardMaterial color="#6b4423" roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* Anneau limbique (contour sombre) */}
          <mesh position={[0, 0, 0.011]}>
            <ringGeometry args={[0.013, 0.016, 32]} />
            <meshStandardMaterial color="#2a1810" roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* Pupille */}
          <mesh position={[0, 0, 0.012]}>
            <circleGeometry args={[0.006, 24]} />
            <meshStandardMaterial color="#000000" roughness={0.1} side={THREE.DoubleSide} />
          </mesh>
          {/* Reflet spéculaire */}
          <mesh position={[0.003, 0.004, 0.013]}>
            <circleGeometry args={[0.002, 16]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} roughness={0} side={THREE.DoubleSide} />
          </mesh>
        </group>

        {/* === OEIL DROIT === */}
        <group ref={rightIrisRef} position={[RIGHT_EYE_BASE.x, RIGHT_EYE_BASE.y, RIGHT_EYE_BASE.z]}>
          {/* Iris marron */}
          <mesh position={[0, 0, 0.011]}>
            <circleGeometry args={[0.016, 32]} />
            <meshStandardMaterial color="#6b4423" roughness={0.3} side={THREE.DoubleSide} />
          </mesh>
          {/* Anneau limbique (contour sombre) */}
          <mesh position={[0, 0, 0.011]}>
            <ringGeometry args={[0.013, 0.016, 32]} />
            <meshStandardMaterial color="#2a1810" roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* Pupille */}
          <mesh position={[0, 0, 0.012]}>
            <circleGeometry args={[0.006, 24]} />
            <meshStandardMaterial color="#000000" roughness={0.1} side={THREE.DoubleSide} />
          </mesh>
          {/* Reflet spéculaire */}
          <mesh position={[0.003, 0.004, 0.013]}>
            <circleGeometry args={[0.002, 16]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} roughness={0} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>

      {/* ===== COU ===== */}
      <mesh position={[0, BODY.neckY, 0]}>
        <cylinderGeometry args={[BODY.neckRadius, BODY.neckRadius * 1.1, BODY.neckHeight, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.8} />
      </mesh>

      {/* ===== TORSE (blouson cuir) ===== */}
      <mesh position={[0, BODY.torsoY, 0]} castShadow>
        <boxGeometry args={[BODY.torsoWidth, BODY.torsoHeight, BODY.torsoDepth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
      </mesh>

      {/* Épaules arrondies */}
      <mesh position={[-BODY.shoulderWidth / 2, BODY.shoulderY, 0]} castShadow>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
      </mesh>
      <mesh position={[BODY.shoulderWidth / 2, BODY.shoulderY, 0]} castShadow>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
      </mesh>

      {/* ===== BRAS GAUCHE ===== */}
      <group position={[-BODY.shoulderWidth / 2 - 0.02, BODY.shoulderY - 0.05, 0]}>
        <mesh position={[0, -BODY.upperArmLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.armRadius, BODY.upperArmLength, 4, 8]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
        </mesh>
        <mesh position={[0, -BODY.upperArmLength, 0]}>
          <sphereGeometry args={[BODY.armRadius * 1.1, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
        </mesh>
        <mesh position={[0.02, -BODY.upperArmLength - BODY.lowerArmLength / 2, 0.05]} rotation={[0.3, 0, 0]} castShadow>
          <capsuleGeometry args={[BODY.armRadius * 0.9, BODY.lowerArmLength, 4, 8]} />
          <meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
        <mesh position={[0.04, -BODY.upperArmLength - BODY.lowerArmLength, 0.12]} castShadow>
          <boxGeometry args={[0.06, 0.1, 0.03]} />
          <meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
      </group>

      {/* ===== BRAS DROIT ===== */}
      <group position={[BODY.shoulderWidth / 2 + 0.02, BODY.shoulderY - 0.05, 0]}>
        <mesh position={[0, -BODY.upperArmLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.armRadius, BODY.upperArmLength, 4, 8]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
        </mesh>
        <mesh position={[0, -BODY.upperArmLength, 0]}>
          <sphereGeometry args={[BODY.armRadius * 1.1, 8, 6]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
        </mesh>
        <mesh position={[-0.02, -BODY.upperArmLength - BODY.lowerArmLength / 2, 0.05]} rotation={[0.3, 0, 0]} castShadow>
          <capsuleGeometry args={[BODY.armRadius * 0.9, BODY.lowerArmLength, 4, 8]} />
          <meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
        <mesh position={[-0.04, -BODY.upperArmLength - BODY.lowerArmLength, 0.12]} castShadow>
          <boxGeometry args={[0.06, 0.1, 0.03]} />
          <meshStandardMaterial color={skinColor} roughness={0.8} />
        </mesh>
      </group>

      {/* ===== BASSIN/HANCHES ===== */}
      <mesh position={[0, BODY.hipY, 0]} castShadow>
        <boxGeometry args={[BODY.hipWidth, BODY.hipHeight, BODY.torsoDepth * 0.9]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
      </mesh>

      {/* ===== JAMBE GAUCHE ===== */}
      <group position={[-0.1, BODY.hipY - BODY.hipHeight / 2, 0]}>
        <mesh position={[0, -BODY.upperLegLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.legRadius, BODY.upperLegLength, 4, 8]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength, 0]}>
          <sphereGeometry args={[BODY.legRadius * 1.05, 8, 6]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength - BODY.lowerLegLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.legRadius * 0.85, BODY.lowerLegLength, 4, 8]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength - BODY.lowerLegLength - BODY.footHeight / 2, BODY.footLength / 4]} castShadow>
          <boxGeometry args={[BODY.footWidth, BODY.footHeight, BODY.footLength]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
        </mesh>
      </group>

      {/* ===== JAMBE DROITE ===== */}
      <group position={[0.1, BODY.hipY - BODY.hipHeight / 2, 0]}>
        <mesh position={[0, -BODY.upperLegLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.legRadius, BODY.upperLegLength, 4, 8]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength, 0]}>
          <sphereGeometry args={[BODY.legRadius * 1.05, 8, 6]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength - BODY.lowerLegLength / 2, 0]} castShadow>
          <capsuleGeometry args={[BODY.legRadius * 0.85, BODY.lowerLegLength, 4, 8]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
        </mesh>
        <mesh position={[0, -BODY.upperLegLength - BODY.lowerLegLength - BODY.footHeight / 2, BODY.footLength / 4]} castShadow>
          <boxGeometry args={[BODY.footWidth, BODY.footHeight, BODY.footLength]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
        </mesh>
      </group>

      {/* Zone de clic invisible */}
      <mesh position={[0, 1.0, 0]} userData={{ isManager: true }}>
        <boxGeometry args={[0.5, 1.8, 0.3]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
