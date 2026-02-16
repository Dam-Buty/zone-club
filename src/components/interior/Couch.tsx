import { useRef, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture, RoundedBox } from '@react-three/drei'

interface CouchProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  onSit?: () => void
}

export function Couch({ position, rotation = [0, 0, 0], onSit }: CouchProps) {
  const groupRef = useRef<THREE.Group>(null)

  // Textures PBR tissu
  const fabricTextures = useTexture({
    map: '/textures/fabric/color.jpg',
    normalMap: '/textures/fabric/normal.jpg',
    roughnessMap: '/textures/fabric/roughness.jpg',
  })

  // Textures PBR bois (pieds)
  const woodTextures = useTexture({
    map: '/textures/wood/color.jpg',
    normalMap: '/textures/wood/normal.jpg',
    roughnessMap: '/textures/wood/roughness.jpg',
  })

  useMemo(() => {
    Object.entries(fabricTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(4, 4)
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
    Object.entries(woodTextures).forEach(([key, tex]) => {
      const t = tex as THREE.Texture
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, 1)
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    })
  }, [fabricTextures, woodTextures])

  const handleClick = () => {
    if (onSit) onSit()
  }

  // OPTIMISATION: 3 matériaux partagés (au lieu de ~8 inline)
  // Matériau tissu — PAS de roughnessMap (ses valeurs gris moyen ~0.5 réduisent
  // la roughness effective et créent des reflets spéculaires qui donnent un aspect plastique).
  // roughness=1.0 flat + normalMap seule = absorption douce de la lumière comme du vrai tissu.
  const fabricMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: fabricTextures.map as THREE.Texture,
    normalMap: fabricTextures.normalMap as THREE.Texture,
    color: '#4a1d42',
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(3.0, 3.0),
    envMapIntensity: 0,
  }), [fabricTextures])

  const woodMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    roughnessMap: woodTextures.roughnessMap as THREE.Texture,
    color: '#3a2a1a',
    normalScale: new THREE.Vector2(0.7, 0.7),
  }), [woodTextures])

  const footMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: woodTextures.map as THREE.Texture,
    normalMap: woodTextures.normalMap as THREE.Texture,
    color: '#3a2a1a',
    roughness: 0.4,
    metalness: 0.02,
  }), [woodTextures])

  useEffect(() => {
    return () => {
      fabricMaterial.dispose()
      woodMaterial.dispose()
      footMaterial.dispose()
    }
  }, [fabricMaterial, woodMaterial, footMaterial])

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      {/* Base/Structure bois - cadre interne (matériau partagé) */}
      <RoundedBox
        args={[1.056, 0.072, 0.576]}
        radius={0.012}
        smoothness={2}
        position={[0, 0.204, 0]}
        receiveShadow
        material={woodMaterial}
      />

      {/* Assise (coussin principal) - tissu arrondi (matériau partagé) */}
      <RoundedBox
        args={[0.984, 0.168, 0.504]}
        radius={0.048}
        smoothness={2}
        position={[0, 0.348, 0.024]}
        onClick={handleClick}
        castShadow
        receiveShadow
        material={fabricMaterial}
      />

      {/* Couture centrale de l'assise */}
      <mesh position={[0, 0.432, 0.024]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.012, 0.006, 0.456]} />
        <meshStandardMaterial color="#4a1e3e" roughness={1.0} />
      </mesh>

      {/* Dossier - tissu arrondi (matériau partagé) */}
      <RoundedBox
        args={[0.984, 0.384, 0.12]}
        radius={0.036}
        smoothness={2}
        position={[0, 0.552, -0.228]}
        receiveShadow
        material={fabricMaterial}
      />

      {/* Accoudoir gauche - tissu arrondi (matériau partagé) */}
      <RoundedBox
        args={[0.12, 0.264, 0.576]}
        radius={0.036}
        smoothness={2}
        position={[-0.48, 0.432, 0]}
        receiveShadow
        material={fabricMaterial}
      />

      {/* Accoudoir droit - tissu arrondi (matériau partagé) */}
      <RoundedBox
        args={[0.12, 0.264, 0.576]}
        radius={0.036}
        smoothness={2}
        position={[0.48, 0.432, 0]}
        receiveShadow
        material={fabricMaterial}
      />

      {/* Pieds en bois tournés (matériau partagé) */}
      {[
        [-0.42, 0.072, 0.216],
        [0.42, 0.072, 0.216],
        [-0.42, 0.072, -0.216],
        [0.42, 0.072, -0.216],
      ].map((pos, i) => (
        <mesh key={`foot-${i}`} position={pos as [number, number, number]} material={footMaterial}>
          <cylinderGeometry args={[0.03, 0.024, 0.144, 6]} />
        </mesh>
      ))}

      {/* Zone de clic invisible (+20%) */}
      <mesh position={[0, 0.42, 0]} onClick={handleClick} visible={false}>
        <boxGeometry args={[1.08, 0.36, 0.6]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}
